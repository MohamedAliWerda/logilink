import { Injectable, Logger } from '@nestjs/common';
import { getSupabase } from '../config/supabase.client';

export interface TopGapItem {
  label: string;
  marketPct: number;
  coverPct: number;
  count: number;
}

export interface DashboardStudent {
  id: string;
  authId: string;
  name: string;
  speciality: string;
  score: number;
  employabilityScore: number;
  employabilityScoreRaw?: string;
  details: {
    matchings: string[];
    gaps: string[];
    recommendations: string[];
  };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly supabase = getSupabase();

  async getTopGaps(): Promise<TopGapItem[]> {
    const [{ data: competenceData, error: competenceError }, { data: metierData, error: metierError }] = await Promise.all([
      this.supabase
        .from('cv_matching_competence_results')
        .select('auth_id, competence_name, status, similarity_score, is_top_metier')
        .eq('is_top_metier', true),
      this.supabase
        .from('cv_matching_metier_scores')
        .select('auth_id')
        .eq('rank_position', 1),
    ]);

    if (competenceError) {
      this.logger.error('top-gaps competence fetch failed: ' + competenceError.message);
      throw new Error(competenceError.message);
    }
    if (metierError) {
      this.logger.error('top-gaps metier fetch failed: ' + metierError.message);
      throw new Error(metierError.message);
    }

    const totalStudents = new Set((metierData ?? []).map((row: any) => String(row.auth_id ?? ''))).size;
    if (totalStudents === 0) return [];

    const grouped = new Map<string, { authIds: Set<string>; sumSimilarity: number; count: number; gapAuthIds: Set<string> }>();
    for (const row of competenceData ?? []) {
      const label = String(row.competence_name ?? '').trim();
      if (!label) continue;
      const authId = String(row.auth_id ?? '');
      const entry = grouped.get(label) ?? {
        authIds: new Set<string>(),
        sumSimilarity: 0,
        count: 0,
        gapAuthIds: new Set<string>(),
      };
      entry.authIds.add(authId);
      entry.sumSimilarity += Math.max(0, Math.min(1, Number(row.similarity_score ?? 0)));
      entry.count += 1;
      if (row.status === 'gap') {
        entry.gapAuthIds.add(authId);
      }
      grouped.set(label, entry);
    }

    const items: TopGapItem[] = [];
    for (const [label, info] of grouped.entries()) {
      const marketPct = this.round1((info.authIds.size / totalStudents) * 100);
      const coverPct = info.count > 0 ? this.round1((info.sumSimilarity / info.count) * 100) : 0;
      items.push({ label, marketPct, coverPct, count: info.gapAuthIds.size });
    }

    items.sort((a, b) => b.marketPct - a.marketPct || b.count - a.count);
    return items.slice(0, 6);
  }

  async getFeedbackSocieteRows(): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.supabase
      .from('feedback_societe')
      .select('*');
    if (error) {
      this.logger.error('feedback_societe fetch failed: ' + error.message);
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return [];

    // Join with Societe to enrich each row with company name + sector. We
    // do this server-side because the Societe table has RLS.
    const societeIds = [...new Set(
      rows
        .map((r: any) => Number(r?.id_soc))
        .filter((id: number) => Number.isInteger(id) && id > 0),
    )];

    if (societeIds.length === 0) return rows;

    const { data: societeRows } = await this.supabase
      .from('Societe')
      .select('id, denomination_sociale, secteur_activite')
      .in('id', societeIds);

    const societeById = new Map<number, { denomination_sociale?: string; secteur_activite?: string }>();
    for (const row of (societeRows ?? []) as any[]) {
      const id = Number(row?.id);
      if (Number.isInteger(id)) {
        societeById.set(id, {
          denomination_sociale: row?.denomination_sociale,
          secteur_activite: row?.secteur_activite,
        });
      }
    }

    return rows.map((row: any) => ({
      ...row,
      Societe: societeById.get(Number(row?.id_soc)) ?? null,
    }));
  }

