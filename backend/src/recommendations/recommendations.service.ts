import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../config/supabase.client';

export type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'edited';
type StudentRecommendationLevel = 'CRITIQUE' | 'MOYENNE' | 'FAIBLE';
type StudentGapEntry = {
  metier: string;
  competence: string;
  similarityScore: number;
};

export type RecommendationRow = Record<string, any>;

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);
  private readonly supabase = getSupabase();
  private readonly uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private readonly pythonServiceUrl: string;
  private readonly pythonTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.pythonServiceUrl = (
      this.configService.get<string>('RECOMMENDATION_PYTHON_SERVICE_URL')
      ?? 'http://127.0.0.1:8002'
    ).replace(/\/+$/, '');

    const timeout = Number(this.configService.get<string>('RECOMMENDATION_PYTHON_TIMEOUT_MS') ?? '900000');
    this.pythonTimeoutMs = Number.isFinite(timeout) ? Math.max(60_000, timeout) : 900_000;
  }

  private normalizeCategory(value: string | null | undefined): string {
    return String(value ?? '').trim().toUpperCase();
  }

  private filterByCategory(rows: RecommendationRow[], category?: string): RecommendationRow[] {
    const normalizedCategory = this.normalizeCategory(category);
    if (!normalizedCategory) return rows;
    return rows.filter((row) => this.normalizeCategory(String(row?.category ?? '')) === normalizedCategory);
  }

  private normalizeConcernRate(
    row: RecommendationRow,
    forcedTotalStudents?: number | null,
  ): RecommendationRow {
    const studentsImpacted = Number(row?.students_impacted ?? 0);
    const forcedTotal = Number(forcedTotalStudents ?? 0);
    const totalFromRow = Number(row?.total_students ?? row?.cohort_size ?? 0);
    const totalStudents =
      Number.isFinite(forcedTotal) && forcedTotal > 0
        ? Math.trunc(forcedTotal)
        : totalFromRow;

    if (!Number.isFinite(studentsImpacted) || !Number.isFinite(totalStudents) || totalStudents <= 0) {
      return row;
    }

    const concernRate = Number(((studentsImpacted / totalStudents) * 100).toFixed(1));
    return {
      ...row,
      total_students: totalStudents,
      concern_rate: concernRate,
    };
  }

  private async getGlobalCvStudentsCount(): Promise<number | null> {
    const { count, error } = await this.supabase
      .from('cv_submissions')
      .select('*', { count: 'exact', head: true });

    if (error) {
      this.logger.warn(`Unable to count cv_submissions: ${error.message}`);
      return null;
    }

    const total = Number(count ?? 0);
    if (!Number.isFinite(total) || total <= 0) {
      return null;
    }

    return Math.trunc(total);
  }

  private async pythonPost(path: string, body: any): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pythonTimeoutMs);
    try {
      const response = await fetch(`${this.pythonServiceUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new HttpException(
          `Python recommendation service failed (${response.status}): ${text}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return text ? JSON.parse(text) : {};
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err?.name === 'AbortError') {
        throw new HttpException(
          `Python recommendation service timed out (${this.pythonTimeoutMs}ms)`,
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      throw new HttpException(
        `Unable to reach recommendation service: ${err?.message ?? err}`,
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async triggerGeneration(triggeredBy: string | null): Promise<{ jobId: string; status: string }> {
    const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    this.logger.log(`Triggering generation job ${jobId} (by=${triggeredBy ?? 'unknown'})`);

    const response = await this.pythonPost('/generate', {
      job_id: jobId,
      triggered_by: triggeredBy,
      wait: false,
    });

    return { jobId: response?.job_id ?? jobId, status: response?.status ?? 'running' };
  }

  async getJob(jobId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('recommendation_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!data) throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    return data;
  }

  async listJobs(limit = 20): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('recommendation_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    return data ?? [];
  }

  async listReasonHistory(limit = 200): Promise<any[]> {
    const safeLimit = Number.isFinite(Number(limit))
      ? Math.max(1, Math.min(500, Math.trunc(Number(limit))))
      : 200;

    const { data, error } = await this.supabase
      .from('ai_confirmed_recommendations')
      .select(
        'recommendation_id,metier,gap_title,cert_title,cert_provider,raison,confirmed_at,updated_at',
      )
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('confirmed_at', { ascending: false, nullsFirst: false })
      .limit(safeLimit);
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const rows = data ?? [];
    if (!rows.length) return [];

    const recommendationIds = rows
      .map((row: any) => String(row?.recommendation_id ?? '').trim())
      .filter((id: string) => !!id);

    const { data: statusRows, error: statusError } = await this.supabase
      .from('ai_recommendations')
      .select('id,status,updated_at')
      .in('id', recommendationIds);
    if (statusError) throw new HttpException(statusError.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const byId = new Map(
      (statusRows ?? []).map((row: any) => [String(row?.id ?? '').trim(), row]),
    );

    return rows.map((row: any) => {
      const recommendationId = String(row?.recommendation_id ?? '').trim();
      const source = byId.get(recommendationId);
      const status = String(source?.status ?? 'approved').toLowerCase();
      const normalizedStatus =
        status === 'rejected' || status === 'edited' || status === 'approved' ? status : 'approved';
      return {
        ...row,
        recommendation_id: recommendationId,
        status: normalizedStatus,
        decision_at: source?.updated_at ?? row?.updated_at ?? row?.confirmed_at ?? null,
      };
    });
  }

  async listRecommendations(status?: string, category?: string): Promise<RecommendationRow[]> {
    const normalizedStatus = (status ?? '').trim().toLowerCase();
    const normalizedCategory = this.normalizeCategory(category);
    const globalTotalStudents = await this.getGlobalCvStudentsCount();

    if (normalizedStatus === 'approved') {
      return this.listApprovedRecommendationsForAdmin(globalTotalStudents, normalizedCategory);
    }

    let query = this.supabase
      .from('ai_recommendations')
      .select('*')
      // Business priority: lower popularity_rank means higher priority (1 highest, 99 lowest).
      .order('popularity_rank', { ascending: true, nullsFirst: false })
      .order('concern_rate', { ascending: false });
    if (normalizedStatus) {
      query = query.eq('status', normalizedStatus);
    }
    if (normalizedCategory) {
      query = query.eq('category', normalizedCategory);
    }
    const { data, error } = await query;
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const rows = ((data ?? []) as RecommendationRow[]).map((row) =>
      this.normalizeConcernRate(row, globalTotalStudents),
    );
    if (normalizedStatus) {
      return this.filterByCategory(rows, normalizedCategory);
    }

    // For "all", include approved rows from the confirmed table (source of truth)
    // so previously validated recommendations remain visible even after regeneration.
    const approvedRows = await this.listApprovedRecommendationsForAdmin(
      globalTotalStudents,
      normalizedCategory,
    );
    const approvedIds = new Set(approvedRows.map((r) => String(r.id).trim()));
    const nonApproved = rows.filter((r) => !approvedIds.has(String(r?.id ?? '').trim()));
    return this.filterByCategory([...approvedRows, ...nonApproved], normalizedCategory);
  }

  private async listApprovedRecommendationsForAdmin(
    globalTotalStudents?: number | null,
    category?: string,
  ): Promise<RecommendationRow[]> {
    const confirmedRows = await this.listAllConfirmedRecommendations();
    const rows = confirmedRows
      .map((row: any) => ({
        ...row,
        id: String(row?.recommendation_id ?? row?.id ?? '').trim(),
        status: 'approved',
        created_at: row?.created_at ?? row?.confirmed_at ?? null,
        updated_at: row?.updated_at ?? row?.confirmed_at ?? null,
      }))
        .map((row: RecommendationRow) => this.normalizeConcernRate(row, globalTotalStudents))
      .filter((row: RecommendationRow) => !!row.id);

    return this.filterByCategory(rows, category);
  }

  async listApprovedRecommendationsForStudent(authOrUserId: string): Promise<RecommendationRow[]> {
    const resolvedAuthId = await this.resolveStudentAuthId(authOrUserId);
    if (!resolvedAuthId) return [];

    const targetJob = await this.getStudentTargetJob(resolvedAuthId);
    if (!targetJob) return [];

    const globalTotalStudents = await this.getGlobalCvStudentsCount();
    const studentGapEntries = await this.getStudentGapEntries(resolvedAuthId);

    // Requirement: student recommendations come from confirmed rows only, mapped by
    // ai_confirmed_recommendations.metier <-> cv_submissions.professional_title.
    const allConfirmed = await this.listAllConfirmedRecommendations();
    const byTargetJob = allConfirmed.filter((row) => this.isMetierMatch(row?.metier, targetJob));

    return byTargetJob.map((row) =>
      this.toStudentRecommendation(row, globalTotalStudents, studentGapEntries),
    );
  }

  private async getStudentGapEntries(authId: string): Promise<StudentGapEntry[]> {
    const { data, error } = await this.supabase
      .from('cv_matching_competence_results')
      .select('metier_name,competence_name,similarity_score,status')
      .eq('auth_id', authId)
      .eq('status', 'gap');
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);

    return (data ?? [])
      .map((row: any) => ({
        metier: this.normalizeText(row?.metier_name),
        competence: this.normalizeText(row?.competence_name),
        similarityScore: Number(row?.similarity_score),
      }))
      .filter(
        (row: StudentGapEntry) =>
          !!row.metier && !!row.competence && Number.isFinite(row.similarityScore),
      );
  }

  private async listAllConfirmedRecommendations(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('ai_confirmed_recommendations')
      .select('*')
      .order('concern_rate', { ascending: false });
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    const rows = data ?? [];
    if (!rows.length) return [];

    // Confirmed table is kept as a history source. Only rows whose source recommendation
    // is currently approved should be exposed to admin approved lists and students.
    const recommendationIds = rows
      .map((row: any) => String(row?.recommendation_id ?? row?.id ?? '').trim())
      .filter((id: string) => !!id);

    if (!recommendationIds.length) return [];

    const { data: statusRows, error: statusError } = await this.supabase
      .from('ai_recommendations')
      .select('id,status')
      .in('id', recommendationIds);
    if (statusError) throw new HttpException(statusError.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const approvedIds = new Set(
      (statusRows ?? [])
        .filter((row: any) => String(row?.status ?? '').toLowerCase() === 'approved')
        .map((row: any) => String(row?.id ?? '').trim())
        .filter((id: string) => !!id),
    );

    return rows.filter((row: any) =>
      approvedIds.has(String(row?.recommendation_id ?? row?.id ?? '').trim()),
    );
  }

  private async resolveStudentAuthId(authOrUserId: string): Promise<string | null> {
    const normalized = String(authOrUserId ?? '').trim();
    if (!normalized) return null;

    if (this.uuidPattern.test(normalized)) {
      const { data: cvRow, error: cvError } = await this.supabase
        .from('cv_submissions')
        .select('auth_id')
        .eq('auth_id', normalized)
        .maybeSingle();
      if (cvError) throw new HttpException(cvError.message, HttpStatus.INTERNAL_SERVER_ERROR);
      if (cvRow?.auth_id) return String(cvRow.auth_id).trim();
    }

    const { data: userRow, error: userError } = await this.supabase
      .from('user')
      .select('auth_id')
      .eq('id', normalized)
      .maybeSingle();
    if (userError) throw new HttpException(userError.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const fromUser = String(userRow?.auth_id ?? '').trim();
    if (fromUser) return fromUser;

    return this.uuidPattern.test(normalized) ? normalized : null;
  }

  private async getStudentTargetJob(authId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('cv_submissions')
      .select('professional_title')
      .eq('auth_id', authId)
      .maybeSingle();
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const targetJob = String(data?.professional_title ?? '').trim();
    return targetJob || null;
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private isMetierMatch(metier: unknown, professionalTitle: unknown): boolean {
    const normalizedMetier = this.normalizeText(metier);
    const normalizedTitle = this.normalizeText(professionalTitle);
    if (!normalizedMetier || !normalizedTitle) return false;

    if (normalizedMetier === normalizedTitle) return true;
    if (normalizedMetier.includes(normalizedTitle) || normalizedTitle.includes(normalizedMetier)) return true;

    const metierTokens = normalizedMetier.split(' ').filter(Boolean);
    const titleTokens = new Set(normalizedTitle.split(' ').filter(Boolean));
    const commonTokenCount = metierTokens.filter((token) => titleTokens.has(token)).length;

    return commonTokenCount >= 2;
  }

  private isCompetenceMatch(left: unknown, right: unknown): boolean {
    const leftNormalized = this.normalizeText(left);
    const rightNormalized = this.normalizeText(right);
    if (!leftNormalized || !rightNormalized) return false;

    if (leftNormalized === rightNormalized) return true;
    if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) return true;

    const leftTokens = leftNormalized.split(' ').filter(Boolean);
    const rightTokens = new Set(rightNormalized.split(' ').filter(Boolean));
    const commonTokenCount = leftTokens.filter((token) => rightTokens.has(token)).length;
    // Require at least 2 common tokens to avoid accidental single-word collisions
    // between unrelated competences (e.g. "conduire" matching "conduire" in a
    // completely different competence sentence).
    return commonTokenCount >= 2;
  }

  private levelFromGapSimilarityScore(similarityScore: unknown): StudentRecommendationLevel | null {
    const score = Number(similarityScore);
    if (!Number.isFinite(score)) return null;
    if (score >= 0.5) return 'FAIBLE';
    if (score >= 0.3) return 'MOYENNE';
    if (score >= 0) return 'CRITIQUE';
    return null;
  }

  private normalizeStoredLevel(level: unknown): StudentRecommendationLevel | null {
    const v = String(level ?? '').trim().toUpperCase();
    if (v === 'CRITIQUE') return 'CRITIQUE';
    if (v === 'MOYENNE') return 'MOYENNE';
    if (v === 'FAIBLE') return 'FAIBLE';
    return null;
  }

  private levelFromStudentMatchingGaps(
    row: RecommendationRow,
    studentGapEntries: StudentGapEntry[],
  ): StudentRecommendationLevel | null {
    if (!studentGapEntries.length) return null;

    // Both recommendation.competence_name and gap entry.competence originate from
    // the same cv_matching_competence_results.competence_name column.
    // For existing approved records, competence_name was not copied to
    // ai_confirmed_recommendations, so fall back to extracting it from gap_title
    // by stripping the leading "[TYPE] " bracket prefix.
    let rawCompetence = String(row?.competence_name ?? '').trim();
    if (!rawCompetence) {
      // gap_title format: "[1. CONDUIRE] Préparer et vérifier le matériel..."
      rawCompetence = String(row?.gap_title ?? '').trim().replace(/^\[[^\]]*\]\s*/, '');
    }
    const competenceName = this.normalizeText(rawCompetence);
    if (!competenceName) return null;

    const recommendationMetier = this.normalizeText(row?.metier);

    const findScore = (enforceMetier: boolean): number | null => {
      let score: number | null = null;
      for (const entry of studentGapEntries) {
        if (entry.competence !== competenceName) continue;
        if (enforceMetier && recommendationMetier && !this.isMetierMatch(entry.metier, recommendationMetier)) continue;
        // Multiple rows for same competence are rare but possible; take the minimum
        // (most severe) score.
        score = score === null ? entry.similarityScore : Math.min(score, entry.similarityScore);
      }
      return score;
    };

    const score = findScore(true) ?? findScore(false);
    return this.levelFromGapSimilarityScore(score);
  }

  private levelFromConcernRate(concernRate: unknown): StudentRecommendationLevel | null {
    const rate = Number(concernRate);
    if (!Number.isFinite(rate)) return null;
    if (rate >= 70) return 'CRITIQUE';
    if (rate >= 40) return 'MOYENNE';
    if (rate >= 20) return 'FAIBLE';
    return null;
  }

  private toStudentRecommendation(
    row: any,
    globalTotalStudents?: number | null,
    studentGapEntries: StudentGapEntry[] = [],
  ): RecommendationRow {
    const recommendationId = String(row?.recommendation_id ?? row?.id ?? '').trim();
    const normalized = this.normalizeConcernRate(
      {
        ...row,
        id: recommendationId,
      },
      globalTotalStudents,
    );

    const level = this.levelFromStudentMatchingGaps(normalized, studentGapEntries)
      ?? this.normalizeStoredLevel(normalized?.level)
      ?? this.levelFromConcernRate(normalized?.concern_rate)
      ?? 'FAIBLE';

    return {
      ...normalized,
      level,
    };
  }

  async getRecommendation(id: string): Promise<RecommendationRow> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!data) throw new HttpException('Recommendation not found', HttpStatus.NOT_FOUND);
    const globalTotalStudents = await this.getGlobalCvStudentsCount();
    return this.normalizeConcernRate(data as RecommendationRow, globalTotalStudents);
  }

  async updateRecommendation(
    id: string,
    patch: Partial<RecommendationRow>,
    adminId?: string | null,
    comment?: string,
  ): Promise<RecommendationRow> {
    const allowed: (keyof RecommendationRow)[] = [
      'category',
      'level',
      'metier',
      'metier_id',
      'domaine',
      'competence_name',
      'competence_type',
      'keywords',
      'gap_label',
      'gap_title',
      'concern_rate',
      'students_impacted',
      'cohort_size',
      'total_students',
      'popularity_rank',
      'llm_recommendation',
      'cert_title',
      'cert_description',
      'cert_provider',
      'cert_duration',
      'cert_pricing',
      'cert_url',
      'cert_id',
      'match_confidence',
      'recommended_certs',
      'justification_llm',
      'detected_gap',
    ];
    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (patch[key] !== undefined) update[key] = patch[key];
    }
    update.status = 'edited';
    update.updated_at = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .update(update)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!data) throw new HttpException('Recommendation not found', HttpStatus.NOT_FOUND);

    // Persist the decision reason in confirmed table history and remove current targets
    // so edited rows are no longer considered active approved recommendations.
    await this.upsertConfirmedHistoryRow(data as RecommendationRow, comment);
    await this.removeConfirmedTargets(id);

    await this.logAdminFeedback(id, adminId ?? null, 'edited', data.cert_title ?? '', comment);

    const globalTotalStudents = await this.getGlobalCvStudentsCount();
    return this.normalizeConcernRate(data as RecommendationRow, globalTotalStudents);
  }

  async rejectRecommendation(id: string, adminId: string | null, comment?: string): Promise<void> {
    const recommendation = await this.getRecommendation(id);

    const { error } = await this.supabase
      .from('ai_recommendations')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);

    // Persist rejection reason in confirmed table history and remove current targets
    // so rejected rows are no longer considered active approved recommendations.
    await this.upsertConfirmedHistoryRow(recommendation, comment);
    await this.removeConfirmedTargets(id);

    await this.logAdminFeedback(id, adminId, 'rejected', '', comment);
  }

  private async upsertConfirmedHistoryRow(row: RecommendationRow, reason?: string): Promise<void> {
    const nowIso = new Date().toISOString();
    const recommendationId = String(row?.id ?? row?.recommendation_id ?? '').trim();
    if (!recommendationId) {
      throw new HttpException('Recommendation id missing for history sync', HttpStatus.BAD_REQUEST);
    }

    const historyRow = {
      recommendation_id: recommendationId,
      category: row?.category ?? 'TARGET_METIER',
      competence_name: row?.competence_name ?? null,
      gap_label: row?.gap_label ?? row?.competence_name ?? 'N/A',
      gap_title: row?.gap_title ?? row?.competence_name ?? 'N/A',
      level: row?.level ?? 'MOYENNE',
      metier: row?.metier ?? 'N/A',
      keywords: row?.keywords ?? [],
      concern_rate: Number(row?.concern_rate ?? 0),
      students_impacted: Number(row?.students_impacted ?? 0),
      total_students: Number(row?.total_students ?? 0),
      llm_recommendation: row?.llm_recommendation ?? '',
      cert_title: row?.cert_title ?? 'N/A',
      cert_description: row?.cert_description ?? null,
      cert_provider: row?.cert_provider ?? 'N/A',
      cert_duration: row?.cert_duration ?? 'N/A',
      cert_pricing: row?.cert_pricing ?? 'N/A',
      cert_url: row?.cert_url ?? null,
      cert_id: row?.cert_id ?? null,
      match_confidence: row?.match_confidence ?? null,
      raison: reason ?? '',
      confirmed_at: row?.confirmed_at ?? nowIso,
      updated_at: nowIso,
    };

    const { error } = await this.supabase
      .from('ai_confirmed_recommendations')
      .upsert(historyRow, { onConflict: 'recommendation_id' });
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private async removeConfirmedTargets(recommendationId: string): Promise<void> {
    const { error: targetError } = await this.supabase
      .from('ai_confirmed_recommendation_targets')
      .delete()
      .eq('recommendation_id', recommendationId);
    if (targetError) throw new HttpException(targetError.message, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async approveRecommendation(id: string, adminId: string | null, comment?: string): Promise<RecommendationRow> {
    const row = await this.getRecommendation(id);

    const confirmed = {
      recommendation_id: row.id,
      category: row.category ?? 'TARGET_METIER',
      competence_name: row.competence_name ?? null,
      gap_label: row.gap_label ?? row.competence_name ?? 'N/A',
      gap_title: row.gap_title ?? row.competence_name ?? 'N/A',
      level: row.level ?? 'MOYENNE',
      metier: row.metier ?? 'N/A',
      keywords: row.keywords ?? [],
      concern_rate: Number(row.concern_rate ?? 0),
      students_impacted: Number(row.students_impacted ?? 0),
      total_students: Number(row.total_students ?? 0),
      llm_recommendation: row.llm_recommendation ?? '',
      cert_title: row.cert_title ?? 'N/A',
      cert_description: row.cert_description ?? null,
      cert_provider: row.cert_provider ?? 'N/A',
      cert_duration: row.cert_duration ?? 'N/A',
      cert_pricing: row.cert_pricing ?? 'N/A',
      cert_url: row.cert_url ?? null,
      cert_id: row.cert_id ?? null,
      match_confidence: row.match_confidence ?? null,
      raison: comment ?? '',
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await this.supabase
      .from('ai_confirmed_recommendations')
      .upsert(confirmed, { onConflict: 'recommendation_id' });
    if (upsertErr) throw new HttpException(upsertErr.message, HttpStatus.INTERNAL_SERVER_ERROR);

    // Copy impacted targets
    const { data: targets, error: targetsErr } = await this.supabase
      .from('ai_recommendation_targets')
      .select('auth_id')
      .eq('recommendation_id', row.id);
    if (targetsErr) throw new HttpException(targetsErr.message, HttpStatus.INTERNAL_SERVER_ERROR);

    const confirmedTargets = (targets ?? []).map((t: any) => ({
      recommendation_id: row.id,
      auth_id: t.auth_id,
    }));

    if (confirmedTargets.length) {
      const { error: tErr } = await this.supabase
        .from('ai_confirmed_recommendation_targets')
        .upsert(confirmedTargets, { onConflict: 'recommendation_id,auth_id' });
      if (tErr) this.logger.warn(`confirmed targets upsert failed: ${tErr.message}`);
    }

    // Remove redundant confirmed targets for the same student when this recommendation
    // is approved for the student's target métier. This prevents duplicate active
    // recommendations coming from "other métier" for the same gap/cert while keeping
    // historical confirmed recommendation rows intact so they can be re-applied later
    // if the student removes the target métier.
    try {
      if (confirmedTargets.length) {
        const gapLabel = confirmed.gap_label ?? null;
        const certTitle = confirmed.cert_title ?? null;
        const currentMetier = confirmed.metier ?? null;

        // For each confirmed target (student), find other confirmed recommendations
        // that match by gap_label OR cert_title, belong to a different metier, and
        // remove the confirmed target link for that student.
        for (const t of confirmedTargets) {
          const authId = t.auth_id;
          const { data: allConfirmed, error: fetchErr } = await this.supabase
            .from('ai_confirmed_recommendations')
            .select('recommendation_id,metier,gap_label,cert_title')
            .neq('recommendation_id', row.id)
            .limit(2000);

          if (fetchErr) {
            this.logger.warn(`finding matching confirmed recommendations failed: ${fetchErr.message}`);
            continue;
          }

          const toRemoveIds: string[] = [];
          for (const m of (allConfirmed ?? [])) {
            const mid = String(m?.recommendation_id ?? '').trim();
            const mMetier = String(m?.metier ?? '').trim();
            const mgap = String(m?.gap_label ?? '').trim();
            const mcert = String(m?.cert_title ?? '').trim();
            if (!mid) continue;
            // Only remove if metier differs from current approved metier
            if (currentMetier && mMetier && this.normalizeText(currentMetier) === this.normalizeText(mMetier)) {
              continue;
            }
            // Remove if gap_label or cert_title matches the current confirmed recommendation
            if ((gapLabel && mgap && this.normalizeText(gapLabel) === this.normalizeText(mgap))
              || (certTitle && mcert && this.normalizeText(certTitle) === this.normalizeText(mcert))) {
              toRemoveIds.push(mid);
            }
          }

          if (toRemoveIds.length) {
            const { error: delErr } = await this.supabase
              .from('ai_confirmed_recommendation_targets')
              .delete()
              .in('recommendation_id', toRemoveIds)
              .eq('auth_id', authId);
            if (delErr) this.logger.warn(`failed removing redundant confirmed targets: ${delErr.message}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`cleanup of redundant confirmed targets failed: ${err?.message ?? err}`);
    }

    const { error: statusErr } = await this.supabase
      .from('ai_recommendations')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (statusErr) throw new HttpException(statusErr.message, HttpStatus.INTERNAL_SERVER_ERROR);

    await this.logAdminFeedback(row.id, adminId, 'approved', row.cert_title ?? '', comment);

    return { ...row, status: 'approved' };
  }

  private async logAdminFeedback(
    recommendationId: string,
    adminId: string | null,
    action: 'approved' | 'rejected' | 'edited',
    finalCerts: string,
    comment?: string,
  ): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      await this.supabase.from('admin_feedback').insert({
        id: `fb_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        recommendation_id: recommendationId,
        admin_id: adminId,
        action_taken: action,
        final_certs: finalCerts,
        admin_comment: comment ?? '',
        created_at: nowIso,
      });
    } catch (err: any) {
      this.logger.warn(`admin_feedback insert failed: ${err?.message ?? err}`);
    }
  }
}
