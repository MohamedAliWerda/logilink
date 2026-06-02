import { Injectable, Logger } from '@nestjs/common';
import { getSupabase } from '../config/supabase.client';
import { RefCompetanceService } from '../ref_competance/ref_competance.service';

export type Tone = 'green' | 'amber' | 'red' | 'blue';
export type SkillStatus = 'Aligné' | 'Partiel' | 'Gap fort' | 'Insuffisante';

export interface SkillItem {
  label: string;
  acquis: number;
  requis: number;
  status: SkillStatus;
  gap: number;
  count: number;
}

export interface PriorityItem {
  label: string;
  domain: string;
  count: number;
  status: SkillStatus;
  statusClass: string;
  gap: number;
}

export interface StudentItem {
  authId: string;
  cvSubmissionId: string;
  initials: string;
  name: string;
  pct: number;
  gaps: number;
  color: string;
  bg: string;
  fg: string;
  marketTarget: string;
  cohortRank: number;
  filiere: string;
  diplome: string;
}

export interface StudentDetailItem extends StudentItem {
  strengths: string[];
  watchouts: string[];
  nextSteps: string[];
  skillFocus: Array<{
    label: string;
    acquis: number;
    requis: number;
    status: SkillStatus;
  }>;
}

export interface JobItem {
  label: string;
  pct: number;
  tone: 'good' | 'warn' | 'alert';
}

export interface CategoryDescriptor {
  key: string;
  label: string;
}

export interface GapsDashboardPayload {
  cohortLabel: string;
  totalStudents: number;
  kpis: Array<{ label: string; value: string; note: string; tone: Tone }>;
  tabs: CategoryDescriptor[];
  skillCategories: Record<string, SkillItem[]>;
  students: StudentItem[];
  studentDetails: StudentDetailItem[];
  priorityItems: PriorityItem[];
  jobFit: JobItem[];
}

const REQUIRED_LEVEL_DEFAULT = 60;
const ALIGNMENT_THRESHOLD = 60;

const STATUS_CLASS_MAP: Record<SkillStatus, string> = {
  'Aligné': 'status-aligne',
  'Partiel': 'status-partiel',
  'Gap fort': 'status-gap',
  'Insuffisante': 'status-absente',
};

const STUDENT_PALETTES = [
  { color: '#2E7D32', bg: '#EBF5EB', fg: '#1B5E20' },
  { color: '#1A4C8B', bg: '#EAF2FD', fg: '#1A4C8B' },
  { color: '#B45309', bg: '#FEF3E2', fg: '#7C3A00' },
  { color: '#5E2080', bg: '#F3EAF9', fg: '#5E2080' },
  { color: '#C62828', bg: '#FCEAEA', fg: '#7B1212' },
];

@Injectable()
export class GapsService {
  private readonly logger = new Logger(GapsService.name);
  private readonly supabase = getSupabase();

  constructor(private readonly refCompetanceService: RefCompetanceService) {}

  async getDashboard(): Promise<GapsDashboardPayload> {
    const metierRows = await this.fetchTopMetierScores();
    const latestAnalysisIds = metierRows.map((r) => String(r.analysis_id ?? '')).filter(Boolean);
    const competenceRows = await this.fetchCompetenceResults(latestAnalysisIds);

    const studentNameMap = await this.buildStudentNameMap(
      Array.from(new Set(metierRows.map((row) => String(row.auth_id ?? '')).filter(Boolean))),
    );

    const tabs = this.buildTabs(competenceRows);
    const skillCategories = this.buildSkillCategories(competenceRows, tabs);
    const priorityItems = this.buildPriorityItems(competenceRows);
    const students = this.buildStudents(metierRows, competenceRows, studentNameMap);
    const jobFit = this.buildJobFit(students);
    const studentDetails = this.buildStudentDetails(students, competenceRows);
    const kpis = this.buildKpis(competenceRows, students, priorityItems);

    return {
      cohortLabel: this.buildCohortLabel(students.length),
      totalStudents: students.length,
      kpis,
      tabs,
      skillCategories,
      students,
      studentDetails,
      priorityItems,
      jobFit,
    };
  }