  async getRecentStudents(limit = 5): Promise<DashboardStudent[]> {
    // Fetch students ordered by employability score (score_final) descending
    const { data: scoreRows, error: scoreError } = await this.supabase
      .from('score_employabilité')
      .select('etudiant, score_final')
      .order('score_final', { ascending: false })
      .limit(Math.max(1, Math.min(500, limit)));
    if (scoreError) {
      this.logger.error('score_employabilité fetch failed: ' + scoreError.message);
      throw new Error(scoreError.message);
    }

    const scores = scoreRows ?? [];
    if (scores.length === 0) return [];

    const etudiantIds = Array.from(new Set(scores.map((r: any) => String(r.etudiant ?? '')).filter(Boolean)));

    // Fetch users by internal id (etudiant)
    const [users, metierScores, competenceResults, recommendationTargets, recommendations] = await Promise.all([
      this.fetchUsersByIds(etudiantIds),
      this.fetchTopMetierScores([]),
      this.fetchCompetenceResults([]),
      this.fetchRecommendationTargets([]),
      this.fetchRecommendationRows(),
    ]);

    const userById = new Map<string, { authId: string; id: string; cinPassport: string; email: string; nom: string; prenom: string; filiere: string }>();
    for (const u of users) {
      userById.set(u.id, u);
    }

    const profileByCin = await this.fetchProfilesByCin(Array.from(userById.values()).map((u) => u.cinPassport).filter(Boolean));

    const metierByAuth = new Map<string, any[]>();
    for (const row of metierScores) {
      const list = metierByAuth.get(String(row.auth_id)) ?? [];
      list.push(row);
      metierByAuth.set(String(row.auth_id), list);
    }
    for (const list of metierByAuth.values()) {
      list.sort((a, b) => Number(a.rank_position ?? 99) - Number(b.rank_position ?? 99));
    }

    const competenceByAuth = new Map<string, any[]>();
    for (const row of competenceResults) {
      const list = competenceByAuth.get(String(row.auth_id)) ?? [];
      list.push(row);
      competenceByAuth.set(String(row.auth_id), list);
    }

    const recommendationsById = new Map<string, any>();
    for (const r of recommendations) {
      recommendationsById.set(String(r.id), r);
    }

    const recommendationLabelsByAuth = new Map<string, string[]>();
    for (const target of recommendationTargets) {
      const authId = String(target.auth_id ?? '');
      const recommendation = recommendationsById.get(String(target.recommendation_id ?? ''));
      if (!authId || !recommendation) continue;
      const label =
        String(recommendation.cert_title ?? '').trim() ||
        String(recommendation.gap_title ?? '').trim() ||
        String(recommendation.competence_name ?? '').trim();
      if (!label) continue;
      const list = recommendationLabelsByAuth.get(authId) ?? [];
      if (!list.includes(label)) list.push(label);
      recommendationLabelsByAuth.set(authId, list);
    }

    const result: DashboardStudent[] = [];
    for (const row of scores) {
      if (result.length >= limit) break;
      const etudiant = String(row.etudiant ?? '');
      if (!etudiant) continue;
      const userInfo = userById.get(etudiant);
      const profile = userInfo?.cinPassport ? profileByCin.get(String(userInfo.cinPassport)) : undefined;

      const userName = `${(userInfo?.prenom ?? '').trim()} ${(userInfo?.nom ?? '').trim()}`.trim();
      const profileName = `${(profile?.prenom ?? '').trim()} ${(profile?.nom ?? '').trim()}`.trim();
      const fullName = userName || profileName || this.deriveNameFromEmail(userInfo?.email ?? '') || 'Étudiant';

      const filiere = (userInfo?.filiere ?? '').trim() || (profile?.filiere ?? '').trim() || 'Non renseignée';

      // Attempt to get CV ATS score for this user (by auth_id)
      let atsScore = 0;
      const authId = userInfo?.authId ?? '';
      if (authId) {
        const { data: latestCv } = await this.supabase
          .from('cv_submissions')
          .select('ats_score')
          .eq('auth_id', authId)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (latestCv && latestCv[0]) atsScore = Number(latestCv[0].ats_score ?? 0);
      }

      const matchings = (metierByAuth.get(authId) ?? [])
        .slice(0, 3)
        .map((r) => String(r.metier_name ?? '').trim())
        .filter(Boolean);

      const gaps = (competenceByAuth.get(authId) ?? [])
        .filter((r) => r.status === 'gap')
        .sort((a, b) => Number(a.similarity_score ?? 0) - Number(b.similarity_score ?? 0))
        .slice(0, 3)
        .map((r) => String(r.competence_name ?? '').trim())
        .filter(Boolean);

      const recos = (recommendationLabelsByAuth.get(authId) ?? []).slice(0, 3);

      result.push({
        id: etudiant,
        authId: authId || '',
        name: fullName,
        speciality: filiere,
        score: this.roundScore(atsScore),
        employabilityScore: this.roundScore(row.score_final),
        employabilityScoreRaw: row.score_final != null ? String(row.score_final) : undefined,
        details: {
          matchings: matchings.length ? matchings : ['Aucun métier identifié'],
          gaps: gaps.length ? gaps : ['Aucun gap critique'],
          recommendations: recos.length ? recos : ['Aucune recommandation disponible'],
        },
      });
    }

    return result;
  }

