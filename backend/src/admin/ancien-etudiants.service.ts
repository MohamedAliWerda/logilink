import { Injectable, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { MailService } from './mail.service';

export interface SendInvitationsResult {
  attempted: number;
  sent: number;
  failed: number;
  errors: { email: string; reason: string }[];
}

@Injectable()
export class AncienEtudiantsService {
  private readonly logger = new Logger(AncienEtudiantsService.name);
  private supabase: any;

  constructor(private readonly mailService: MailService) {
    // load keys from backend/.env if present
    const envPath = path.join(process.cwd(), '.env');
    let url = process.env.SUPABASE_URL;
    let key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    try {
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).reduce((acc, line) => {
          const m = line.match(/^([^=]+)=(.*)$/);
          if (m) acc[m[1]] = m[2];
          return acc;
        }, {} as Record<string,string>);
        url = url || env.SUPABASE_URL;
        key = key || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn('Could not read .env for supabase keys: ' + message);
    }

    if (!url || !key) {
      this.logger.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY; AncienEtudiantsService will not work');
      return;
    }

    this.supabase = createClient(url, key);
  }

  async fetchAll() {
    return this.fetchTable('ancien_etudiant');
  }

  async fetchTable(table: string) {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase.from(table).select('*');
    if (error) {
      this.logger.error('Supabase fetch error: ' + error.message);
      throw new Error(error.message);
    }
    return data;
  }

  async createAncienEtudiant(payload: Record<string, unknown>) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    const row = {
      NOM: String(payload.NOM ?? payload.nom ?? payload.fullName ?? '').trim(),
      EMAIL: String(payload.EMAIL ?? payload.email ?? '').trim(),
      PROMOTION: String(payload.PROMOTION ?? payload.promotion ?? '').trim(),
      'STATUT INVITATION': String(payload['STATUT INVITATION'] ?? payload.statutInvitation ?? 'Non contacté').trim() || 'Non contacté',
      'RÉPONSE': String(payload['RÉPONSE'] ?? payload.reponse ?? 'Non répondu').trim() || 'Non répondu',
      ACTIONS: String(payload.ACTIONS ?? payload.actions ?? 'Relancer').trim() || 'Relancer',
    };

    const { data, error } = await this.supabase
      .from('ancien_etudiant')
      .insert([row])
      .select('*')
      .single();

    if (error) {
      this.logger.error('Supabase insert error: ' + error.message);
      throw new Error(error.message);
    }

    return data;
  }

  async deleteAncienEtudiant(id: string | number, explicitEmail?: string) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    // 1. Try numeric id
    const numericId = Number(id);
    if (Number.isFinite(numericId) && numericId > 0) {
      const { error } = await this.supabase
        .from('ancien_etudiant')
        .delete()
        .eq('id', numericId);

      if (error) {
        this.logger.error('Supabase delete error: ' + error.message);
        throw new Error(error.message);
      }
      return;
    }

    // 2. Use explicit email passed from the frontend
    const emailToUse =
      explicitEmail?.trim() ||
      // 3. Extract email from fallback id string (e.g. "jean-pierre@gmail.com-2023")
      (String(id).match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1] ?? '');

    if (emailToUse) {
      const { error } = await this.supabase
        .from('ancien_etudiant')
        .delete()
        .ilike('EMAIL', emailToUse);

      if (error) {
        this.logger.error('Supabase delete by email error: ' + error.message);
        throw new Error(error.message);
      }
      return;
    }

    // 4. Nothing matched — nothing to delete, treat as success
    this.logger.warn('deleteAncienEtudiant: no identifier resolved for id=' + String(id));
  }

  async createFeedback(payload: Record<string, unknown>) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    const row = {
      nom_prenom: String(payload.nom_prenom ?? payload.NOM ?? payload.nom ?? payload.fullName ?? '').trim(),
      email: String(payload.email ?? payload.EMAIL ?? '').trim(),
      promotion: String(payload.promotion ?? payload.PROMOTION ?? '').trim(),
      diplome: String(payload.diplome ?? payload.DIPLOME ?? 'Licence').trim() || 'Licence',
      filiere: String(payload.filiere ?? payload.FILIERE ?? '').trim(),
      situation_actuelle: String(payload.situation_actuelle ?? payload.SITUATION_ACTUELLE ?? 'En recherche d\'emploi').trim() || 'En recherche d\'emploi',
      secteur: String(payload.secteur ?? payload.SECTEUR ?? '').trim(),
      poste_en_lien_formation: String(payload.poste_en_lien_formation ?? payload.POSTE_EN_LIEN_FORMATION ?? 'Pas du tout en lien').trim() || 'Pas du tout en lien',
      delai_premier_emploi: String(payload.delai_premier_emploi ?? payload.DELAI_PREMIER_EMPLOI ?? 'Encore en recherche').trim() || 'Encore en recherche',
      salaire_brut_mensuel: String(payload.salaire_brut_mensuel ?? payload.SALAIRE_BRUT_MENSUEL ?? 'Ne souhaite pas').trim() || 'Ne souhaite pas',
      canal_efficace: String(payload.canal_efficace ?? payload.CANAL_EFFICACE ?? 'LinkedIn').trim() || 'LinkedIn',
      competences_techniques: String(payload.competences_techniques ?? payload.COMPETENCES_TECHNIQUES ?? '0').trim() || '0',
      competences_gestion_projet: String(payload.competences_gestion_projet ?? payload.COMPETENCES_GESTION_PROJET ?? '0').trim() || '0',
      competences_numeriques: String(payload.competences_numeriques ?? payload.COMPETENCES_NUMERIQUES ?? '0').trim() || '0',
      competences_communication: String(payload.competences_communication ?? payload.COMPETENCES_COMMUNICATION ?? '0').trim() || '0',
      maitrise_langues: String(payload.maitrise_langues ?? payload.MAITRISE_LANGUES ?? '0').trim() || '0',
      capacite_adaptation: String(payload.capacite_adaptation ?? payload.CAPACITE_ADAPTATION ?? '0').trim() || '0',
      recommandation_isgis: String(payload.recommandation_isgis ?? payload.RECOMMANDATION_ISGIS ?? '0').trim() || '0',
      message_suggestion: String(payload.message_suggestion ?? payload.MESSAGE_SUGGESTION ?? '').trim(),
    };

    const { data, error } = await this.supabase
      .from('feedback')
      .insert([row])
      .select('*')
      .single();

    if (error) {
      this.logger.error('Supabase feedback insert error: ' + error.message);
      throw new Error(error.message);
    }

    return data;
  }

  async ingestGoogleFormSubmission(payload: Record<string, any>): Promise<{ inserted: boolean; matched: boolean; email: string | null }> {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    const flat: Record<string, any> = { ...payload };
    if (payload && typeof payload === 'object' && payload['answers'] && typeof payload['answers'] === 'object') {
      Object.assign(flat, payload['answers']);
    }

    const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-zàâçéèêëîïôûùüÿñæœ0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

    const findByKeywords = (...keywords: string[][]): string => {
      const entries = Object.entries(flat);
      for (const group of keywords) {
        for (const [k, v] of entries) {
          const key = norm(k);
          if (group.every(kw => key.includes(kw))) {
            return String(v ?? '').trim();
          }
        }
      }
      return '';
    };

    const emailRaw = findByKeywords(['email'], ['adresse', 'mail'], ['mail']);
    let email = emailRaw;
    if (!email) {
      for (const v of Object.values(flat)) {
        const s = String(v ?? '').trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
          email = s;
          break;
        }
      }
    }

    const row = {
      nom_prenom: findByKeywords(['nom', 'pr'], ['nom'], ['prenom'], ['full', 'name']) || '',
      email: email || '',
      promotion: findByKeywords(['promotion'], ['promo'], ['ann']) || '',
      diplome: findByKeywords(['dipl']) || 'Licence',
      filiere: findByKeywords(['fili'], ['specialit']) || '',
      situation_actuelle: findByKeywords(['situation'], ['statut', 'emploi']) || "En recherche d'emploi",
      secteur: findByKeywords(['secteur'], ['entreprise']) || '',
      poste_en_lien_formation: findByKeywords(['lien', 'formation'], ['adequation'], ['poste', 'formation']) || 'Pas du tout en lien',
      delai_premier_emploi: findByKeywords(['delai'], ['premier', 'emploi'], ['combien', 'temps']) || 'Encore en recherche',
      salaire_brut_mensuel: findByKeywords(['salaire'], ['remuneration']) || 'Ne souhaite pas',
      canal_efficace: findByKeywords(['canal'], ['recrut']) || 'LinkedIn',
      competences_techniques: findByKeywords(['competence', 'technique'], ['technique']) || '0',
      competences_gestion_projet: findByKeywords(['gestion', 'projet']) || '0',
      competences_numeriques: findByKeywords(['numerique'], ['digital']) || '0',
      competences_communication: findByKeywords(['communication']) || '0',
      maitrise_langues: findByKeywords(['langue'], ['anglais']) || '0',
      capacite_adaptation: findByKeywords(['adaptation'], ['agilite']) || '0',
      recommandation_isgis: findByKeywords(['recommand']) || '0',
      message_suggestion: findByKeywords(['suggestion'], ['message'], ['commentaire']) || '',
    };

    const { error } = await this.supabase
      .from('feedback')
      .insert([row]);

    if (error) {
      this.logger.error('Google form feedback insert error: ' + error.message);
      throw new Error(error.message);
    }

    let matched = false;
    if (email) {
      const before = await this.supabase
        .from('ancien_etudiant')
        .select('id')
        .ilike('EMAIL', email);
      matched = Array.isArray(before?.data) && before.data.length > 0;
      await this.markResponseReceived(email);
    }

    return { inserted: true, matched, email: email || null };
  }

  async markResponseReceived(email: string): Promise<void> {
    if (!this.supabase || !email) return;
    const normalized = email.trim();
    if (!normalized) return;

    try {
      const { error } = await this.supabase
        .from('ancien_etudiant')
        .update({
          'RÉPONSE': 'A répondu',
          'STATUT INVITATION': 'Touché',
          ACTIONS: 'Voir feedback',
        })
        .ilike('EMAIL', normalized);

      if (error) {
        this.logger.warn('Could not mark response received for ' + normalized + ': ' + error.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn('markResponseReceived failed: ' + msg);
    }
  }

  async sendSingleInvitation(id: string | number, subject: string, message: string): Promise<{ sent: boolean }> {
    if (!this.supabase) throw new Error('Supabase client is not configured');

    let row: Record<string, any> | null = null;

    const numericId = Number(id);
    if (Number.isFinite(numericId) && numericId > 0) {
      const { data, error } = await this.supabase
        .from('ancien_etudiant')
        .select('*')
        .eq('id', numericId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      row = data ?? null;
    }

    // Fallback: id may be an email-based string (e.g. "jean-pierre@gmail.com-2023")
    if (!row) {
      const emailMatch = String(id).match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
      const emailPart = emailMatch?.[1] ?? '';
      if (emailPart) {
        const { data, error } = await this.supabase
          .from('ancien_etudiant')
          .select('*')
          .ilike('EMAIL', emailPart)
          .maybeSingle();
        if (error) throw new Error(error.message);
        row = data ?? null;
      }
    }

    if (!row) throw new Error('Ancien étudiant introuvable');

    const email = String(row.EMAIL ?? row.email ?? '').trim();
    if (!email) throw new Error('Email manquant pour cet ancien diplômé');

    const namePart = `${row.prenom ?? row.PRENOM ?? ''} ${row.nom ?? row.NOM ?? ''}`.trim();
    const fullName = (row.NOM ?? namePart ?? email).toString();

    await this.mailService.sendInvitation(email, fullName, subject, message);

    // Update by whichever key we have
    const updateQuery = Number.isFinite(numericId) && numericId > 0
      ? this.supabase.from('ancien_etudiant').update({ 'STATUT INVITATION': 'Touché', ACTIONS: 'Relancer' }).eq('id', numericId)
      : this.supabase.from('ancien_etudiant').update({ 'STATUT INVITATION': 'Touché', ACTIONS: 'Relancer' }).ilike('EMAIL', email);
    await updateQuery;

    return { sent: true };
  }

  async sendInvitationsToUncontacted(subject: string, message: string): Promise<SendInvitationsResult> {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { data, error } = await this.supabase
      .from('ancien_etudiant')
      .select('*');

    if (error) {
      this.logger.error('Supabase fetch error: ' + error.message);
      throw new Error(error.message);
    }

    const rows = (data ?? []) as Record<string, any>[];
    const targets = rows.filter(r => this.isUncontacted(r));

    const result: SendInvitationsResult = {
      attempted: targets.length,
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (const row of targets) {
      const email = String(row.EMAIL ?? row.email ?? '').trim();
      const namePart = `${row.prenom ?? row.PRENOM ?? ''} ${row.nom ?? row.NOM ?? ''}`.trim();
      const fullName = (row.NOM ?? namePart ?? email).toString();

      if (!email) {
        result.failed += 1;
        result.errors.push({ email: '(vide)', reason: 'Email manquant' });
        continue;
      }

      try {
        await this.mailService.sendInvitation(email, fullName, subject, message);

        const { error: updateError } = await this.supabase
          .from('ancien_etudiant')
          .update({ 'STATUT INVITATION': 'Touché', ACTIONS: 'Relancer' })
          .eq('EMAIL', email);

        if (updateError) {
          this.logger.warn('Email sent but DB update failed for ' + email + ': ' + updateError.message);
        }

        result.sent += 1;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.error('Failed to send to ' + email + ': ' + reason);
        result.failed += 1;
        result.errors.push({ email, reason });
      }
    }

    return result;
  }

  private isUncontacted(row: Record<string, any>): boolean {
    const statut = String(row['STATUT INVITATION'] ?? row['STATUT_INVITATION'] ?? row.statut ?? row.status ?? '').trim().toLowerCase();
    const reponse = String(row['RÉPONSE'] ?? row['REPONSE'] ?? row.response ?? row.reponse ?? '').trim().toLowerCase();

    const hasResponded = /(^|[^a-z])(a|à)\s*r[ée]pondu/.test(reponse)
      || ((reponse.includes('répondu') || reponse.includes('repondu')) && !reponse.includes('non'));

    if (hasResponded) {
      return false;
    }

    if (statut.includes('non')) {
      return true;
    }

    if (statut.includes('invit')) {
      return false;
    }

    return true;
  }
}
