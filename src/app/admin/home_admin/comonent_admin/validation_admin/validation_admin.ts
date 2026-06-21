import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Recommendation,
  RecommendationJob,
  RecommendationReasonHistoryItem,
  ValidationAdminService,
} from './validation-admin.service';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'edited';
type LevelFilter = 'all' | 'CRITIQUE' | 'MOYENNE' | 'FAIBLE';

@Component({
  selector: 'app-validation-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './validation_admin.html',
  styleUrl: './validation_admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValidationAdmin implements OnInit, OnDestroy {
  activeView: 'recommendations' | 'history' = 'recommendations';

  recommendations: Recommendation[] = [];
  historyItems: RecommendationReasonHistoryItem[] = [];

  loading = false;
  historyLoading = false;
  generating = false;
  loadError = '';
  historyError = '';
  actionError = '';
  statusFilter: StatusFilter = 'pending';
  levelFilter: LevelFilter = 'all';
  searchQuery = '';

  hasAnyRecommendations = false;
  currentJob: RecommendationJob | null = null;
  private pollTimer: any = null;

  editingId: string | null = null;
  editDraft: Partial<Recommendation> = {};

  decisionAction: 'approve' | 'reject' | 'edit' | null = null;
  decisionTargetId: string | null = null;
  decisionReason = '';
  decisionError = '';
  decisionSubmitting = false;

  constructor(
    private readonly svc: ValidationAdminService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    void this.refresh();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      const filter = this.statusFilter === 'all' ? undefined : this.statusFilter;
      const [filtered, all] = await Promise.all([
        this.svc.list(filter),
        this.svc.list(),
      ]);
      this.recommendations = filtered;
      this.hasAnyRecommendations = all.length > 0;
    } catch (err: any) {
      this.loadError = this.formatError(err, 'Impossible de charger les recommandations.');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async generate(): Promise<void> {
    this.generating = true;
    this.actionError = '';
    try {
      const res = await this.svc.trigger();
      const jobId = res?.jobId;
      if (!jobId) {
        this.actionError = 'Réponse invalide du serveur : jobId manquant.';
        this.generating = false;
        return;
      }
      this.currentJob = { id: jobId, status: 'running' };
      this.startPolling(jobId);
    } catch (err: any) {
      this.actionError = this.formatError(err, 'La génération a échoué.');
      this.generating = false;
    } finally {
      this.cdr.markForCheck();
    }
  }

  private startPolling(jobId: string): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      try {
        const job = await this.svc.getJob(jobId);
        this.currentJob = job;
        if (job.status === 'succeeded' || job.status === 'failed') {
          this.stopPolling();
          this.generating = false;
          if (job.status === 'succeeded') {
            await this.refresh();
          } else if (job.error) {
            this.actionError = job.error;
          }
        }
        this.cdr.markForCheck();
      } catch (err: any) {
        this.actionError = this.formatError(err, 'Impossible de lire le statut du job.');
        this.stopPolling();
        this.generating = false;
        this.cdr.markForCheck();
      }
    }, 2500);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  setFilter(filter: StatusFilter): void {
    if (this.statusFilter === filter) return;
    this.statusFilter = filter;
    void this.refresh();
  }

  setView(view: 'recommendations' | 'history'): void {
    if (this.activeView === view) return;
    this.activeView = view;
    this.loadError = '';
    this.historyError = '';
    if (view === 'history') {
      void this.refreshHistory();
    }
    this.cdr.markForCheck();
  }

  async refreshHistory(): Promise<void> {
    this.historyLoading = true;
    this.historyError = '';
    try {
      this.historyItems = await this.svc.listHistory(300);
    } catch (err: any) {
      this.historyError = this.formatError(err, "Impossible de charger l'historique des raisons.");
    } finally {
      this.historyLoading = false;
      this.cdr.markForCheck();
    }
  }

  setLevelFilter(filter: LevelFilter): void {
    this.levelFilter = this.levelFilter === filter ? 'all' : filter;
    this.cdr.markForCheck();
  }

  clearSearch(): void {
    if (!this.searchQuery) return;
    this.searchQuery = '';
    this.cdr.markForCheck();
  }

  startEdit(reco: Recommendation): void {
    this.editingId = reco.id;
    this.editDraft = {
      cert_title: reco.cert_title ?? '',
      cert_provider: reco.cert_provider ?? '',
      cert_duration: reco.cert_duration ?? '',
      cert_pricing: reco.cert_pricing ?? '',
      cert_url: reco.cert_url ?? '',
      cert_description: reco.cert_description ?? '',
      llm_recommendation: reco.llm_recommendation ?? '',
      gap_label: reco.gap_label ?? '',
      gap_title: reco.gap_title ?? '',
      level: reco.level,
    };
    this.cdr.markForCheck();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editDraft = {};
    this.cdr.markForCheck();
  }

  async saveEdit(id: string, reason: string): Promise<void> {
    this.actionError = '';
    try {
      await this.svc.update(id, this.editDraft, reason);
      this.editingId = null;
      this.editDraft = {};
      await this.refresh();
    } catch (err: any) {
      this.actionError = this.formatError(err, 'La sauvegarde a échoué.');
      this.cdr.markForCheck();
      throw err;
    }
  }

  openDecisionModal(action: 'approve' | 'reject' | 'edit', id: string): void {
    this.decisionAction = action;
    this.decisionTargetId = id;
    this.decisionReason = '';
    this.decisionError = '';
    this.actionError = '';
    this.cdr.markForCheck();
  }

  closeDecisionModal(): void {
    if (this.decisionSubmitting) return;
    this.resetDecisionModal();
    this.cdr.markForCheck();
  }

  async submitDecision(): Promise<void> {
    if (!this.decisionAction || !this.decisionTargetId) return;
    const action = this.decisionAction;

    const reason = this.decisionReason.trim();
    if (!reason) {
      this.decisionError = this.decisionReasonRequiredError();
      this.cdr.markForCheck();
      return;
    }

    this.decisionSubmitting = true;
    this.decisionError = '';
    this.actionError = '';

    try {
      if (action === 'approve') {
        await this.svc.approve(this.decisionTargetId, reason);
      } else if (action === 'reject') {
        await this.svc.reject(this.decisionTargetId, reason);
      } else {
        await this.saveEdit(this.decisionTargetId, reason);
      }
      this.resetDecisionModal();
      if (action !== 'edit') {
        await this.refresh();
      }
    } catch (err: any) {
      this.decisionError = this.formatError(
        err,
        this.decisionAction === 'approve'
          ? "L'approbation a échoué."
          : this.decisionAction === 'reject'
            ? 'Le rejet a échoué.'
            : 'La modification a échoué.',
      );
    } finally {
      this.decisionSubmitting = false;
      this.cdr.markForCheck();
    }
  }

  decisionTitle(): string {
    return this.decisionAction === 'approve'
      ? 'Approuver la recommandation'
      : this.decisionAction === 'reject'
        ? 'Rejeter la recommandation'
        : 'Confirmer la modification';
  }

  decisionReasonLabel(): string {
    return this.decisionAction === 'approve'
      ? "Raison de l'approbation"
      : this.decisionAction === 'reject'
        ? 'Raison du rejet'
        : 'Raison de la modification';
  }

  decisionConfirmLabel(): string {
    return this.decisionAction === 'approve'
      ? 'Confirmer approbation'
      : this.decisionAction === 'reject'
        ? 'Confirmer rejet'
        : 'Confirmer modification';
  }

  decisionBodyText(): string {
    return this.decisionAction === 'approve'
      ? 'La recommandation sera publiée pour les étudiants concernés.'
      : this.decisionAction === 'reject'
        ? 'La recommandation sera marquée comme rejetée et retirée du pool confirmé.'
        : 'La recommandation sera enregistrée avec le statut Modifiée et nécessitera une ré-approbation.';
  }

  decisionReasonPlaceholder(): string {
    return this.decisionAction === 'approve'
      ? "Ex: contenu validé après vérification pédagogique."
      : this.decisionAction === 'reject'
        ? "Ex: certification non pertinente pour l'écart ciblé."
        : "Ex: correction du titre et du fournisseur de certification.";
  }

  get stats() {
    const total = this.recommendations.length;
    const byLevel = (level: string) =>
      this.recommendations.filter((r) => (r.level ?? '').toUpperCase() === level).length;
    return {
      total,
      critique: byLevel('CRITIQUE'),
      moyenne: byLevel('MOYENNE'),
      faible: byLevel('FAIBLE'),
    };
  }

  get filteredRecommendations(): Recommendation[] {
    const normalizedQuery = this.searchQuery.trim().toLowerCase();
    return this.recommendations
      .filter((reco) => {
        if (this.levelFilter !== 'all' && (reco.level ?? '').toUpperCase() !== this.levelFilter) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return this.matchesSearch(reco, normalizedQuery);
      })
      .sort((a, b) => {
        // Primary: métier priority (lower popularity_rank = higher priority, 1 highest).
        const rankDiff = this.metierPriorityRank(a) - this.metierPriorityRank(b);
        if (rankDiff !== 0) return rankDiff;
        // Secondary: criticité (CRITIQUE first, then MOYENNE/HAUTE, then FAIBLE).
        const levelDiff = this.levelRank(a.level) - this.levelRank(b.level);
        if (levelDiff !== 0) return levelDiff;
        // Tertiary: most concerning first within the same level.
        return Number(b.concern_rate ?? 0) - Number(a.concern_rate ?? 0);
      });
  }

  private metierPriorityRank(reco: Recommendation): number {
    const rank = Number(reco.popularity_rank);
    return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
  }

  private levelRank(level: string | null | undefined): number {
    const v = (level ?? '').toUpperCase();
    if (v === 'CRITIQUE') return 0;
    if (v === 'HAUTE') return 1;
    if (v === 'MOYENNE') return 2;
    if (v === 'FAIBLE') return 3;
    return 4;
  }

  levelClass(level: string | null | undefined): string {
    const v = (level ?? '').toUpperCase();
    if (v === 'CRITIQUE') return 'lvl-critique';
    if (v === 'HAUTE') return 'lvl-haute';
    if (v === 'MOYENNE') return 'lvl-moyenne';
    return 'lvl-faible';
  }

  statusClass(status: string | null | undefined): string {
    const v = (status ?? '').toLowerCase();
    if (v === 'approved') return 'sts-approved';
    if (v === 'rejected') return 'sts-rejected';
    if (v === 'edited') return 'sts-edited';
    return 'sts-pending';
  }

  displayStatus(status: string | null | undefined): string {
    const v = (status ?? '').toLowerCase();
    if (v === 'approved') return 'Approuvée';
    if (v === 'rejected') return 'Rejetée';
    if (v === 'edited') return 'Modifiée';
    if (v === 'pending') return 'En attente';
    return status ?? '';
  }

  displayCategory(category: string | null | undefined): string {
    const v = (category ?? '').toUpperCase();
    if (v === 'TARGET_METIER') return 'Métier cible';
    if (v === 'OTHER_METIER') return 'Autre métier';
    return (category ?? '').replace(/_/g, ' ');
  }

  displayJobStatus(status: string | null | undefined): string {
    const v = (status ?? '').toLowerCase();
    if (v === 'running') return 'En traitement';
    if (v === 'succeeded') return 'Terminée';
    if (v === 'failed') return 'Échouée';
    if (v === 'pending') return 'En attente';
    return status ?? '';
  }

  keywordsLabel(keywords: string[] | null | undefined): string {
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) return '';
    return keywords.slice(0, 4).join(', ');
  }

  displayCompetenceName(reco: Recommendation): string {
    const raw = String(reco.gap_title ?? reco.competence_name ?? '').trim();
    if (!raw) return '';

    const typePrefixes = new Set([
      'comportementale',
      'comportemental',
      'technique',
      'physique',
      'organisationnelle',
      'organisationnel',
    ]);

    const normalize = (value: string): string =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    let value = raw;
    let changed = true;

    while (changed) {
      changed = false;

      const bracketMatch = value.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (bracketMatch) {
        const prefix = normalize(bracketMatch[1]);
        if (typePrefixes.has(prefix)) {
          value = bracketMatch[2].trim();
          changed = true;
          continue;
        }
      }

      const separatorMatch = value.match(/^([^:\-]+)\s*[:\-]\s*(.+)$/);
      if (separatorMatch) {
        const prefix = normalize(separatorMatch[1]);
        if (typePrefixes.has(prefix)) {
          value = separatorMatch[2].trim();
          changed = true;
        }
      }
    }

    return value;
  }

  totalStudentsForDisplay(reco: Recommendation): number {
    const totalFromReco = Number(reco.total_students ?? 0);
    if (Number.isFinite(totalFromReco) && totalFromReco > 0) {
      return Math.trunc(totalFromReco);
    }

    const globalTotal = this.recommendations
      .map((item) => Number(item.total_students ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (globalTotal.length > 0) {
      return Math.trunc(Math.max(...globalTotal));
    }

    const cohortFallback = Number(reco.cohort_size ?? 0);
    return Number.isFinite(cohortFallback) && cohortFallback > 0 ? Math.trunc(cohortFallback) : 0;
  }

  trackById(_index: number, item: Recommendation): string {
    return item.id;
  }

  trackByHistoryId(index: number, item: RecommendationReasonHistoryItem): string {
    return `${item.recommendation_id}-${item.decision_at ?? item.updated_at ?? item.confirmed_at ?? index}`;
  }

  displayHistoryStatus(status: string | null | undefined): string {
    const value = String(status ?? '').toLowerCase();
    if (value === 'approved') return 'Approuvée';
    if (value === 'rejected') return 'Rejetée';
    if (value === 'edited') return 'Modifiée';
    return 'Décision';
  }

  historyStatusClass(status: string | null | undefined): string {
    const value = String(status ?? '').toLowerCase();
    if (value === 'approved') return 'sts-approved';
    if (value === 'rejected') return 'sts-rejected';
    if (value === 'edited') return 'sts-edited';
    return 'sts-pending';
  }

  displayDecisionDate(item: RecommendationReasonHistoryItem): string {
    const raw = item.decision_at ?? item.updated_at ?? item.confirmed_at;
    if (!raw) return 'Date inconnue';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Date inconnue';
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private matchesSearch(reco: Recommendation, query: string): boolean {
    const fields = [
      reco.gap_title,
      reco.competence_name,
      reco.metier,
      reco.domaine,
      reco.cert_title,
      reco.cert_provider,
      reco.cert_description,
      reco.llm_recommendation,
      reco.category,
      reco.status,
      ...(Array.isArray(reco.keywords) ? reco.keywords : []),
    ];
    return fields.some((value) => String(value ?? '').toLowerCase().includes(query));
  }

  private formatError(err: any, fallback: string): string {
    const detail = err?.error?.detail ?? err?.error?.message ?? err?.message;
    return typeof detail === 'string' && detail.trim().length ? detail : fallback;
  }

  private decisionReasonRequiredError(): string {
    if (this.decisionAction === 'approve') {
      return "Veuillez saisir la raison de l'approbation.";
    }
    if (this.decisionAction === 'reject') {
      return 'Veuillez saisir la raison du rejet.';
    }
    return 'Veuillez saisir la raison de la modification.';
  }

  private resetDecisionModal(): void {
    this.decisionAction = null;
    this.decisionTargetId = null;
    this.decisionReason = '';
    this.decisionError = '';
    this.decisionSubmitting = false;
  }
}