  private async fetchUsersByIds(ids: string[]): Promise<Array<{ authId: string; id: string; cinPassport: string; email: string; nom: string; prenom: string; filiere: string }>> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('user')
      .select('*')
      .in('id', ids);
    if (error) {
      this.logger.warn('fetchUsersByIds failed: ' + error.message);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      authId: String(row.auth_id ?? ''),
      id: row.id != null ? String(row.id) : '',
      cinPassport: row.cin_passport != null ? String(row.cin_passport) : '',
      email: String(row.email ?? ''),
      nom: String(row.nom ?? row.last_name ?? ''),
      prenom: String(row.prenom ?? row.first_name ?? ''),
      filiere: String(row.filiere ?? row.specialite ?? row.specialty ?? row.specialization ?? ''),
    }));
  }

  private async fetchUsers(authIds: string[]): Promise<Array<{ authId: string; id: string; cinPassport: string; email: string; nom: string; prenom: string; filiere: string }>> {
    if (!authIds.length) return [];
    const { data, error } = await this.supabase
      .from('user')
      .select('*')
      .in('auth_id', authIds);
    if (error) {
      this.logger.warn('user fetch failed: ' + error.message);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      authId: String(row.auth_id ?? ''),
      id: row.id != null ? String(row.id) : '',
      cinPassport: row.cin_passport != null ? String(row.cin_passport) : '',
      email: String(row.email ?? ''),
      nom: String(row.nom ?? row.last_name ?? ''),
      prenom: String(row.prenom ?? row.first_name ?? ''),
      filiere: String(row.filiere ?? row.specialite ?? row.specialty ?? row.specialization ?? ''),
    }));
  }

  private async fetchProfilesByCin(cinList: string[]): Promise<Map<string, { nom: string; prenom: string; filiere: string; cin_passport: string }>> {
    const result = new Map<string, { nom: string; prenom: string; filiere: string; cin_passport: string }>();
    if (!cinList.length) return result;
    const { data, error } = await this.supabase
      .from('profils_etudiant')
      .select('cin_passport, nom, prenom, filiere')
      .in('cin_passport', cinList);
    if (error) {
      this.logger.warn('profils_etudiant fetch failed: ' + error.message);
      return result;
    }
    for (const row of data ?? []) {
      result.set(String(row.cin_passport), {
        nom: String(row.nom ?? ''),
        prenom: String(row.prenom ?? ''),
        filiere: String(row.filiere ?? ''),
        cin_passport: String(row.cin_passport ?? ''),
      });
    }
    return result;
  }

  private async fetchTopMetierScores(authIds: string[]): Promise<any[]> {
    if (!authIds.length) return [];
    const { data, error } = await this.supabase
      .from('cv_matching_metier_scores')
      .select('auth_id, metier_name, rank_position, coverage_pct')
      .in('auth_id', authIds);
    if (error) {
      this.logger.warn('cv_matching_metier_scores fetch failed: ' + error.message);
      return [];
    }
    return data ?? [];
  }

  private async fetchCompetenceResults(authIds: string[]): Promise<any[]> {
    if (!authIds.length) return [];
    const { data, error } = await this.supabase
      .from('cv_matching_competence_results')
      .select('auth_id, competence_name, status, similarity_score, is_top_metier')
      .in('auth_id', authIds)
      .eq('is_top_metier', true);
    if (error) {
      this.logger.warn('cv_matching_competence_results fetch failed: ' + error.message);
      return [];
    }
    return data ?? [];
  }

  private async fetchRecommendationTargets(authIds: string[]): Promise<any[]> {
    if (!authIds.length) return [];
    const { data, error } = await this.supabase
      .from('ai_recommendation_targets')
      .select('auth_id, recommendation_id')
      .in('auth_id', authIds);
    if (error) {
      this.logger.warn('ai_recommendation_targets fetch failed: ' + error.message);
      return [];
    }
    return data ?? [];
  }

  private async fetchRecommendationRows(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .select('id, cert_title, gap_title, competence_name, status')
      .neq('status', 'rejected');
    if (error) {
      this.logger.warn('ai_recommendations fetch failed: ' + error.message);
      return [];
    }
    return data ?? [];
  }

  private async fetchEmployabilityScores(etudiantIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!etudiantIds.length) return result;
    const { data, error } = await this.supabase
      .from('score_employabilité')
      .select('etudiant, score_final')
      .in('etudiant', etudiantIds);
    if (error) {
      this.logger.warn('score_employabilité fetch failed: ' + error.message);
      return result;
    }
    for (const row of data ?? []) {
      const key = String(row.etudiant ?? '');
      if (!key) continue;
      // Preserve raw value as string so callers can display exact decimal representation
      const raw = row.score_final != null ? String(row.score_final) : '';
      if (raw !== '') result.set(key, raw);
    }
    return result;
  }

  private deriveNameFromEmail(email: string): string {
    const local = String(email ?? '').split('@')[0]?.trim() ?? '';
    if (!local) return '';
    const parts = local
      .split(/[._-]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
    return parts.join(' ');
  }

  private roundScore(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  private round1(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.max(0, Math.min(100, value)).toFixed(1));
  }
}
