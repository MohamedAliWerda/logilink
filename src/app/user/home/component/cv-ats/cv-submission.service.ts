import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../../../environments/environment';

export interface CvPayload {
  professionalTitle: string;
  metierId?: string;
  specialization: string;
  objectif: string;
  atsScore: number;
  consentGiven: boolean;
  info: {
    permis: string;
    linkedin: string;
    dateNaissance: string;
    photoUrl?: string;
  };
  formations: any[];
  experiences: any[];
  hardSkills: any[];
  softSkills: any[];
  langues: any[];
  projets: any[];
  certifications: any[];
  engagements: any[];
}

export interface AtsScoreResponse {
  matchScore: number;
  successScore: number;
  atsScore: number;
  rawResponse?: string;
}

export interface EmployabilityScoreResponse {
  found: boolean;
  scoreFinal: number | null;
}

export interface MatchingTopSkill {
  skill: string;
  score: number;
}

export interface MatchingMetierRankingEntry {
  metier: string;
  domaine: string;
  nCompetences: number;
  matched: number;
  coveragePct: number;
  avgScore: number;
  topSkills: MatchingTopSkill[];
}

export interface MatchingGapEntry {
  refCompetence: string;
  refMetier: string;
  refDomaine: string;
  refType: string;
  refMotsCles: string;
  bestCvSkill: string;
  bestCvNiveau: string;
  similarityScore: number;
  status: 'match' | 'gap';
}

export interface MatchingAnalysisSummary {
  nSkills: number;
  nMatches: number;
  nGaps: number;
  matchRatePct: number;
}

export interface MatchingAnalysisResponse {
  cvSubmissionId: string;
  selectedMetierId: string;
  generatedAt: string;
  modelName: string;
  threshold: number;
  summary: MatchingAnalysisSummary;
  topMetier: MatchingMetierRankingEntry | null;
  metierRanking: MatchingMetierRankingEntry[];
  matches: MatchingGapEntry[];
  gaps: MatchingGapEntry[];
  topMetierGaps: MatchingGapEntry[];
}

export interface MatchingTraceMetierScore {
  id: string;
  analysisId: string;
  cvSubmissionId: string;
  authId: string;
  rankPosition: number;
  metierName: string;
  domaineName: string;
  nCompetences: number;
  matchedCompetences: number;
  coveragePct: number;
  avgScore: number;
  topSkills: MatchingTopSkill[];
  createdAt: string;
}

export interface MatchingTraceCompetenceResult {
  id: string;
  analysisId: string;
  cvSubmissionId: string;
  authId: string;
  metierName: string;
  domaineName: string;
  metierRank: number | null;
  isTopMetier: boolean;
  status: 'match' | 'gap';
  sourceBucket: string;
  competenceName: string;
  competenceType: string;
  keywords: string;
  bestCvSkill: string;
  bestCvLevel: string;
  similarityScore: number;
  createdAt: string;
}

export interface MatchingAnalysisTraceResponse {
  analysis: MatchingAnalysisResponse;
  analysisId: string | null;
  analysisFingerprint: string;
  metierScores: MatchingTraceMetierScore[];
  competenceResults: MatchingTraceCompetenceResult[];
}