  private async fetchTopMetierScores(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('cv_matching_metier_scores')
      .select(
        'analysis_id, cv_submission_id, auth_id, rank_position, metier_name, domaine_name, n_competences, matched_competences, coverage_pct, avg_score, top_skills, created_at',
      )
      .eq('rank_position', 1)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('cv_matching_metier_scores fetch failed: ' + error.message);
      throw new Error(error.message);
    }
    // Keep only the most recent analysis per student
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const row of data ?? []) {
      const authId = String(row.auth_id ?? '');
      if (authId && !seen.has(authId)) {
        seen.add(authId);
        deduped.push(row);
      }
    }
    return deduped;
  }

  private async fetchCompetenceResults(analysisIds: string[]): Promise<any[]> {
    if (!analysisIds.length) return [];
    const { data, error } = await this.supabase
      .from('cv_matching_competence_results')
      .select(
        'analysis_id, cv_submission_id, auth_id, metier_name, domaine_name, metier_rank, is_top_metier, status, competence_name, competence_type, similarity_score, best_cv_skill',
      )
      .eq('is_top_metier', true)
      .in('analysis_id', analysisIds);
    if (error) {
      this.logger.error('cv_matching_competence_results fetch failed: ' + error.message);
      throw new Error(error.message);
    }
    return data ?? [];
  }

  private async buildStudentNameMap(authIds: string[]): Promise<Map<string, { name: string; filiere: string; diplome: string }>> {
    const result = new Map<string, { name: string; filiere: string; diplome: string }>();
    if (!authIds.length) return result;

    const { data: users, error: usersError } = await this.supabase
      .from('user')
      .select('auth_id, cin_passport, email')
      .in('auth_id', authIds);
    if (usersError) {
      this.logger.warn('user lookup failed: ' + usersError.message);
      return result;
    }

    const cinByAuth = new Map<string, string>();
    const emailByAuth = new Map<string, string>();
    for (const row of users ?? []) {
      const authId = String(row.auth_id ?? '').trim();
      if (!authId) continue;
      if (row.cin_passport != null) cinByAuth.set(authId, String(row.cin_passport));
      if (row.email) emailByAuth.set(authId, String(row.email));
    }

    const cinValues = Array.from(cinByAuth.values());
    if (cinValues.length) {
      const { data: profiles, error: profilesError } = await this.supabase
        .from('profils_etudiant')
        .select('cin_passport, nom, prenom, filiere, niveau')
        .in('cin_passport', cinValues);
      if (!profilesError) {
        const byCin = new Map<string, { nom?: string; prenom?: string; filiere?: string; niveau?: unknown }>();
        for (const row of profiles ?? []) {
          byCin.set(String(row.cin_passport), { nom: row.nom ?? '', prenom: row.prenom ?? '', filiere: row.filiere ?? '', niveau: row.niveau });
        }
        for (const [authId, cin] of cinByAuth.entries()) {
          const p = byCin.get(cin);
          if (p) {
            const name = `${(p.prenom ?? '').trim()} ${(p.nom ?? '').trim()}`.trim();
            const filiere = String(p.filiere ?? '').trim();
            const niveauRaw = String(p.niveau ?? '').trim().toLowerCase();
            const diplome = niveauRaw.includes('master') || niveauRaw === '5' ? 'Master' : 'Licence';
            result.set(authId, { name: name || '', filiere, diplome });
          }
        }
      } else {
        this.logger.warn('profils_etudiant lookup failed: ' + profilesError.message);
      }
    }

    for (const [authId, email] of emailByAuth.entries()) {
      if (!result.has(authId)) result.set(authId, { name: email, filiere: '', diplome: 'Licence' });
    }

    return result;
  }

  private buildTabs(competenceRows: any[]): CategoryDescriptor[] {
    const counts = new Map<string, number>();
    for (const row of competenceRows) {
      const type = this.normalizeCategoryLabel(row.competence_type);
      if (!type) continue;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label]) => ({ key: this.slugify(label), label }));
    if (sorted.length === 0) {
      return [{ key: 'global', label: 'Global' }];
    }
    return sorted;
  }

  private buildSkillCategories(
    competenceRows: any[],
    tabs: CategoryDescriptor[],
  ): Record<string, SkillItem[]> {
    const groups = new Map<string, Map<string, any[]>>();
    for (const tab of tabs) {
      groups.set(tab.key, new Map());
    }

    for (const row of competenceRows) {
      const tabKey =
        tabs.length === 1 && tabs[0].key === 'global'
          ? 'global'
          : this.slugify(this.normalizeCategoryLabel(row.competence_type));
      const bucket = groups.get(tabKey);
      if (!bucket) continue;
      const compName = String(row.competence_name ?? '').trim();
      if (!compName) continue;
      const list = bucket.get(compName) ?? [];
      list.push(row);
      bucket.set(compName, list);
    }

    const result: Record<string, SkillItem[]> = {};
    for (const tab of tabs) {
      const bucket = groups.get(tab.key) ?? new Map<string, any[]>();
      const items: SkillItem[] = [];
      for (const [label, rows] of bucket.entries()) {
        const acquis = this.percentile(this.average(rows.map((r) => Number(r.similarity_score ?? 0))) * 100);
        const requis = REQUIRED_LEVEL_DEFAULT;
        const gap = acquis - requis;
        const status = this.statusFromGap(gap);
        const count = rows.filter((r) => r.status === 'gap').length;
        items.push({ label, acquis, requis, status, gap, count });
      }
      items.sort((a, b) => a.gap - b.gap);
      result[tab.key] = items.slice(0, 6);
    }
    return result;
  }

  private buildPriorityItems(competenceRows: any[]): PriorityItem[] {
    const grouped = new Map<string, { rows: any[]; type: string }>();
    for (const row of competenceRows) {
      if (row.status !== 'gap') continue;
      const label = String(row.competence_name ?? '').trim();
      if (!label) continue;
      const entry = grouped.get(label) ?? { rows: [], type: this.normalizeCategoryLabel(row.competence_type) };
      entry.rows.push(row);
      grouped.set(label, entry);
    }
    const items: PriorityItem[] = [];
    for (const [label, info] of grouped.entries()) {
      const uniqueAuth = new Set(info.rows.map((r) => String(r.auth_id ?? '')));
      const acquis = this.percentile(this.average(info.rows.map((r) => Number(r.similarity_score ?? 0))) * 100);
      const gapValue = REQUIRED_LEVEL_DEFAULT - acquis;
      const status = this.statusFromGap(acquis - REQUIRED_LEVEL_DEFAULT);
      items.push({
        label,
        domain: info.type || 'Compétence',
        count: uniqueAuth.size,
        status,
        statusClass: STATUS_CLASS_MAP[status],
        gap: Math.max(0, Math.round(gapValue)),
      });
    }
    items.sort((a, b) => b.count - a.count || b.gap - a.gap);
    return items.slice(0, 5);
  }

  private buildJobFit(students: StudentItem[]): JobItem[] {
    const grouped = new Map<string, number[]>();
    for (const student of students) {
      const label = student.marketTarget;
      if (!label || label === 'Non défini') continue;
      const arr = grouped.get(label) ?? [];
      arr.push(student.pct);
      grouped.set(label, arr);
    }
    const items: JobItem[] = [];
    for (const [label, values] of grouped.entries()) {
      const pct = this.percentile(this.average(values));
      items.push({ label, pct, tone: this.toneForPct(pct) });
    }
    items.sort((a, b) => b.pct - a.pct);
    return items.slice(0, 5);
  }

  private buildStudents(
    metierRows: any[],
    competenceRows: any[],
    nameMap: Map<string, { name: string; filiere: string; diplome: string }>,
  ): StudentItem[] {
    const gapsByAuth = new Map<string, number>();
    for (const row of competenceRows) {
      const authId = String(row.auth_id ?? '');
      if (row.status === 'gap') {
        gapsByAuth.set(authId, (gapsByAuth.get(authId) ?? 0) + 1);
      }
    }

    const items: StudentItem[] = metierRows.map((row, idx) => {
      const authId = String(row.auth_id ?? '');
      const profile = nameMap.get(authId);
      const fullName = (profile?.name ?? '').trim() || `Étudiant ${idx + 1}`;
      // Read the stored coverage_pct directly — the Python service now stores it
      // with the same formula (sum of matched scores / n_competences) the frontend uses.
      const pct = this.percentile1(Number(row.coverage_pct ?? 0));
      const initials = this.initialsFor(fullName);
      const palette = STUDENT_PALETTES[this.toneIndex(pct)];
      return {
        authId,
        cvSubmissionId: String(row.cv_submission_id ?? ''),
        initials,
        name: fullName,
        pct,
        gaps: gapsByAuth.get(authId) ?? 0,
        color: palette.color,
        bg: palette.bg,
        fg: palette.fg,
        marketTarget: String(row.metier_name ?? '').trim() || 'Non défini',
        cohortRank: 0,
        filiere: profile?.filiere ?? '',
        diplome: profile?.diplome ?? 'Licence',
      };
    });

    items.sort((a, b) => b.pct - a.pct);
    items.forEach((item, idx) => {
      item.cohortRank = idx + 1;
    });
    return items;
  }

  private buildStudentDetails(students: StudentItem[], competenceRows: any[]): StudentDetailItem[] {
    const byAuth = new Map<string, any[]>();
    for (const row of competenceRows) {
      const authId = String(row.auth_id ?? '');
      if (!authId) continue;
      const list = byAuth.get(authId) ?? [];
      list.push(row);
      byAuth.set(authId, list);
    }

    return students.map((student) => {
      const rows = byAuth.get(student.authId) ?? [];
      const matches = rows
        .filter((r) => r.status === 'match')
        .sort((a, b) => Number(b.similarity_score ?? 0) - Number(a.similarity_score ?? 0));
      const gaps = rows
        .filter((r) => r.status === 'gap')
        .sort((a, b) => Number(a.similarity_score ?? 0) - Number(b.similarity_score ?? 0));

      const strengths = matches.map((r) => String(r.competence_name ?? '').trim()).filter(Boolean);
      const watchouts = gaps.map((r) => String(r.competence_name ?? '').trim()).filter(Boolean);
      const skillFocus = [...gaps, ...matches].map((r) => {
        const acquis = this.percentile(Number(r.similarity_score ?? 0) * 100);
        const requis = REQUIRED_LEVEL_DEFAULT;
        return {
          label: String(r.competence_name ?? '').trim(),
          acquis,
          requis,
          status: this.statusFromGap(acquis - requis),
        };
      });

      return {
        ...student,
        strengths: strengths.length ? strengths : ['Profil cohorte'],
        watchouts: watchouts.length ? watchouts : ['Aucun gap critique détecté'],
        nextSteps: this.buildNextSteps(gaps),
        skillFocus,
      };
    });
  }

  private buildNextSteps(gapRows: any[]): string[] {
    const top = gapRows.slice(0, 3);
    const steps: string[] = [];
    for (const row of top) {
      const name = String(row.competence_name ?? '').trim();
      if (!name) continue;
      steps.push(`Renforcer ${name}`);
    }
    if (steps.length === 0) {
      steps.push('Maintenir le niveau acquis', 'Préparer une mise en situation métier', 'Suivre les évolutions du référentiel');
    }
    return steps;
  }

  private buildKpis(
    competenceRows: any[],
    students: StudentItem[],
    priorityItems: PriorityItem[],
  ): Array<{ label: string; value: string; note: string; tone: Tone }> {
    const avgCoverage = this.percentile(this.average(students.map((s) => s.pct)));
    const target = ALIGNMENT_THRESHOLD;
    const gapRows = competenceRows.filter((r) => r.status === 'gap');
    const aligned = students.filter((s) => s.pct >= target).length;
    const topPriority = priorityItems[0];

    const absentCount = competenceRows.filter((r) => {
      if (r.status !== 'gap') return false;
      const sim = Number(r.similarity_score ?? 0);
      return sim < 0.3;
    }).length;

    return [
      {
        label: 'Adéquation moyenne',
        value: `${avgCoverage}%`,
        note: `objectif : ${target}%`,
        tone: avgCoverage >= target ? 'green' : avgCoverage >= 45 ? 'amber' : 'red',
      },
      {
        label: 'Gaps critiques',
        value: String(gapRows.length),
        note: absentCount ? `dont ${absentCount} compétences manquantes` : 'compétences manquantes',
        tone: 'red',
      },
      {
        label: "Nombre d'étudiants alignés",
        value: `${aligned} / ${students.length || 0}`,
        note: `adéquation > 60%`,
        tone: aligned > 0 ? 'green' : 'amber',
      },
      {
        label: 'Gap le plus fréquent',
        value: topPriority ? topPriority.label : '—',
        note: topPriority ? `${topPriority.count} étudiant${topPriority.count > 1 ? 's' : ''} concerné${topPriority.count > 1 ? 's' : ''}` : 'aucun gap détecté',
        tone: 'blue',
      },
    ];
  }

  private buildCohortLabel(total: number): string {
    const year = new Date().getFullYear();
    return `Promotion ${year} · ${total} étudiant${total > 1 ? 's' : ''}`;
  }

  private statusFromGap(gap: number): SkillStatus {
    if (gap >= 0) return 'Aligné';
    if (gap >= -10) return 'Partiel';
    if (gap >= -25) return 'Gap fort';
    return 'Insuffisante';
  }

  private toneForPct(pct: number): 'good' | 'warn' | 'alert' {
    if (pct >= ALIGNMENT_THRESHOLD) return 'good';
    if (pct >= 45) return 'warn';
    return 'alert';
  }

  private toneIndex(pct: number): number {
    if (pct >= ALIGNMENT_THRESHOLD) return 0;
    if (pct >= 50) return 1;
    if (pct >= 40) return 2;
    if (pct >= 25) return 3;
    return 4;
  }

  private computeCoveragePctFromMatchedSimilarity(
    matchedRows: any[],
    nCompetences: number,
    fallbackPct: number,
  ): number {
    const total = Number(nCompetences);
    if (Number.isFinite(total) && total > 0) {
      const similaritySum = matchedRows.reduce((sum, row) => {
        const score = Number(row?.similarity_score);
        if (!Number.isFinite(score)) return sum;
        return sum + Math.max(0, Math.min(1, score));
      }, 0);
      return this.percentile1((similaritySum / total) * 100);
    }
    return this.percentile1(fallbackPct);
  }

  private percentile1(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const clamped = Math.max(0, Math.min(100, value));
    return Number(clamped.toFixed(1));
  }

  private average(values: number[]): number {
    if (!values.length) return 0;
    const sum = values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
    return sum / values.length;
  }

  private percentile(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private initialsFor(name: string): string {
    const tokens = name
      .replace(/[^\p{L}\s'-]/gu, '')
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return '··';
    if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
    return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
  }

  private normalizeCategoryLabel(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return raw
      .split(/\s+/)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
      .join(' ');
  }

  private slugify(value: string): string {
    return (
      value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'global'
    );
  }

  private normalizeMetierId(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      const oid = (value as any)?.$oid;
      if (typeof oid === 'string') return oid.trim().toLowerCase();
      const toHex = (value as any)?.toHexString;
      if (typeof toHex === 'function') {
        try {
          const hex = String(toHex.call(value)).trim().toLowerCase();
          if (hex) return hex;
        } catch {
          // ignore invalid object-id transforms
        }
      }
    }
    return String(value).trim().toLowerCase();
  }

  // Resolve the student's selected métier visé (cv_submissions.metier_id) to its
  // referentiel name. metier_id is a Mongo ObjectId string; the matching scores
  // are keyed by metier_name, so we need the name to find the right row.
  private async resolveSelectedMetierName(metierId: unknown): Promise<string> {
    const normalizedId = this.normalizeMetierId(metierId);
    if (!normalizedId) return '';
    try {
      const metiers = await this.refCompetanceService.getMetiers();
      const found = (metiers as any[]).find(
        (m) => this.normalizeMetierId(m?._id ?? m?.raw?._id ?? m?.raw?.id) === normalizedId,
      );
      return String(found?.nom_metier ?? found?.nom ?? '').trim();
    } catch (e) {
      this.logger.warn(`resolveSelectedMetierName failed: ${(e as Error).message}`);
      return '';
    }
  }

  async getStudentCv(cvSubmissionId: string, authId: string): Promise<{
    found: boolean;
    cv: any | null;
    professionalTitle: string;
    targetJobStats: {
      metierName: string;
      coveragePct: number;
      matched: number;
      total: number;
      strengths: string[];
      watchouts: string[];
      skillFocus: Array<{ label: string; acquis: number; requis: number; status: SkillStatus }>;
    } | null;
  }> {
    this.logger.log(`getStudentCv: cvSubmissionId=${cvSubmissionId} authId=${authId}`);

    // ── 1. Main cv_submissions row ────────────────────────────────────
    // Resolve primarily by auth_id (cv_submissions has UNIQUE(auth_id), so this is
    // always the student's current CV). The cv_submission_id carried on matching
    // rows can be stale if the student regenerated their CV, which made the old
    // id-only lookup return nothing → "Aucun CV". Fall back to the passed id.
    let main: any = null;

    if (authId) {
      const { data, error } = await this.supabase
        .from('cv_submissions')
        .select('*')
        .eq('auth_id', authId)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) {
        this.logger.error(`cv_submissions query (auth_id) error: ${error.message}`);
        throw new Error(error.message);
      }
      main = Array.isArray(data) && data.length > 0 ? data[0] : null;
    }

    if (!main && cvSubmissionId) {
      const { data, error } = await this.supabase
        .from('cv_submissions')
        .select('*')
        .eq('id', cvSubmissionId)
        .limit(1);
      if (error) {
        this.logger.error(`cv_submissions query (id) error: ${error.message}`);
        throw new Error(error.message);
      }
      main = Array.isArray(data) && data.length > 0 ? data[0] : null;
    }

    this.logger.log(`cv_submissions row found: ${!!main}, professional_title: ${main?.professional_title}`);

    if (!main) {
      return { found: false, cv: null, professionalTitle: '', targetJobStats: null };
    }

    // Use the actual resolved CV id for all child-table queries — not the (possibly
    // stale) id the caller passed in.
    const resolvedCvId = String(main.id ?? cvSubmissionId);
    const professionalTitle = String(main.professional_title ?? '').trim();

    // ── 2. Student name from user + profils_etudiant ──────────────────
    let infoName: { nom?: string; prenom?: string; email?: string } = {};
    try {
      const { data: userRow } = await this.supabase
        .from('user')
        .select('cin_passport, email')
        .eq('auth_id', authId)
        .maybeSingle();
      if (userRow?.cin_passport) {
        const { data: profil } = await this.supabase
          .from('profils_etudiant')
          .select('nom, prenom')
          .eq('cin_passport', userRow.cin_passport)
          .maybeSingle();
        infoName = { nom: profil?.nom ?? '', prenom: profil?.prenom ?? '', email: userRow.email ?? '' };
      } else if (userRow?.email) {
        infoName = { email: userRow.email };
      }
    } catch (e) {
      this.logger.warn(`Profile name lookup failed: ${(e as Error).message}`);
    }

    // ── 3. Child tables in parallel ───────────────────────────────────
    const [formations, experiences, skills, langues, projets, certifications, engagements] =
      await Promise.all([
        this.supabase.from('cv_formations').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
        this.supabase.from('cv_experiences').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
        this.supabase.from('cv_skills').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
        this.supabase.from('cv_langues').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
        this.supabase.from('cv_projets').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
        this.supabase.from('cv_certifications').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
        this.supabase.from('cv_engagements').select('*').eq('cv_submission_id', resolvedCvId).order('sort_order', { ascending: true }),
      ]);

    const allSkills = (skills.data ?? []) as any[];
    const allHardSkills = allSkills.filter((s) => s.category === 'hard');
    const softSkills = allSkills.filter((s) => s.category !== 'hard');

    // Filter hard skills by the student's selected métier — identical to the
    // student-facing getCvByAuthId so the admin sees the same CV as the student.
    const selectedMetierId = this.normalizeMetierId(main.metier_id);
    let filteredHardSkills = allHardSkills;

    if (selectedMetierId && allHardSkills.length > 0) {
      const hardSkillIds = allHardSkills
        .map((s: any) => String(s?.id ?? '').trim())
        .filter((id: string) => id.length > 0);

      if (hardSkillIds.length > 0) {
        try {
          const { data: links, error: linksErr } = await this.supabase
            .from('cv_skill_metiers')
            .select('cv_skill_id, metier_id')
            .in('cv_skill_id', hardSkillIds);

          if (!linksErr && Array.isArray(links)) {
            const metiersBySkillId = new Map<string, Set<string>>();
            for (const link of links as any[]) {
              const skillId = String(link?.cv_skill_id ?? '').trim();
              const linkedMetierId = this.normalizeMetierId(link?.metier_id);
              if (!skillId || !linkedMetierId) continue;
              const set = metiersBySkillId.get(skillId) ?? new Set<string>();
              set.add(linkedMetierId);
              metiersBySkillId.set(skillId, set);
            }

            filteredHardSkills = allHardSkills.filter((skill: any) => {
              const skillId = String(skill?.id ?? '').trim();
              if (!skillId) return true;
              const linkedMetiers = metiersBySkillId.get(skillId);
              if (!linkedMetiers || linkedMetiers.size === 0) return true;
              return linkedMetiers.has(selectedMetierId);
            });
          }
        } catch (err: any) {
          this.logger.warn(`getStudentCv: failed to filter hard skills by metier: ${(err as Error).message}`);
        }
      }
    }

    const cv = {
      professionalTitle,
      specialization: main.specialization,
      objectif: main.objectif,
      info: {
        nom: infoName.nom ?? '',
        prenom: infoName.prenom ?? '',
        email: infoName.email ?? '',
        permis: main.permis,
        linkedin: main.linkedin,
        dateNaissance: main.date_naissance,
        photoUrl: main.photo_url,
      },
      formations: formations.data ?? [],
      experiences: experiences.data ?? [],
      hardSkills: filteredHardSkills,
      softSkills,
      langues: langues.data ?? [],
      projets: projets.data ?? [],
      certifications: certifications.data ?? [],
      engagements: engagements.data ?? [],
    };

    // ── 4. Target job stats ────────────────────────────────────────────
    // The métier visé the student actually selected lives in cv_submissions.metier_id.
    // Resolve it to its referentiel name; fall back to the free-text professional_title.
    const selectedMetierName = await this.resolveSelectedMetierName(main.metier_id);
    const targetLabel = (selectedMetierName || professionalTitle).trim();

    let targetJobStats = null;
    if (targetLabel) {
      const { data: metierRows, error: metierErr } = await this.supabase
        .from('cv_matching_metier_scores')
        .select('analysis_id, metier_name, coverage_pct, matched_competences, n_competences, created_at')
        .eq('auth_id', authId)
        .order('created_at', { ascending: false });

      if (metierErr) this.logger.warn(`cv_matching_metier_scores error: ${metierErr.message}`);

      const rows = (metierRows as any[]) ?? [];
      this.logger.log(`metier scores found: ${rows.length}, looking for "${targetLabel}" (metier_id=${main.metier_id})`);

      const latestAnalysisId = rows[0]?.analysis_id;
      if (latestAnalysisId) {
        // Restrict to the most recent analysis so we match the metier within the
        // current run, then resolve the row by name (slug → substring → first).
        const latestRows = rows.filter((r: any) => String(r.analysis_id) === String(latestAnalysisId));
        const targetSlug = this.slugify(targetLabel);
        const targetRow =
          latestRows.find((r: any) => this.slugify(String(r.metier_name ?? '')) === targetSlug) ??
          latestRows.find((r: any) => this.slugify(String(r.metier_name ?? '')).includes(targetSlug)) ??
          latestRows.find((r: any) => targetSlug.includes(this.slugify(String(r.metier_name ?? '')))) ??
          latestRows[0];

        this.logger.log(`targetRow found: ${!!targetRow}, metier: ${targetRow?.metier_name}`);

        if (targetRow) {
          const { data: compRows, error: compErr } = await this.supabase
            .from('cv_matching_competence_results')
            .select('competence_name, status, similarity_score')
            .eq('auth_id', authId)
            .eq('analysis_id', targetRow.analysis_id)
            .eq('metier_name', targetRow.metier_name);

          if (compErr) this.logger.warn(`competence results error: ${compErr.message}`);

          const compList = (compRows as any[]) ?? [];
          this.logger.log(`competence rows: ${compList.length}`);

          const matches = compList
            .filter((r: any) => r.status === 'match')
            .sort((a: any, b: any) => Number(b.similarity_score) - Number(a.similarity_score));
          const gaps = compList
            .filter((r: any) => r.status === 'gap')
            .sort((a: any, b: any) => Number(a.similarity_score) - Number(b.similarity_score));

          const skillFocus = [...gaps, ...matches].map((r: any) => {
            const acquis = this.percentile(Number(r.similarity_score ?? 0) * 100);
            const requis = REQUIRED_LEVEL_DEFAULT;
            return {
              label: String(r.competence_name ?? '').trim(),
              acquis,
              requis,
              status: this.statusFromGap(acquis - requis),
            };
          });

          targetJobStats = {
            metierName: String(targetRow.metier_name),
            coveragePct: this.percentile(Number(targetRow.coverage_pct ?? 0)),
            matched: Number(targetRow.matched_competences ?? 0),
            total: Number(targetRow.n_competences ?? 0),
            strengths: matches.map((r: any) => String(r.competence_name ?? '').trim()).filter(Boolean),
            watchouts: gaps.map((r: any) => String(r.competence_name ?? '').trim()).filter(Boolean),
            skillFocus,
          };
        }
      }
    }

    return { found: true, cv, professionalTitle, targetJobStats };
  }
}
