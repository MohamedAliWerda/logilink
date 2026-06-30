import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

interface SmtpEnv {
  user: string;
  pass: string;
  fromName: string;
  formUrl: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
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
      fromName: process.env.SMTP_FROM_NAME ?? fileEnv['SMTP_FROM_NAME'] ?? 'ISGIS',
      formUrl: process.env.FEEDBACK_FORM_URL ?? fileEnv['FEEDBACK_FORM_URL'] ?? 'http://localhost:4200/feedback-ancien',
    };

    if (!this.env.user || !this.env.pass) {
      this.logger.error('Missing SMTP_USER or SMTP_PASS; MailService will not send emails.');
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

  get formUrl(): string {
    return this.env.formUrl;
  }

  async sendInvitation(to: string, fullName: string, subject: string, message: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const linkPlaceholder = '[Lien vers le formulaire]';
    const link = this.env.formUrl;
    const bodyText = message.includes(linkPlaceholder)
      ? message.replace(linkPlaceholder, link)
      : `${message}\n\n${link}`;

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #1f2937;">
        <p>Bonjour ${this.escapeHtml(fullName)},</p>
        <div style="white-space: pre-line;">${this.escapeHtml(message).replace(this.escapeHtml(linkPlaceholder), '')}</div>
        <p style="margin-top: 20px;">
          <a href="${link}" style="background:#f97316;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Répondre au questionnaire</a>
        </p>
        <p style="margin-top: 12px; font-size: 12px; color:#6b7280;">
          Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br/>
          <a href="${link}">${link}</a>
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject,
      text: bodyText,
      html,
    });
  }

  async sendCompanyPending(to: string, companyName: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const subject = 'Votre demande d\'inscription LogiLink est en cours de traitement';

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto;">
        <div style="background: #f97316; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px;">LogiLink – Demande reçue</h1>
        </div>
        <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Bonjour <strong>${this.escapeHtml(companyName)}</strong>,</p>
          <p>
            Nous avons bien reçu votre demande d'inscription sur la plateforme <strong>LogiLink</strong>.
          </p>
          <p>
            Votre compte est actuellement <span style="color:#f97316;font-weight:600;">en attente de validation</span> par notre équipe administrative.
            Vous recevrez un email de confirmation dès que votre compte sera approuvé.
          </p>
          <div style="background:#fef9f0;border-left:4px solid #f97316;padding:14px 18px;border-radius:4px;margin:20px 0;">
            <p style="margin:0;font-size:14px;">
              Le délai de validation est généralement de <strong>24 à 48 heures ouvrables</strong>.
            </p>
          </div>
          <p>
            Si vous avez des questions, n'hésitez pas à contacter notre équipe.
          </p>
          <p style="margin-top: 32px; font-size: 13px; color: #6b7280;">
            Merci de votre confiance.<br/>
            — L'équipe LogiLink / ISGI
          </p>
        </div>
      </div>
    `;

    const text = `Bonjour ${companyName},\n\nNous avons bien reçu votre demande d'inscription sur LogiLink. Votre compte est en attente de validation par notre équipe. Vous recevrez un email de confirmation sous 24 à 48 heures ouvrables.\n\n— L'équipe LogiLink / ISGI`;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject,
      text,
      html,
    });
  }

  async sendCompanyRejection(to: string, companyName: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const subject = 'Votre demande d\'inscription sur LogiLink';

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto;">
        <div style="background: #6b7280; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px;">LogiLink – Décision sur votre demande</h1>
        </div>
        <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Bonjour <strong>${this.escapeHtml(companyName)}</strong>,</p>
          <p>
            Nous avons bien examiné votre demande d'inscription sur la plateforme <strong>LogiLink</strong>.
          </p>
          <p>
            Après étude de votre dossier, nous sommes au regret de vous informer que votre demande n'a pas pu être
            <span style="color:#dc2626;font-weight:600;">acceptée</span> à ce stade.
          </p>
          <p>
            Si vous souhaitez obtenir plus d'informations ou soumettre une nouvelle candidature, nous vous invitons à nous contacter directement.
          </p>
          <p style="margin-top: 32px; font-size: 13px; color: #6b7280;">
            Nous vous remercions de l'intérêt que vous portez à notre plateforme.<br/>
            — L'équipe LogiLink / ISGI
          </p>
        </div>
      </div>
    `;

    const text = `Bonjour ${companyName},\n\nAprès examen de votre dossier, nous ne sommes pas en mesure d'accepter votre demande d'inscription sur LogiLink à ce stade.\n\nPour plus d'informations, contactez-nous directement.\n\n— L'équipe LogiLink / ISGI`;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject,
      text,
      html,
    });
  }

  async sendCompanyApproval(to: string, companyName: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const subject = 'Votre compte LogiLink a été approuvé';

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto;">
        <div style="background: #f97316; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px;">LogiLink – Confirmation d'approbation</h1>
        </div>
        <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Bonjour <strong>${this.escapeHtml(companyName)}</strong>,</p>
          <p>
            Nous avons le plaisir de vous informer que votre compte société sur la plateforme
            <strong>LogiLink</strong> a été <span style="color:#16a34a;font-weight:600;">approuvé</span>.
          </p>
          <p>Vous pouvez dès à présent accéder à votre espace et commencer à publier vos offres de stage et d'emploi.</p>
          <p style="margin-top: 28px; text-align: center;">
            <a href="http://localhost:4200/entreprise/loginen"
               style="background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
              Accéder à mon espace
            </a>
          </p>
          <p style="margin-top: 32px; font-size: 13px; color: #6b7280;">
            Si vous avez des questions, n'hésitez pas à nous contacter.<br/>
            — L'équipe LogiLink / ISGI
          </p>
        </div>
      </div>
    `;

    const text = `Bonjour ${companyName},\n\nVotre compte société sur LogiLink a été approuvé. Vous pouvez maintenant accéder à votre espace.\n\n— L'équipe LogiLink / ISGI`;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject,
      text,
      html,
    });
  }

  /**
   * Send a feedback-reminder email.
   * @param isRenewal – when true the email mentions this is a new feedback window
   *                    (the company may have already responded once before).
   */
  async sendFeedbackReminder(
    to: string,
    companyName: string,
    postTitle: string,
    feedbackUrl: string,
    isRenewal = false,
  ): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const subject = isRenewal
      ? `LogiLink – Nouveau suivi disponible : ${postTitle}`
      : `LogiLink – Votre retour sur l'offre : ${postTitle}`;

    const introLine = isRenewal
      ? `Une nouvelle période de <strong>6 mois</strong> s'est écoulée depuis votre dernière notification concernant l'offre <em>« ${this.escapeHtml(postTitle)} »</em>.`
      : `Cela fait maintenant plus de <strong>6 mois</strong> que vous avez publié l'offre <em>« ${this.escapeHtml(postTitle)} »</em> sur la plateforme <strong>LogiLink</strong>.`;

    const ctaLine = isRenewal
      ? `La section <strong>Feedback</strong> a été rouverte dans votre espace. Vous pouvez nous faire part d'une mise à jour de la situation du diplômé ou d'un nouveau recrutement.`
      : `Dans le cadre du suivi pédagogique de l'ISGIS, une section <strong>Feedback</strong> est désormais disponible dans votre espace. Nous vous invitons à la remplir afin de nous aider à améliorer l'accompagnement de nos étudiants.`;

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto;">
        <div style="background: #f97316; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px;">
            LogiLink – ${isRenewal ? 'Nouvelle période de feedback' : 'Section Feedback disponible'}
          </h1>
        </div>
        <div style="background: #fff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Bonjour <strong>${this.escapeHtml(companyName)}</strong>,</p>
          <p>${introLine}</p>
          <p>${ctaLine}</p>
          <p style="margin-top: 28px; text-align: center;">
            <a href="${feedbackUrl}"
               style="background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
              Accéder au formulaire de feedback
            </a>
          </p>
          <p style="margin-top: 16px; font-size: 13px; color: #6b7280;">
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br/>
            <a href="${feedbackUrl}">${feedbackUrl}</a>
          </p>
          <p style="margin-top: 32px; font-size: 13px; color: #6b7280;">
            Merci de votre confiance et de votre collaboration.<br/>
            — L'équipe LogiLink / ISGIS
          </p>
        </div>
      </div>
    `;

    const renewalNote = isRenewal
      ? 'Une nouvelle période de feedback est ouverte — vous pouvez nous transmettre une mise à jour.'
      : 'Une section Feedback est maintenant disponible dans votre espace LogiLink.';

    const text = `Bonjour ${companyName},\n\n${isRenewal ? `Une nouvelle période de 6 mois s'est écoulée pour l'offre « ${postTitle} ».` : `Cela fait plus de 6 mois que vous avez publié l'offre « ${postTitle} ».`}\n${renewalNote}\n\nAccédez au formulaire : ${feedbackUrl}\n\n— L'équipe LogiLink / ISGIS`;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject,
      text,
      html,
    });
  }

  async sendResetCode(to: string, companyName: string, code: string): Promise<void> {
    if (!this.transporter) throw new Error('SMTP transporter not configured');

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:600px;margin:0 auto;">
        <div style="background:#f97316;padding:24px 32px;border-radius:8px 8px 0 0;">
          <h1 style="color:#fff;margin:0;font-size:20px;">LogiLink – Réinitialisation du mot de passe</h1>
        </div>
        <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p>Bonjour <strong>${this.escapeHtml(companyName)}</strong>,</p>
          <p>Vous avez demandé la réinitialisation de votre mot de passe sur <strong>LogiLink</strong>.</p>
          <p>Voici votre code de vérification (valable <strong>10 minutes</strong>) :</p>
          <div style="text-align:center;margin:28px 0;">
            <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#f97316;">${this.escapeHtml(code)}</span>
          </div>
          <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
          <p style="margin-top:32px;font-size:13px;color:#6b7280;">— L'équipe LogiLink / ISGIS</p>
        </div>
      </div>`;

    await this.transporter.sendMail({
      from: `"${this.env.fromName}" <${this.env.user}>`,
      to,
      subject: 'LogiLink – Code de réinitialisation de mot de passe',
      text: `Bonjour ${companyName},\n\nVotre code de réinitialisation : ${code}\n(valable 10 minutes)\n\n— L'équipe LogiLink / ISGIS`,
      html,
    });
  }

  private escapeHtml(input: string): string {
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