@Injectable({ providedIn: 'root' })
export class CvSubmissionService {
  private supabase: SupabaseClient;
  private readonly cvExistsCacheKey = 'cv_exists_cached';
  private readonly cvExistsCachedAtKey = 'cv_exists_cached_at';
  private readonly cvExistsCachedUserKey = 'cv_exists_cached_user';
  private readonly matchingAnalysisCacheKey = 'latest_matching_analysis';
  private readonly matchingTraceCacheKey = 'latest_matching_trace';
  private readonly cvExistsCacheTtlMs = 1000 * 60 * 60 * 24 * 30;
  private cvFetchInFlight: Promise<any | null> | null = null;
  private cvFetchInFlightKey: string | null = null;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  private getCurrentCacheUser(): string {
    try {
      const rawUser = localStorage.getItem('user');
      if (rawUser) {
        const user = JSON.parse(rawUser) as Record<string, any>;
        const candidate =
          user?.['auth_id']
          ?? user?.['id']
          ?? user?.['userId']
          ?? user?.['cin_passport']
          ?? user?.['email'];

        if (candidate !== undefined && candidate !== null) {
          const normalized = String(candidate).trim();
          if (normalized.length > 0) {
            return normalized;
          }
        }
      }
    } catch {
      // ignore user parse/storage errors
    }

    const token = localStorage.getItem('token');
    if (token && token.length > 0) {
      return `token:${token.slice(0, 24)}`;
    }

    return 'anonymous';
  }

  private setCvExistsCache(exists: boolean): void {
    try {
      if (exists) {
        localStorage.setItem(this.cvExistsCacheKey, '1');
        localStorage.setItem(this.cvExistsCachedAtKey, String(Date.now()));
        localStorage.setItem(this.cvExistsCachedUserKey, this.getCurrentCacheUser());
        return;
      }

      localStorage.removeItem(this.cvExistsCacheKey);
      localStorage.removeItem(this.cvExistsCachedAtKey);
      localStorage.removeItem(this.cvExistsCachedUserKey);
    } catch {
      // ignore localStorage failures
    }
  }

  hasCachedCv(): boolean {
    try {
      if (localStorage.getItem(this.cvExistsCacheKey) !== '1') {
        return false;
      }

      const cachedUser = localStorage.getItem(this.cvExistsCachedUserKey);
      const currentUser = this.getCurrentCacheUser();
      if (!cachedUser || cachedUser !== currentUser) {
        this.setCvExistsCache(false);
        return false;
      }

      const rawTs = localStorage.getItem(this.cvExistsCachedAtKey);
      const ts = Number(rawTs);
      if (!Number.isFinite(ts)) {
        this.setCvExistsCache(false);
        return false;
      }

      const isFresh = (Date.now() - ts) < this.cvExistsCacheTtlMs;
      if (!isFresh) {
        this.setCvExistsCache(false);
      }

      return isFresh;
    } catch {
      return false;
    }
  }

  isAuthRequiredError(error: unknown): boolean {
    const message = String((error as any)?.message ?? '');
    return message.includes('AUTH_REQUIRED');
  }

  private async getAuthToken(): Promise<string | null> {
    const localToken = localStorage.getItem('token');
    if (localToken && localToken.trim().length > 0) {
      return localToken;
    }

    try {
      const sessionRes = await this.supabase.auth.getSession();
      let token = sessionRes?.data?.session?.access_token;
      if (!token) {
        token = undefined;
      }
      return token ?? null;
    } catch {
      return localStorage.getItem('token');
    }
  }

