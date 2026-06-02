import { Component, ChangeDetectionStrategy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CvSubmissionService,
  MatchingAnalysisResponse,
  MatchingAnalysisTraceResponse,
  MatchingGapEntry,
  MatchingMetierRankingEntry,
} from '../cv-ats/cv-submission.service';

type DisplayMetierCard = {
  metier: string;
  domaine: string;
  coveragePct: number;
  matched: number;
  nCompetences: number;
  avgScore: number;
  topSkills: Array<{ skill: string; score: number }>;
};

type DisplayGapRow = {
  refCompetence: string;
  refMetier: string;
  refDomaine: string;
  similarityScore: number;
};

@Component({
  selector: 'app-matching',
  imports: [CommonModule],
  templateUrl: './matching.html',
  styleUrl: './matching.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Matching implements OnInit {
  loading = true;
  refreshing = false;
  errorMessage = '';
  analysis: MatchingAnalysisResponse | null = null;
  trace: MatchingAnalysisTraceResponse | null = null;
  targetMetierLabel = '';
  allGapsMetierFilter = '';
  private readonly matchStatusThreshold = 0.6;
  // Fallback used only before the analysis has loaded. Once analysis is in,
  // referentielSize is derived from the data (see the getter below).
  private readonly referentielSizeFallback = 158;
  private metierLookupLoaded = false;
  private readonly metierLabelById = new Map<string, string>();

  constructor(
    private readonly cvSubmissionService: CvSubmissionService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    const cachedTrace = this.cvSubmissionService.getCachedMatchingAnalysisTrace();
    if (cachedTrace) {
      this.trace = cachedTrace;
      this.analysis = cachedTrace.analysis;
      this.loading = false;
      this.cdr.markForCheck();
      void this.resolveTargetMetierLabel();
    } else {
      const cached = this.cvSubmissionService.getCachedMatchingAnalysis();
      if (cached) {
        this.analysis = cached;
        this.loading = false;
        this.cdr.markForCheck();
        void this.resolveTargetMetierLabel();
      }
    }

    try {
      const freshTrace = await this.cvSubmissionService.fetchMatchingAnalysisTrace(false);
      if (freshTrace) {
        this.trace = freshTrace;
        this.analysis = freshTrace.analysis;
        void this.resolveTargetMetierLabel();
      } else {
        const fresh = await this.cvSubmissionService.fetchMatchingAnalysis(false);
        if (fresh) {
          this.analysis = fresh;
          void this.resolveTargetMetierLabel();
        }
      }
    } catch (err) {
      console.error('Matching analysis/trace fetch failed:', err);
      if (!this.analysis) {
        this.errorMessage = 'Impossible de charger votre analyse matching/gap pour le moment.';
      }
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async refresh(force = true): Promise<void> {
    if (this.refreshing) return;

    this.refreshing = true;
    this.errorMessage = '';

    try {
      const freshTrace = await this.cvSubmissionService.fetchMatchingAnalysisTrace(force);
      if (freshTrace) {
        this.trace = freshTrace;
        this.analysis = freshTrace.analysis;
        void this.resolveTargetMetierLabel();
      } else {
        const fresh = await this.cvSubmissionService.fetchMatchingAnalysis(force);
        if (fresh) {
          this.analysis = fresh;
          void this.resolveTargetMetierLabel();
        }
      }
    } catch (err) {
      console.error('Matching analysis refresh failed:', err);
      this.errorMessage = 'Echec du recalcul matching/gap. Verifiez le service Python.';
    } finally {
      this.refreshing = false;
      this.cdr.markForCheck();
    }
  }

  scorePercent(score: number): string {
    const value = Number(score);
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    return `${(clamped * 100).toFixed(1)}%`;
  }

  coveragePercent(value: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  metierCoveragePct(item: Pick<DisplayMetierCard, 'coveragePct'> | null | undefined): number {
    if (!item) return 0;
    return Number(this.coveragePercent(item.coveragePct).toFixed(1));
  }

  onAllGapsMetierFilterChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    this.allGapsMetierFilter = String(target?.value ?? '');
  }

  gapSeverity(score: number): string {
    if (score >= 0.5) return 'Faible';
    if (score >= 0.3) return 'Moyen';
    return 'Critique';
  }

  gapSeverityClass(score: number): string {
    if (score >= 0.5) return 'severity-low';
    if (score >= 0.3) return 'severity-medium';
    return 'severity-high';
  }

  private computeCoveragePctFromMatchedSimilarity(
    matchedCompetences: Array<{ skill: string; score: number }>,
    nCompetences: number,
    fallbackPct: number,
  ): number {
    const totalCompetences = Number(nCompetences);

    if (Number.isFinite(totalCompetences) && totalCompetences > 0) {
      const similaritySum = matchedCompetences.reduce((sum, competence) => {
        const score = Number(competence?.score);
        if (!Number.isFinite(score)) return sum;
        return sum + Math.max(0, Math.min(1, score));
      }, 0);

      return Number(this.coveragePercent((similaritySum / totalCompetences) * 100).toFixed(1));
    }

    return Number(this.coveragePercent(fallbackPct).toFixed(1));
  }

  private normalizeMetierId(value: unknown): string {
    if (value === undefined || value === null) return '';

    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }

    if (typeof value === 'object') {
      const oid = (value as any)?.$oid;
      if (typeof oid === 'string') {
        return oid.trim().toLowerCase();
      }

      const toHexString = (value as any)?.toHexString;
      if (typeof toHexString === 'function') {
        try {
          const hex = String(toHexString.call(value)).trim().toLowerCase();
          if (hex) return hex;
        } catch {
          // ignore invalid object-id transforms
        }
      }
    }

    return String(value).trim().toLowerCase();
  }

  private normalizeMetierLabel(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenizeMetierLabel(value: string): string[] {
    const normalized = this.normalizeMetierLabel(value);
    if (!normalized) return [];
    return normalized.split(' ').filter((token) => token.length > 1);
  }

  private isLikelyMetierIdentifier(value: string): boolean {
    return /^metier_[a-z0-9_-]+$/i.test(value) || /^[a-f0-9]{24}$/i.test(value);
  }

  private metierMatchesRef(refMetier: string, targetNormalized: string): boolean {
    const refNormalized = this.normalizeMetierLabel(refMetier);
    if (!refNormalized || !targetNormalized) return false;

    if (
      refNormalized === targetNormalized
      || refNormalized.includes(targetNormalized)
      || targetNormalized.includes(refNormalized)
    ) {
      return true;
    }

    const refTokens = this.tokenizeMetierLabel(refNormalized);
    const targetTokens = this.tokenizeMetierLabel(targetNormalized);
    if (!refTokens.length || !targetTokens.length) return false;

    const targetSet = new Set(targetTokens);
    let overlap = 0;
    for (const token of refTokens) {
      if (targetSet.has(token)) overlap += 1;
    }

    return overlap >= 2;
  }

  private async loadMetierLookupIfNeeded(): Promise<void> {
    if (this.metierLookupLoaded) return;
    this.metierLookupLoaded = true;

    try {
      const metiers = await this.cvSubmissionService.fetchMetiers();
      for (const metier of metiers) {
        const id = this.normalizeMetierId(metier?._id);
        const label = String(metier?.nom_metier ?? metier?.nom ?? '').trim();

        if (id && label) {
          this.metierLabelById.set(id, label);
        }
      }
    } catch (err) {
      console.warn('Failed to load metier lookup for target gap display:', err);
    }
  }

  private async resolveTargetMetierLabel(): Promise<void> {
    const selectedMetierId = this.normalizeMetierId(this.analysis?.selectedMetierId);

    if (!selectedMetierId) {
      this.targetMetierLabel = '';
      this.cdr.markForCheck();
      return;
    }

    let nextLabel = '';

    await this.loadMetierLookupIfNeeded();

    const resolved = this.metierLabelById.get(selectedMetierId);
    if (resolved) {
      nextLabel = resolved;
    } else {
      try {
        const cv = await this.cvSubmissionService.fetchMyCv(selectedMetierId);
        const profileTitle = String(cv?.professionalTitle ?? '').trim();
        if (profileTitle.length > 0) {
          nextLabel = profileTitle;
        }
      } catch {
        // ignore profile lookup failures and continue with local fallback
      }

      if (!nextLabel) {
        nextLabel = this.isLikelyMetierIdentifier(selectedMetierId)
          ? ''
          : selectedMetierId;
      }
    }

    this.targetMetierLabel = nextLabel;
    this.cdr.markForCheck();
  }

  private getMetierCardsSource(): DisplayMetierCard[] {
    const traceMatchedCompetenceMap = this.collectTraceMatchedMetierCompetences();
    const analysisMatchedCompetenceMap = this.collectAnalysisMatchedMetierCompetences();
    const traceRows = this.trace?.metierScores ?? [];
    if (traceRows.length > 0) {
      return traceRows.map((row) => {
        const matchedCompetences = this.resolveMetierMatchedCompetences(
          row.metierName,
          row.topSkills,
          traceMatchedCompetenceMap,
          analysisMatchedCompetenceMap,
        );

        return {
          metier: row.metierName,
          domaine: row.domaineName,
          coveragePct: this.coveragePercent(row.coveragePct),
          matched: matchedCompetences.length,
          nCompetences: row.nCompetences,
          avgScore: row.avgScore,
          topSkills: matchedCompetences,
        };
      });
    }

    const ranking = this.analysis?.metierRanking ?? [];
    return ranking.map((entry: MatchingMetierRankingEntry) => {
      const matchedCompetences = this.resolveMetierMatchedCompetences(
        entry.metier,
        entry.topSkills,
        traceMatchedCompetenceMap,
        analysisMatchedCompetenceMap,
      );

      return {
        metier: entry.metier,
        domaine: entry.domaine,
        coveragePct: this.coveragePercent(entry.coveragePct),
        matched: matchedCompetences.length,
        nCompetences: entry.nCompetences,
        avgScore: entry.avgScore,
        topSkills: matchedCompetences,
      };
    });
  }

  private buildMetierCompetenceMap(
    rows: Array<{ metier: string; competence: string; score: number }>,
  ): Map<string, Array<{ skill: string; score: number }>> {
    const grouped = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const metierKey = this.normalizeMetierLabel(row.metier);
      const competence = String(row.competence ?? '').trim();
      const score = Number(row.score);
      if (!metierKey || !competence || !Number.isFinite(score)) continue;

      const bucket = grouped.get(metierKey) ?? new Map<string, number>();
      const current = bucket.get(competence) ?? -1;
      if (score > current) {
        bucket.set(competence, score);
      }
      grouped.set(metierKey, bucket);
    }

    const result = new Map<string, Array<{ skill: string; score: number }>>();
    for (const [metierKey, competenceScores] of grouped.entries()) {
      const ordered = Array.from(competenceScores.entries())
        .sort((left, right) => (
          right[1] - left[1]
          || left[0].localeCompare(right[0], 'fr', { sensitivity: 'base' })
        ))
        .map(([skill, score]) => ({ skill, score: Number(score.toFixed(4)) }));
      result.set(metierKey, ordered);
    }

    return result;
  }

  private collectTraceMetierCompetences(): Map<string, Array<{ skill: string; score: number }>> {
    const rows = (this.trace?.competenceResults ?? []).map((entry) => ({
      metier: entry.metierName,
      competence: entry.competenceName,
      score: entry.similarityScore,
    }));
    return this.buildMetierCompetenceMap(rows);
  }

  private collectAnalysisMetierCompetences(): Map<string, Array<{ skill: string; score: number }>> {
    const rows = [
      ...(this.analysis?.matches ?? []),
      ...(this.analysis?.gaps ?? []),
    ].map((entry) => ({
      metier: entry.refMetier,
      competence: entry.refCompetence,
      score: entry.similarityScore,
    }));
    return this.buildMetierCompetenceMap(rows);
  }

  private resolveMetierCompetences(
    metierName: string,
    fallback: Array<{ skill: string; score: number }>,
    traceMap: Map<string, Array<{ skill: string; score: number }>>,
    analysisMap: Map<string, Array<{ skill: string; score: number }>>,
  ): Array<{ skill: string; score: number }> {
    const normalizedMetier = this.normalizeMetierLabel(metierName);
    if (!normalizedMetier) return fallback;

    const fromTrace = traceMap.get(normalizedMetier) ?? [];
    if (fromTrace.length > 0) return fromTrace;

    const fromAnalysis = analysisMap.get(normalizedMetier) ?? [];
    if (fromAnalysis.length > 0) return fromAnalysis;

    return fallback;
  }

  private collectTraceMatchedMetierCompetences(): Map<string, Array<{ skill: string; score: number }>> {
    const rows = (this.trace?.competenceResults ?? [])
      .filter((entry) => entry.status === 'match')
      .map((entry) => ({
        metier: entry.metierName,
        competence: entry.competenceName,
        score: entry.similarityScore,
      }));
    return this.buildMetierCompetenceMap(rows);
  }

  private collectAnalysisMatchedMetierCompetences(): Map<string, Array<{ skill: string; score: number }>> {
    const rows = (this.analysis?.matches ?? []).map((entry) => ({
      metier: entry.refMetier,
      competence: entry.refCompetence,
      score: entry.similarityScore,
    }));
    return this.buildMetierCompetenceMap(rows);
  }

  private resolveMetierMatchedCompetences(
    metierName: string,
    fallback: Array<{ skill: string; score: number }>,
    traceMap: Map<string, Array<{ skill: string; score: number }>>,
    analysisMap: Map<string, Array<{ skill: string; score: number }>>,
  ): Array<{ skill: string; score: number }> {
    const normalizedMetier = this.normalizeMetierLabel(metierName);
    if (!normalizedMetier) {
      return fallback.filter((skill) => Number(skill?.score) >= this.matchStatusThreshold);
    }

    const fromTrace = traceMap.get(normalizedMetier) ?? [];
    if (fromTrace.length > 0) return fromTrace;

    const fromAnalysis = analysisMap.get(normalizedMetier) ?? [];
    if (fromAnalysis.length > 0) return fromAnalysis;

    return fallback.filter((skill) => Number(skill?.score) >= this.matchStatusThreshold);
  }

  private getGapRowsSource(): DisplayGapRow[] {
    const traceRows = this.trace?.competenceResults ?? [];
    if (traceRows.length > 0) {
      return traceRows
        .filter((row) => row.status === 'gap')
        .map((row) => ({
          refCompetence: row.competenceName,
          refMetier: row.metierName,
          refDomaine: row.domaineName,
          similarityScore: row.similarityScore,
        }));
    }

    const allGaps = this.analysis?.gaps ?? [];
    const source = allGaps.length > 0
      ? allGaps
      : (this.analysis?.topMetierGaps ?? []);

    return source.map((entry: MatchingGapEntry) => ({
      refCompetence: entry.refCompetence,
      refMetier: entry.refMetier,
      refDomaine: entry.refDomaine,
      similarityScore: entry.similarityScore,
    }));
  }

  private gapCriticityOrder(score: number): number {
    if (score < 0.3) return 0; // Critique
    if (score < 0.5) return 1; // Moyen
    return 2; // Faible
  }

  private sortGapsByCriticity(rows: DisplayGapRow[]): DisplayGapRow[] {
    return [...rows].sort((left, right) => (
      this.gapCriticityOrder(left.similarityScore) - this.gapCriticityOrder(right.similarityScore)
      || left.similarityScore - right.similarityScore
      || left.refMetier.localeCompare(right.refMetier, 'fr', { sensitivity: 'base' })
      || left.refCompetence.localeCompare(right.refCompetence, 'fr', { sensitivity: 'base' })
    ));
  }

  get displayedMetiers(): DisplayMetierCard[] {
    return [...this.getMetierCardsSource()]
      .sort((left, right) => (
        right.coveragePct - left.coveragePct
        || right.avgScore - left.avgScore
        || left.metier.localeCompare(right.metier, 'fr', { sensitivity: 'base' })
      ))
      .slice(0, 6);
  }

  get topMetiers(): DisplayMetierCard[] {
    return this.displayedMetiers;
  }

  get topMetierSummary(): Pick<DisplayMetierCard, 'metier' | 'domaine' | 'coveragePct'> | null {
    const [topMetier] = this.topMetiers;
    if (topMetier) {
      return topMetier;
    }

    return this.analysis?.topMetier ?? null;
  }

  get topMetierSummaryCoveragePct(): number {
    return this.metierCoveragePct(this.topMetierSummary);
  }

  // Real size of the ISGIS referential = every reference competence is classified
  // as exactly one match OR one gap, so the total analyzed is nMatches + nGaps.
  // Hardcoding a magic number (158) made the denominators and coverage % wrong
  // whenever liste_competences held a different number of rows, and stopped
  // match% + gap% from summing to 100%.
  get referentielSize(): number {
    const summary = this.analysis?.summary;
    if (summary) {
      const total = Number(summary.nMatches ?? 0) + Number(summary.nGaps ?? 0);
      if (total > 0) return total;
    }
    return this.referentielSizeFallback;
  }

  get matchCoveragePct(): number {
    const size = this.referentielSize;
    if (size <= 0) return 0;
    const n = Number(this.analysis?.summary.nMatches ?? 0);
    return Math.round((n / size) * 100);
  }

  get gapPct(): number {
    const size = this.referentielSize;
    if (size <= 0) return 0;
    const n = Number(this.analysis?.summary.nGaps ?? 0);
    return Math.round((n / size) * 100);
  }

  get criticalGapsCount(): number {
    return this.getGapRowsSource().filter(g => g.similarityScore < 0.3).length;
  }

  get mediumGapsCount(): number {
    return this.getGapRowsSource().filter(g => g.similarityScore >= 0.3 && g.similarityScore < 0.5).length;
  }

  get lowGapsCount(): number {
    return this.getGapRowsSource().filter(g => g.similarityScore >= 0.5).length;
  }

  get topMetierNSkills(): number {
    return this.topMetiers[0]?.nCompetences ?? 0;
  }

  get topMetierMatches(): number {
    return this.topMetiers[0]?.matched ?? 0;
  }

  get topMetierGapsCount(): number {
    const top = this.topMetiers[0];
    if (!top) return 0;
    const topNormalized = this.normalizeMetierLabel(top.metier);
    return this.getGapRowsSource()
      .filter((gap) => this.metierMatchesRef(gap.refMetier, topNormalized))
      .length;
  }

  get displayedGaps(): DisplayGapRow[] {
    return this.sortGapsByCriticity(this.getGapRowsSource());
  }

  get targetMetierCoveragePct(): number | null {
    const targetNormalized = this.normalizeMetierLabel(this.targetMetierLabel);
    if (!targetNormalized) return null;

    const targetCard = this.getMetierCardsSource()
      .find((item) => this.metierMatchesRef(item.metier, targetNormalized));

    if (!targetCard) return null;
    return this.metierCoveragePct(targetCard);
  }

  get allGapsMetierOptions(): string[] {
    const seen = new Set<string>();
    const options: string[] = [];

    for (const gap of this.displayedGaps) {
      const label = String(gap?.refMetier ?? '').trim();
      const normalized = this.normalizeMetierLabel(label);
      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      options.push(label);
    }

    return options.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  }

  get filteredAllGaps(): DisplayGapRow[] {
    const source = this.displayedGaps;
    const targetNormalized = this.normalizeMetierLabel(this.allGapsMetierFilter);

    if (!targetNormalized) return source;

    return source.filter((gap) => this.metierMatchesRef(gap.refMetier, targetNormalized));
  }

  get topThreeMatchingMetiers(): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of this.topMetiers) {
      const label = String(item?.metier ?? '').trim();
      const normalized = this.normalizeMetierLabel(label);
      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      result.push(label);

      if (result.length >= 3) break;
    }

    return result;
  }

  get displayedTargetMetierGaps(): DisplayGapRow[] {
    const source = this.displayedGaps;
    const targetNormalized = this.normalizeMetierLabel(this.targetMetierLabel);

    if (!targetNormalized) return [];

    return source
      .filter((gap) => this.metierMatchesRef(gap.refMetier, targetNormalized))
      .slice(0, 20);
  }

  get displayedTopThreeMetierGaps(): DisplayGapRow[] {
    const source = this.displayedGaps;
    const topThreeNormalized = this.topThreeMatchingMetiers
      .map((label) => this.normalizeMetierLabel(label))
      .filter((label) => label.length > 0);

    if (!topThreeNormalized.length) return [];

    return source
      .filter((gap) => topThreeNormalized.some((label) => this.metierMatchesRef(gap.refMetier, label)))
      .slice(0, 48);
  }

  get targetMetierEmptyMessage(): string {
    if (!this.targetMetierLabel) {
      return 'Métier visé introuvable dans les données analysées. Vérifiez le métier choisi dans le profil CV.';
    }
    return `Aucun gap prioritaire trouvé pour le métier visé: ${this.targetMetierLabel}.`;
  }

  trackByMetier(_: number, item: DisplayMetierCard): string {
    return `${item.metier}::${item.domaine}`;
  }

  trackByGap(_: number, item: DisplayGapRow): string {
    return `${item.refMetier}::${item.refCompetence}`;
  }
}
