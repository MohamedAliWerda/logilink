import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';

export type ChallengeAccount =
  | {
      kind: 'user';
      id: string | number;
      auth_id?: string;
      cin_passport: string | number;
      email: string;
      role: 'admin' | 'etudiant';
    }
  | {
      kind: 'entreprise';
      id: string | number;
      email: string;
      societe: Record<string, unknown>;
    };

type Challenge = {
  id: string;
  code: string;
  account: ChallengeAccount;
  attempts: number;
  expiresAt: number;
  lastSentAt: number;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface SmtpEnv {
  user: string;
  pass: string;
  fromName: string;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly challenges = new Map<string, Challenge>();
  private readonly env: SmtpEnv;
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const envPath = path.join(process.cwd(), '.env');
    let fileEnv: Record<string, string> = {};
    try {
      if (fs.existsSync(envPath)) {
        fileEnv = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).reduce((acc, line) => {
          const m = line.match(/^([^#=]+)=(.*)$/);
          if (m) acc[m[1].trim()] = m[2].trim();
          return acc;
        }, {} as Record<string, string>);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn('Could not read .env for SMTP: ' + message);
    }

    this.env = {
      user: process.env.SMTP_USER ?? fileEnv['SMTP_USER'] ?? '',
      pass: (process.env.SMTP_PASS ?? fileEnv['SMTP_PASS'] ?? '').replace(/\s+/g, ''),
      fromName: process.env.SMTP_FROM_NAME ?? fileEnv['SMTP_FROM_NAME'] ?? 'LogiLink',
    };

    if (!this.env.user || !this.env.pass) {
      this.logger.error('Missing SMTP_USER or SMTP_PASS; TwoFactorService will not send emails.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.env.user,
        pass: this.env.pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  async createChallenge(account: ChallengeAccount): Promise<{ challengeId: string; maskedEmail: string }> {
    this.purgeExpired();

    const challengeId = crypto.randomUUID();
    const code = this.generateCode();
    const now = Date.now();

    const challenge: Challenge = {
      id: challengeId,
      code,
      account,
      attempts: 0,
      expiresAt: now + CODE_TTL_MS,
      lastSentAt: now,
    };
    this.challenges.set(challengeId, challenge);

    await this.sendCodeEmail(account.email, code);

    return { challengeId, maskedEmail: this.maskEmail(account.email) };
  }

  consume(challengeId: string, code: string): ChallengeAccount {
    this.purgeExpired();

    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new Error('CODE_EXPIRED');
    }

    if (challenge.expiresAt < Date.now()) {
      this.challenges.delete(challengeId);
      throw new Error('CODE_EXPIRED');
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      this.challenges.delete(challengeId);
      throw new Error('TOO_MANY_ATTEMPTS');
    }

    if (challenge.code !== code.trim()) {
      challenge.attempts += 1;
      throw new Error('CODE_INVALID');
    }

    this.challenges.delete(challengeId);
    return challenge.account;
  }

  async resend(challengeId: string): Promise<{ maskedEmail: string }> {
    this.purgeExpired();

    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new Error('CODE_EXPIRED');
    }

    const now = Date.now();
    if (now - challenge.lastSentAt < RESEND_COOLDOWN_MS) {
      throw new Error('RESEND_COOLDOWN');
    }

    challenge.code = this.generateCode();
    challenge.expiresAt = now + CODE_TTL_MS;
    challenge.attempts = 0;
    challenge.lastSentAt = now;

    await this.sendCodeEmail(challenge.account.email, challenge.code);

    return { maskedEmail: this.maskEmail(challenge.account.email) };
  }

  private generateCode(): string {
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(6, '0');
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain || !local) return email;
    const visible = local.slice(0, Math.max(1, Math.min(2, local.length - 1)));
    return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [id, c] of this.challenges) {
      if (c.expiresAt < now) this.challenges.delete(id);
    }
  }

  private async sendCodeEmail(to: string, code: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const subject = `Votre code de vérification LogiLink : ${code}`;

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #1f2937; max-width: 560px; margin: 0 auto;">
        <div style="background: #f97316; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px;">LogiLink – Vérification en deux étapes</h1>
        </div>
        <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Bonjour,</p>
          <p>Voici votre code de vérification pour finaliser votre connexion :</p>
          <p style="text-align:center; margin: 28px 0;">
            <span style="display:inline-block; font-family: 'Courier New', monospace; font-size: 32px; letter-spacing: 8px; font-weight: 700; color:#111827; background:#f3f4f6; padding: 14px 28px; border-radius: 8px;">
              ${code}
            </span>
          </p>
          <p>Ce code expire dans <strong>10 minutes</strong>.</p>
          <p style="color:#6b7280; font-size: 13px;">Si vous n'êtes pas à l'origine de cette tentative de connexion, vous pouvez ignorer ce message.</p>
          <p style="margin-top: 28px; font-size: 13px; color: #6b7280;">— L'équipe LogiLink</p>
        </div>
      </div>
    `;

    const text = `Votre code de vérification LogiLink est : ${code}\n\nCe code expire dans 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette tentative de connexion, ignorez ce message.`;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject,
      text,
      html,
    });
  }
}