  private getStoredStudentCinPassport(): string | null {
    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return null;

      const user = JSON.parse(rawUser) as Record<string, any>;
      const candidate = user?.['cin_passport'] ?? user?.['cinPassport'];
      if (candidate === undefined || candidate === null) return null;

      const cin = String(candidate).trim();
      return cin.length > 0 ? cin : null;
    } catch {
      return null;
    }
  }

  async fetchStudentCinPassport(): Promise<string | null> {
    const fallbackCin = this.getStoredStudentCinPassport();
    if (!fallbackCin) return null;

    try {
      const { data, error } = await this.supabase
        .from('profils_etudiant')
        .select('cin_passport')
        .eq('cin_passport', fallbackCin)
        .maybeSingle();

      if (error) {
        console.warn('[CvSubmissionService] fetchStudentCinPassport error', error);
        return fallbackCin;
      }

      const cinPassport = data?.['cin_passport'];
      if (cinPassport === undefined || cinPassport === null) return fallbackCin;

      const resolved = String(cinPassport).trim();
      return resolved.length > 0 ? resolved : fallbackCin;
    } catch (err) {
      console.warn('[CvSubmissionService] fetchStudentCinPassport failed', err);
      return fallbackCin;
    }
  }

  async upsertCv(payload: CvPayload): Promise<void> {
    try {
      // try server-side endpoint first
      const token = await this.getAuthToken();
      if (!token) {
        throw new Error('AUTH_REQUIRED');
      }

      const resp = await fetch(`${environment.apiUrl}/cv-submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const text = await resp.text();
        const message = `Server CV save failed (${resp.status}): ${text}`;
        if (resp.status === 401 || resp.status === 403) {
          throw new Error(`AUTH_REQUIRED: ${message}`);
        }
        console.error(message);
        throw new Error(message);
      }

      this.setCvExistsCache(true);
    } catch (err) {
      console.error('CvSubmissionService.upsertCv error', err);
      throw err;
    }
  }

  async calculateAtsScore(payload: CvPayload): Promise<AtsScoreResponse> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Utilisateur non authentifie.');
    }

    const resp = await fetch(`${environment.apiUrl}/cv-submissions/ats-score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`ATS score API failed (${resp.status}): ${text}`);
    }

    const json = await resp.json();
    const data = json?.data ?? json;

    const clamp = (value: any) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    };

    return {
      matchScore: clamp(data?.matchScore),
      successScore: clamp(data?.successScore),
      atsScore: clamp(data?.atsScore),
      rawResponse: typeof data?.rawResponse === 'string' ? data.rawResponse : undefined,
    };
  }

  async fetchMyEmployabilityScore(): Promise<EmployabilityScoreResponse> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Utilisateur non authentifie.');
    }

    const resp = await fetch(`${environment.apiUrl}/cv-submissions/employability-score`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Employability score API failed (${resp.status}): ${text}`);
    }

    const json = await resp.json();
    const data = json?.data ?? json;
    const raw = data?.scoreFinal;
    const score = raw === null || raw === undefined
      ? null
      : Math.max(0, Math.min(100, Number((Number(raw) || 0).toFixed(2))));

    return {
      found: Boolean(data?.found) && score !== null,
      scoreFinal: score,
    };
  }

  async fetchMyCv(metierId?: string): Promise<any | null> {
    const normalizedMetierId = String(metierId ?? '').trim();
    const requestKey = normalizedMetierId.length > 0 ? normalizedMetierId : '__default__';

    if (this.cvFetchInFlight && this.cvFetchInFlightKey === requestKey) {
      return this.cvFetchInFlight;
    }

    this.cvFetchInFlightKey = requestKey;
    this.cvFetchInFlight = this.fetchMyCvFromApi(normalizedMetierId);
    try {
      return await this.cvFetchInFlight;
    } finally {
      this.cvFetchInFlight = null;
      this.cvFetchInFlightKey = null;
    }
  }

  private async fetchMyCvFromApi(metierId?: string): Promise<any | null> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('AUTH_REQUIRED');
    }

    const normalizedMetierId = String(metierId ?? '').trim();
    const query = normalizedMetierId.length > 0
      ? `?${new URLSearchParams({ metierId: normalizedMetierId }).toString()}`
      : '';

    const resp = await fetch(`${environment.apiUrl}/cv-submissions/me${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('AUTH_REQUIRED');
    }
    if (!resp.ok) {
      throw new Error(`CV_FETCH_FAILED_${resp.status}`);
    }

    const json = await resp.json();
    const data = json?.data ?? json;
    if (!data?.found) {
      this.setCvExistsCache(false);
      return null;
    }

    this.setCvExistsCache(true);
    return data.cv ?? null;
  }

  async fetchExtractedSkills(metierId?: string): Promise<{
    found: boolean;
    hardSkills: Array<{ type: string; nom: string; niveau: string }>;
    softSkills: Array<{ nom: string; niveau: string; contexte: string }>;
  }> {
    const token = await this.getAuthToken();
    const normalizedMetierId = String(metierId ?? '').trim();
    if (!token || !normalizedMetierId) return { found: false, hardSkills: [], softSkills: [] };

    try {
      const params = new URLSearchParams({ metierId: normalizedMetierId });
      const resp = await fetch(`${environment.apiUrl}/cv-submissions/extract-skills?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return { found: false, hardSkills: [], softSkills: [] };

      const json = await resp.json();
      const data = json?.data ?? json;
      return {
        found: !!data?.found,
        hardSkills: Array.isArray(data?.hardSkills) ? data.hardSkills : [],
        softSkills: Array.isArray(data?.softSkills) ? data.softSkills : [],
      };
    } catch (err) {
      console.error('fetchExtractedSkills error', err);
      return { found: false, hardSkills: [], softSkills: [] };
    }
  }

  /**
   * Fetch CV related table rows directly from Supabase for the current user.
   * Returns normalized arrays for formations, experiences, certifications, engagements and langues.
   */
  async fetchCvTablesForCurrentUser(): Promise<{
    formations: any[];
    experiences: any[];
    certifications: any[];
    engagements: any[];
    langues: any[];
  }> {
    const userId = this.getCurrentCacheUser();
    if (!userId) {
      return { formations: [], experiences: [], certifications: [], engagements: [], langues: [] };
    }

    try {
      const tables = [
        { name: 'cv_formations', key: 'formations' },
        { name: 'cv_experiences', key: 'experiences' },
        { name: 'cv_certifications', key: 'certifications' },
        { name: 'cv_engagements', key: 'engagements' },
        { name: 'cv_langues', key: 'langues' },
      ];

      const promises = tables.map((t) =>
        this.supabase.from(t.name).select('*').eq('auth_id', userId).order('created_at', { ascending: true })
      );

      const results = await Promise.all(promises);

      const mapped: Record<string, any[]> = {
        formations: [],
        experiences: [],
        certifications: [],
        engagements: [],
        langues: [],
      };

      for (let i = 0; i < results.length; i++) {
        const { data, error } = results[i] as any;
        const key = tables[i].key;
        if (error) {
          console.warn(`[CvSubmissionService] Supabase read ${tables[i].name} error`, error);
          mapped[key] = [];
          continue;
        }
        mapped[key] = Array.isArray(data) ? data : [];
      }

      return {
        formations: mapped['formations'],
        experiences: mapped['experiences'],
        certifications: mapped['certifications'],
        engagements: mapped['engagements'],
        langues: mapped['langues'],
      };
    } catch (err) {
      console.error('fetchCvTablesForCurrentUser error', err);
      return { formations: [], experiences: [], certifications: [], engagements: [], langues: [] };
    }
  }

  async fetchStudentFiliere(): Promise<string | null> {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;

      const resp = await fetch(`${environment.apiUrl}/profile`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!resp.ok) return null;
      const json = (await resp.json()) as { data?: Record<string, any> };
      const filiere = json?.data?.['filiere'];
      return typeof filiere === 'string' && filiere.trim().length > 0 ? filiere.trim() : null;
    } catch {
      return null;
    }
  }

  private normalizeMatchingAnalysis(raw: any): MatchingAnalysisResponse | null {
    if (!raw || typeof raw !== 'object') return null;

    const toNumber = (value: any, fallback = 0): number => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const mapTopSkills = (skills: any): MatchingTopSkill[] => {
      if (!Array.isArray(skills)) return [];
      return skills
        .map((s) => ({
          skill: String(s?.skill ?? '').trim(),
          score: Number(toNumber(s?.score, 0).toFixed(4)),
        }))
        .filter((s) => s.skill.length > 0);
    };

    const mapMetier = (entry: any): MatchingMetierRankingEntry => ({
      metier: String(entry?.metier ?? '').trim(),
      domaine: String(entry?.domaine ?? '').trim(),
      nCompetences: Math.max(0, Math.round(toNumber(entry?.nCompetences ?? entry?.n_competences, 0))),
      matched: Math.max(0, Math.round(toNumber(entry?.matched, 0))),
      coveragePct: Number(toNumber(entry?.coveragePct ?? entry?.coverage_pct, 0).toFixed(1)),
      avgScore: Number(toNumber(entry?.avgScore ?? entry?.avg_score, 0).toFixed(4)),
      topSkills: mapTopSkills(entry?.topSkills ?? entry?.top_skills),
    });

    const mapGap = (entry: any): MatchingGapEntry => ({
      refCompetence: String(entry?.refCompetence ?? entry?.ref_competence ?? '').trim(),
      refMetier: String(entry?.refMetier ?? entry?.ref_metier ?? '').trim(),
      refDomaine: String(entry?.refDomaine ?? entry?.ref_domaine ?? '').trim(),
      refType: String(entry?.refType ?? entry?.ref_type ?? '').trim(),
      refMotsCles: String(entry?.refMotsCles ?? entry?.ref_mots_cles ?? '').trim(),
      bestCvSkill: String(entry?.bestCvSkill ?? entry?.best_cv_skill ?? '').trim(),
      bestCvNiveau: String(entry?.bestCvNiveau ?? entry?.best_cv_niveau ?? '').trim(),
      similarityScore: Number(toNumber(entry?.similarityScore ?? entry?.similarity_score, 0).toFixed(4)),
      status: String(entry?.status ?? 'gap').toLowerCase() === 'match' ? 'match' : 'gap',
    });

    return {
      cvSubmissionId: String(raw?.cvSubmissionId ?? raw?.cv_submission_id ?? '').trim(),
      selectedMetierId: String(raw?.selectedMetierId ?? raw?.selected_metier_id ?? '').trim(),
      generatedAt: String(raw?.generatedAt ?? raw?.generated_at ?? '').trim(),
      modelName: String(raw?.modelName ?? raw?.model_name ?? '').trim(),
      threshold: Number(toNumber(raw?.threshold, 0.72).toFixed(4)),
      summary: {
        nSkills: Math.max(0, Math.round(toNumber(raw?.summary?.nSkills ?? raw?.summary?.n_skills, 0))),
        nMatches: Math.max(0, Math.round(toNumber(raw?.summary?.nMatches ?? raw?.summary?.n_matches, 0))),
        nGaps: Math.max(0, Math.round(toNumber(raw?.summary?.nGaps ?? raw?.summary?.n_gaps, 0))),
        matchRatePct: Number(toNumber(raw?.summary?.matchRatePct ?? raw?.summary?.match_rate_pct, 0).toFixed(1)),
      },
      topMetier: raw?.topMetier || raw?.top_metier ? mapMetier(raw?.topMetier ?? raw?.top_metier) : null,
      metierRanking: Array.isArray(raw?.metierRanking ?? raw?.metier_ranking)
        ? (raw?.metierRanking ?? raw?.metier_ranking).map((entry: any) => mapMetier(entry))
        : [],
      matches: Array.isArray(raw?.matches) ? raw.matches.map((entry: any) => mapGap(entry)) : [],
      gaps: Array.isArray(raw?.gaps) ? raw.gaps.map((entry: any) => mapGap(entry)) : [],
      topMetierGaps: Array.isArray(raw?.topMetierGaps ?? raw?.top_metier_gaps)
        ? (raw?.topMetierGaps ?? raw?.top_metier_gaps).map((entry: any) => mapGap(entry))
        : [],
    };
  }

  private setCachedMatchingAnalysis(result: MatchingAnalysisResponse | null): void {
    try {
      if (!result) {
        localStorage.removeItem(this.matchingAnalysisCacheKey);
        return;
      }

      localStorage.setItem(this.matchingAnalysisCacheKey, JSON.stringify(result));
    } catch {
      // ignore storage failures
    }
  }

  getCachedMatchingAnalysis(): MatchingAnalysisResponse | null {
    try {
      const raw = localStorage.getItem(this.matchingAnalysisCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return this.normalizeMatchingAnalysis(parsed);
    } catch {
      return null;
    }
  }

  private normalizeMatchingTrace(raw: any): MatchingAnalysisTraceResponse | null {
    if (!raw || typeof raw !== 'object') return null;

    const analysis = this.normalizeMatchingAnalysis(raw?.analysis);
    if (!analysis) return null;

    const toNumber = (value: any, fallback = 0): number => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const mapTopSkills = (skills: any): MatchingTopSkill[] => {
      if (!Array.isArray(skills)) return [];
      return skills
        .map((s) => ({
          skill: String(s?.skill ?? '').trim(),
          score: Number(toNumber(s?.score, 0).toFixed(4)),
        }))
        .filter((s) => s.skill.length > 0);
    };

    const mapMetierRow = (row: any): MatchingTraceMetierScore => ({
      id: String(row?.id ?? '').trim(),
      analysisId: String(row?.analysisId ?? row?.analysis_id ?? '').trim(),
      cvSubmissionId: String(row?.cvSubmissionId ?? row?.cv_submission_id ?? '').trim(),
      authId: String(row?.authId ?? row?.auth_id ?? '').trim(),
      rankPosition: Math.max(0, Math.round(toNumber(row?.rankPosition ?? row?.rank_position, 0))),
      metierName: String(row?.metierName ?? row?.metier_name ?? '').trim(),
      domaineName: String(row?.domaineName ?? row?.domaine_name ?? '').trim(),
      nCompetences: Math.max(0, Math.round(toNumber(row?.nCompetences ?? row?.n_competences, 0))),
      matchedCompetences: Math.max(0, Math.round(toNumber(row?.matchedCompetences ?? row?.matched_competences, 0))),
      coveragePct: Number(toNumber(row?.coveragePct ?? row?.coverage_pct, 0).toFixed(1)),
      avgScore: Number(toNumber(row?.avgScore ?? row?.avg_score, 0).toFixed(4)),
      topSkills: mapTopSkills(row?.topSkills ?? row?.top_skills),
      createdAt: String(row?.createdAt ?? row?.created_at ?? '').trim(),
    });

    const mapCompetenceRow = (row: any): MatchingTraceCompetenceResult => ({
      id: String(row?.id ?? '').trim(),
      analysisId: String(row?.analysisId ?? row?.analysis_id ?? '').trim(),
      cvSubmissionId: String(row?.cvSubmissionId ?? row?.cv_submission_id ?? '').trim(),
      authId: String(row?.authId ?? row?.auth_id ?? '').trim(),
      metierName: String(row?.metierName ?? row?.metier_name ?? '').trim(),
      domaineName: String(row?.domaineName ?? row?.domaine_name ?? '').trim(),
      metierRank: row?.metierRank ?? row?.metier_rank ?? null,
      isTopMetier: Boolean(row?.isTopMetier ?? row?.is_top_metier),
      status: String(row?.status ?? 'gap').toLowerCase() === 'match' ? 'match' : 'gap',
      sourceBucket: String(row?.sourceBucket ?? row?.source_bucket ?? 'analysis').trim(),
      competenceName: String(row?.competenceName ?? row?.competence_name ?? '').trim(),
      competenceType: String(row?.competenceType ?? row?.competence_type ?? '').trim(),
      keywords: String(row?.keywords ?? '').trim(),
      bestCvSkill: String(row?.bestCvSkill ?? row?.best_cv_skill ?? '').trim(),
      bestCvLevel: String(row?.bestCvLevel ?? row?.best_cv_level ?? '').trim(),
      similarityScore: Number(toNumber(row?.similarityScore ?? row?.similarity_score, 0).toFixed(4)),
      createdAt: String(row?.createdAt ?? row?.created_at ?? '').trim(),
    });

    return {
      analysis,
      analysisId: raw?.analysisId ?? raw?.analysis_id ?? null,
      analysisFingerprint: String(raw?.analysisFingerprint ?? raw?.analysis_fingerprint ?? '').trim(),
      metierScores: Array.isArray(raw?.metierScores ?? raw?.metier_scores)
        ? (raw?.metierScores ?? raw?.metier_scores).map((row: any) => mapMetierRow(row))
        : [],
      competenceResults: Array.isArray(raw?.competenceResults ?? raw?.competence_results)
        ? (raw?.competenceResults ?? raw?.competence_results).map((row: any) => mapCompetenceRow(row))
        : [],
    };
  }

  private setCachedMatchingTrace(result: MatchingAnalysisTraceResponse | null): void {
    try {
      if (!result) {
        localStorage.removeItem(this.matchingTraceCacheKey);
        return;
      }

      localStorage.setItem(this.matchingTraceCacheKey, JSON.stringify(result));
    } catch {
      // ignore storage failures
    }
  }

  getCachedMatchingAnalysisTrace(): MatchingAnalysisTraceResponse | null {
    try {
      const raw = localStorage.getItem(this.matchingTraceCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return this.normalizeMatchingTrace(parsed);
    } catch {
      return null;
    }
  }

  async fetchMatchingAnalysisTrace(force = false): Promise<MatchingAnalysisTraceResponse | null> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Utilisateur non authentifie.');
    }

    const query = force ? '?force=true' : '';
    const resp = await fetch(`${environment.apiUrl}/cv-submissions/matching-analysis/trace${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Matching trace API failed (${resp.status}): ${text}`);
    }

    const json = await resp.json();
    const data = json?.data ?? json;
    const normalized = this.normalizeMatchingTrace(data);
    if (normalized) {
      this.setCachedMatchingTrace(normalized);
      this.setCachedMatchingAnalysis(normalized.analysis);
    }
    return normalized;
  }

  async fetchMatchingAnalysis(force = false): Promise<MatchingAnalysisResponse | null> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Utilisateur non authentifie.');
    }

    const query = force ? '?force=true' : '';
    const resp = await fetch(`${environment.apiUrl}/cv-submissions/matching-analysis${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Matching analysis API failed (${resp.status}): ${text}`);
    }

    const json = await resp.json();
    const data = json?.data ?? json;
    const normalized = this.normalizeMatchingAnalysis(data);
    if (normalized) {
      this.setCachedMatchingAnalysis(normalized);
    }
    return normalized;
  }

  async runMatchingAnalysis(force = true): Promise<MatchingAnalysisResponse | null> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Utilisateur non authentifie.');
    }

    const resp = await fetch(`${environment.apiUrl}/cv-submissions/matching-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ force }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Matching analysis run failed (${resp.status}): ${text}`);
    }

    const json = await resp.json();
    const data = json?.data ?? json;
    const normalized = this.normalizeMatchingAnalysis(data);
    if (normalized) {
      this.setCachedMatchingAnalysis(normalized);
    }
    return normalized;
  }

  async fetchMetiers(): Promise<any[]> {
    try {
      const resp = await fetch(`${environment.apiUrl}/ref-competance/metiers`);
      if (!resp.ok) return [];
      const json = await resp.json();
      return json?.data ?? [];
    } catch (err) {
      console.error('fetchMetiers error', err);
      return [];
    }
  }

  async fetchDomaines(): Promise<any[]> {
    try {
      const resp = await fetch(`${environment.apiUrl}/ref-competance/domaines`);
      if (!resp.ok) return [];
      const json = await resp.json();
      return json?.data ?? [];
    } catch (err) {
      console.error('fetchDomaines error', err);
      return [];
    }
  }
}
