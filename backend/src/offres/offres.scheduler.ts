import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { MailService } from '../admin/mail.service';

@Injectable()
export class OffresScheduler {
  private readonly logger = new Logger(OffresScheduler.name);
  private readonly supabase: SupabaseClient;
  private readonly appUrl: string;

  constructor(private readonly mailService: MailService) {
    const envPath = path.join(process.cwd(), '.env');
    let supabaseUrl = process.env.SUPABASE_URL ?? '';
    let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? '';
    let appUrl = process.env.APP_URL ?? '';

    try {
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).reduce((acc, line) => {
          const m = line.match(/^([^#=]+)=(.*)$/);
          if (m) acc[m[1].trim()] = m[2].trim();
          return acc;
        }, {} as Record<string, string>);
        supabaseUrl ||= env['SUPABASE_URL'] ?? '';
        supabaseKey ||= env['SUPABASE_SERVICE_ROLE_KEY'] ?? env['SUPABASE_KEY'] ?? '';
        appUrl ||= env['APP_URL'] ?? '';
      }
    } catch { /* ignore */ }

    this.appUrl = appUrl || 'http://localhost:4200';
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // Runs every day at 9:00 AM
  @Cron('0 9 * * *')
  async sendFeedbackReminders(): Promise<{ processed: number; emailed: number; errors: number }> {
    this.logger.log('Running feedback reminder check...');
    const stats = { processed: 0, emailed: 0, errors: 0 };

    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // ─── PASS 1: First email ───────────────────────────────────────────────
      // Posts that are old enough and have NEVER been emailed yet.
      const { data: firstPosts, error: firstError } = await this.supabase
        .from('post')
        .select('*')
        .eq('is_archived', false)
        .lte('date_creation', sixMonthsAgo.toISOString())
        .is('feedback_email_sent_at', null);

      if (firstError) {
        this.logger.error('Error fetching first-email posts: ' + firstError.message);
      } else {
        this.logger.log(`Pass 1: found ${(firstPosts ?? []).length} post(s) for first feedback email.`);
        for (const post of firstPosts ?? []) {
          await this.processReminderPost(post, stats, false);
        }
      }

      // ─── PASS 2: Renewal email ─────────────────────────────────────────────
      // Posts that were already emailed but 6+ months have passed since that
      // email AND the post is still active (not archived).
      // → Re-send the email, wipe old feedback_declined, bump email_round.
      const { data: renewalPosts, error: renewalError } = await this.supabase
        .from('post')
        .select('*')
        .eq('is_archived', false)
        .not('feedback_email_sent_at', 'is', null)
        .lte('feedback_email_sent_at', sixMonthsAgo.toISOString());

      if (renewalError) {
        this.logger.error('Error fetching renewal posts: ' + renewalError.message);
      } else {
        this.logger.log(`Pass 2: found ${(renewalPosts ?? []).length} post(s) for renewal feedback email.`);
        for (const post of renewalPosts ?? []) {
          await this.processReminderPost(post, stats, true);
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Feedback reminder cron error: ' + msg);
    }

    this.logger.log(
      `Feedback reminder run complete — processed=${stats.processed} emailed=${stats.emailed} errors=${stats.errors}`,
    );
    return stats;
  }

  /**
   * Handle one post for either the first or a renewal feedback email.
   *
   * For a renewal (isRenewal = true):
   *   1. Increment email_round on the post so old feedback_societe and
   *      feedback_declined rows (round N) no longer count as "done" for the
   *      new round (N+1). Historical rows are never deleted — full history is
   *      preserved across all rounds.
   *   2. Update feedback_email_sent_at to now.
   *   3. Send the renewal-variant email.
   *
   * For a first email (isRenewal = false):
   *   1. Set feedback_email_sent_at to now.
   *   2. Send the standard email.
   */
  private async processReminderPost(
    post: any,
    stats: { processed: number; emailed: number; errors: number },
    isRenewal: boolean,
  ): Promise<void> {
    stats.processed++;
    let emailSent = false;

    const postId = post['id_line'] ?? post['id'];
    const societeId = Number(post['id']);

    if (!Number.isInteger(societeId) || societeId <= 0) {
      this.logger.warn(`Skipping post id_line=${postId}: invalid societeId.`);
      return;
    }

    // ── 1. Look up company contact details ──────────────────────────────────
    try {
      const { data: societes } = await this.supabase
        .from('Societe')
        .select('email, denomination_sociale')
        .eq('id', societeId)
        .limit(1);

      if (!societes || societes.length === 0) {
        this.logger.warn(`No Societe found for post id_line=${postId}, skipping email.`);
      } else {
        const societe = societes[0] as { email?: string; denomination_sociale?: string };
        if (societe.email) {
          const postTitle =
            post['Titre du poste'] ??
            post['titre_poste'] ??
            "votre offre d'emploi";
          const feedbackUrl = `${this.appUrl}/entreprise/feedback?postId=${postId}`;

          try {
            await this.mailService.sendFeedbackReminder(
              societe.email,
              societe.denomination_sociale || 'Votre société',
              postTitle,
              feedbackUrl,
              isRenewal,
            );
            emailSent = true;
            stats.emailed++;
            this.logger.log(
              `${isRenewal ? '[RENEWAL]' : '[FIRST]'} email sent to ${societe.email} for post id_line=${postId}`,
            );
          } catch (mailErr) {
            const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
            this.logger.error(`Email failed for post id_line=${postId}: ${msg}`);
            stats.errors++;
          }
        }
      }
    } catch (lookupErr) {
      const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
      this.logger.error(`Societe lookup failed for post id_line=${postId}: ${msg}`);
      stats.errors++;
    }

    // ── 2. Update post: bump email_round (renewal) + refresh sent timestamp ─
    const updatePayload: Record<string, unknown> = {
      feedback_email_sent_at: new Date().toISOString(),
    };

    if (isRenewal) {
      const currentRound = Number(post['email_round'] ?? 1);
      updatePayload['email_round'] = (Number.isFinite(currentRound) && currentRound >= 1 ? currentRound : 1) + 1;
    }

    const { error: updateError } = await this.supabase
      .from('post')
      .update(updatePayload)
      .eq('id_line', postId);

    if (updateError) {
      // email_round column may not exist yet (migration not run) — retry without it.
      if (isRenewal && /email_round/i.test(updateError.message ?? '')) {
        this.logger.warn(
          `email_round column missing for post id_line=${postId}, falling back to timestamp-only update.`,
        );
        const { error: fallbackErr } = await this.supabase
          .from('post')
          .update({ feedback_email_sent_at: new Date().toISOString() })
          .eq('id_line', postId);

        if (fallbackErr) {
          this.logger.error(
            `Could not update feedback_email_sent_at for post id_line=${postId}: ${fallbackErr.message}`,
          );
          if (!emailSent) stats.errors++;
        } else {
          this.logger.log(`feedback_email_sent_at set (no email_round) for post id_line=${postId}`);
        }
      } else {
        this.logger.error(
          `Could not update post id_line=${postId}: ${updateError.message}`,
        );
        if (!emailSent) stats.errors++;
      }
    } else {
      this.logger.log(
        `Post updated (feedback_email_sent_at${isRenewal ? ' + email_round' : ''}) for id_line=${postId}`,
      );
    }
  }
}
