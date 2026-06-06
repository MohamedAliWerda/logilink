import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RecommendationService, ScoreV2Item, StudentRecommendation } from './recommendation.service';

type DisplayLevel = 'CRITIQUE' | 'MOYENNE' | 'FAIBLE';

@Component({
  selector: 'app-recommendation',
  imports: [CommonModule],
  templateUrl: './recommendation.html',
  styleUrl: './recommendation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Recommendation implements OnInit {
  private readonly recommendationService = inject(RecommendationService);

  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly approvedRecommendations = signal<StudentRecommendation[]>([]);
  readonly scoreV2Loading = signal(false);
  readonly scoreV2Error = signal('');
  readonly scoreV2Value = signal<ScoreV2Item | null>(null);

  readonly critiqueRecommendations = computed(() => this.byLevel('CRITIQUE'));
  readonly moyenneRecommendations = computed(() => this.byLevel('MOYENNE'));
  readonly faibleRecommendations = computed(() => this.byLevel('FAIBLE'));

  readonly totalRecommendations = computed(
    () =>
      this.critiqueRecommendations().length
      + this.moyenneRecommendations().length
      + this.faibleRecommendations().length,
  );

  ngOnInit(): void {
    void this.refresh();
    void this.refreshScoreV2();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');

    try {
      const rows = await this.recommendationService.listApprovedForStudent();
      const prioritizedRows = rows.filter((row) => this.normalizeLevel(row.level) !== null);

      const levelOrder: Record<string, number> = { CRITIQUE: 0, MOYENNE: 1, FAIBLE: 2 };
      prioritizedRows.sort((a, b) => {
        const lvlA = levelOrder[this.normalizeLevel(a.level) ?? ''] ?? 99;
        const lvlB = levelOrder[this.normalizeLevel(b.level) ?? ''] ?? 99;
        if (lvlA !== lvlB) return lvlA - lvlB;
        const rateA = Number.isFinite(Number(a.concern_rate)) ? Number(a.concern_rate) : 0;
        const rateB = Number.isFinite(Number(b.concern_rate)) ? Number(b.concern_rate) : 0;
        return rateB - rateA;
      });

      this.approvedRecommendations.set(prioritizedRows);
    } catch (error: unknown) {
      const detail = (error as { error?: { detail?: string; message?: string }; message?: string })?.error?.detail
        ?? (error as { error?: { detail?: string; message?: string }; message?: string })?.error?.message
        ?? (error as { message?: string })?.message
        ?? '';
      this.loadError.set(typeof detail === 'string' && detail.trim().length
        ? detail
        : 'Impossible de charger vos recommandations validees.');
      this.approvedRecommendations.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async refreshScoreV2(): Promise<void> {
    this.scoreV2Loading.set(true);
    this.scoreV2Error.set('');

    try {
      const item = await this.recommendationService.getScoreV2();
      this.scoreV2Value.set(item);
    } catch (error: unknown) {
      const detail = (error as { error?: { detail?: string; message?: string }; message?: string })?.error?.detail
        ?? (error as { error?: { detail?: string; message?: string }; message?: string })?.error?.message
        ?? (error as { message?: string })?.message
        ?? '';
      this.scoreV2Error.set(typeof detail === 'string' && detail.trim().length
        ? detail
        : 'Impossible de charger le score employabilite v2.');
      this.scoreV2Value.set(null);
    } finally {
      this.scoreV2Loading.set(false);
    }
  }

  async computeScoreV2(): Promise<void> {
    this.scoreV2Loading.set(true);
    this.scoreV2Error.set('');

    try {
      const item = await this.recommendationService.computeScoreV2();
      this.scoreV2Value.set(item);
    } catch (error: unknown) {
      const detail = (error as { error?: { detail?: string; message?: string }; message?: string })?.error?.detail
        ?? (error as { error?: { detail?: string; message?: string }; message?: string })?.error?.message
        ?? (error as { message?: string })?.message
        ?? '';
      this.scoreV2Error.set(typeof detail === 'string' && detail.trim().length
        ? detail
        : 'Impossible de calculer le score employabilite v2.');
    } finally {
      this.scoreV2Loading.set(false);
    }
  }

  scoreV2PercentLabel(): string {
    const value = this.scoreV2Value();
    if (!value) return '--%';
    return `${Number(value.scoreEmpV2).toFixed(2)}%`;
  }

  recommendationTitle(item: StudentRecommendation): string {
    return item.cert_title?.trim()
      || item.gap_title?.trim()
      || item.competence_name?.trim()
      || 'Recommandation validee';
  }

  levelLabel(level: DisplayLevel): string {
    if (level === 'CRITIQUE') return 'Critique';
    if (level === 'MOYENNE') return 'Moyenne';
    return 'Faible';
  }

  recommendationContext(item: StudentRecommendation): string {
    const metier = item.metier?.trim() ?? '';
    const domaine = item.domaine?.trim() ?? '';
    if (metier && domaine) return `${metier} - ${domaine}`;
    return metier || domaine || 'Parcours etudiant';
  }

  private byLevel(level: DisplayLevel): StudentRecommendation[] {
    return this.approvedRecommendations()
      .filter((item) => this.normalizeLevel(item.level) === level)
      .sort((a, b) => {
        const rateA = Number.isFinite(Number(a.concern_rate)) ? Number(a.concern_rate) : 0;
        const rateB = Number.isFinite(Number(b.concern_rate)) ? Number(b.concern_rate) : 0;
        return rateB - rateA;
      });
  }

  private normalizeLevel(level: string | null | undefined): DisplayLevel | null {
    const normalized = String(level ?? '').trim().toUpperCase();
    if (normalized === 'CRITIQUE') return 'CRITIQUE';
    if (normalized === 'MOYENNE') return 'MOYENNE';
    if (normalized === 'FAIBLE') return 'FAIBLE';
    return null;
  }
}

