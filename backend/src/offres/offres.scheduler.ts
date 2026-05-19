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

      const { data: posts, error } = await this.supabase
        .from('post')
        .select('*')
        .lte('date_creation', sixMonthsAgo.toISOString())
        .is('feedback_email_sent_at', null);

      if (error) {
        this.logger.error('Error fetching eligible posts: ' + error.message);
        return stats;
      }

      if (!posts || posts.length === 0) {
        this.logger.log('No posts eligible for feedback reminders.');
        return stats;
      }

      this.logger.log(`Found ${posts.length} post(s) eligible for feedback reminders.`);

      for (const post of posts) {
        stats.processed++;
        let emailSent = false;

        try {
          const societeId = Number(post['id']);
          if (!Number.isInteger(societeId) || societeId <= 0) continue;

          const { data: societes } = await this.supabase
            .from('Societe')
            .select('email, denomination_sociale')
            .eq('id', societeId)
            .limit(1);

          if (!societes || societes.length === 0) {
            this.logger.warn(`No Societe found for post id_line=${post['id_line']}, skipping email.`);
          } else {
            const societe = societes[0] as { email?: string; denomination_sociale?: string };
            if (societe.email) {
              const postId = post['id_line'] ?? post['id'];
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
                );
                emailSent = true;
                stats.emailed++;
                this.logger.log(`Email sent to ${societe.email} for post id_line=${postId}`);
              } catch (mailErr) {
                const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
                this.logger.error(`Email failed for post id_line=${postId}: ${msg}`);
                stats.errors++;
              }
            }
          }
        } catch (lookupErr) {
          const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
          this.logger.error(`Societe lookup failed for post id_line=${post['id_line']}: ${msg}`);
          stats.errors++;
        }

        // Mark as processed regardless of whether email succeeded,
        // so we do not keep re-trying the same post on every cron tick.
        const postId = post['id_line'] ?? post['id'];
        const { error: updateError } = await this.supabase
          .from('post')
          .update({ feedback_email_sent_at: new Date().toISOString() })
          .eq('id_line', postId);

        if (updateError) {
          this.logger.error(
            `Could not update feedback_email_sent_at for post id_line=${postId}: ${updateError.message}`,
          );
          if (!emailSent) stats.errors++;
        } else {
          this.logger.log(`feedback_email_sent_at set for post id_line=${postId}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Feedback reminder cron error: ' + msg);
    }

    this.logger.log(`Feedback reminder run complete — processed=${stats.processed} emailed=${stats.emailed} errors=${stats.errors}`);
    return stats;
  }
}
