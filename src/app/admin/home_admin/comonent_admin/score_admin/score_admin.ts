import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';

type FiliereStat = {
  filiere: string;
  score: number;
};

type NiveauStat = {
  niveau: string;
  score: number;
};

type DistributionBin = {
  range: string;
  students: number;
  percentage?: number;
};

type AdminStats = {
  employability: {
    average: number;
    totalScored: number;
    distribution: number[];
    filiereAverages: {
      licence_logistique: number;
      licence_transport: number;
      master_pro_industriel: number;
      master_recherche_stl: number;
    };
    parcoursAverages: { L: number; M: number; LM: number };
    bestProfilesCount: number;
  };
  ats: { distribution: number[]; total: number };
  counts: { students: number; matieres: number; scoredProfiles: number };
  societeRegions: Array<{ label: string; count: number }>;
};

@Component({
  selector: 'app-score-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './score_admin.html',
  styleUrl: './score_admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoreAdmin implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiUrl;
  private pollTimer: number | null = null;

  scoreGeneral: number = 0;
  scoreGeneralDisplay: string = '...';
  scoreGradient = 'conic-gradient(#f4a23b 0% 0%, #eceff4 0% 100%)';
  scoreLabel = 'Chargement...';
  barWidth = 0;

  stats = [
    { value: '...', label: "Nombre d’étudiants inscrits sur la plateforme" },
    { value: '...', label: "Meilleurs profils (≥ 75%)" },
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadStats();
    this.pollTimer = window.setInterval(() => this.loadStats(), 30_000);
  }

  ngOnDestroy() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async loadStats(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data?: AdminStats } | AdminStats>(`${this.apiBaseUrl}/admin/dashboard/stats`),
      );
      const stats = (response as any)?.data ?? (response as AdminStats);
      if (!stats) return;
      this.applyEmployabilityAverage(stats.employability.average);
      this.applyScoreDistribution(stats.employability.distribution, stats.employability.totalScored);
      this.applyFiliereScore(stats.employability.filiereAverages);
      this.applyParcoursScore(stats.employability.parcoursAverages);
      this.stats[0].value = String(stats.counts.scoredProfiles ?? 0);
      this.stats[1].value = String(stats.employability.bestProfilesCount ?? 0);
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to load admin stats:', err);
    }
  }

  private applyEmployabilityAverage(average: number) {
    this.scoreGeneral = Number(average.toFixed(2));
    this.scoreGeneralDisplay = average.toFixed(2);
    if (this.scoreGeneral >= 75) {
      this.scoreLabel = 'Excellent';
      this.scoreGradient = `conic-gradient(#5dbf7a 0% ${this.scoreGeneral}%, #eceff4 ${this.scoreGeneral}% 100%)`;
    } else if (this.scoreGeneral >= 55) {
      this.scoreLabel = 'Bon';
      this.scoreGradient = `conic-gradient(#f4a23b 0% ${this.scoreGeneral}%, #eceff4 ${this.scoreGeneral}% 100%)`;
    } else if (this.scoreGeneral > 0) {
      this.scoreLabel = 'Moyen';
      this.scoreGradient = `conic-gradient(#e06456 0% ${this.scoreGeneral}%, #eceff4 ${this.scoreGeneral}% 100%)`;
    } else {
      this.scoreLabel = 'N/A';
      this.scoreGradient = 'conic-gradient(#eceff4 0% 100%)';
    }
    this.barWidth = Math.max(0, Math.min(100, (this.scoreGeneral - 50) * 2));
  }

  private applyScoreDistribution(dist: number[], total: number) {
    const safeTotal = total || dist.reduce((a, b) => a + b, 0) || 1;
    const ranges = ['50-60', '60-70', '70-80', '80-90', '90-100'];
    this.distributionBins = ranges.map((range, i) => ({
      range,
      students: dist[i] ?? 0,
      percentage: Number((((dist[i] ?? 0) / safeTotal) * 100).toFixed(1)),
    }));
    this.rebuildDistributionGrid(Math.max(...dist, 0));
  }

  private applyFiliereScore(avgs: AdminStats['employability']['filiereAverages']) {
    this.filiereStats = [
      { filiere: 'Licence Nationale en Génie Logistique: Logistique Industrielle', score: avgs.licence_logistique },
      { filiere: 'Licence Nationale en Sciences de Transport: Planification et Organisation des Transports', score: avgs.licence_transport },
      { filiere: 'Master Professionnel Génie Industriel et Logistique', score: avgs.master_pro_industriel },
      { filiere: 'Mastère de Recherche en Économie Quantitative: Sciences des Transports et Logistique (STL)', score: avgs.master_recherche_stl },
    ];
  }

  private applyParcoursScore(avgs: AdminStats['employability']['parcoursAverages']) {
    this.niveauStats = [
      { niveau: 'L', score: avgs.L },
      { niveau: 'M', score: avgs.M },
      { niveau: 'LM', score: avgs.LM },
    ];
  }

  readonly palette = ['#5baddb', '#8b5cf6', '#e06456', '#5dbf7a', '#f4a23b', '#2f8f83', '#1e2d5a', '#3b82f6'];

  getColor(index: number): string {
    return this.palette[index % this.palette.length];
  }

  filiereStats: FiliereStat[] = [
    { filiere: 'Licence Nationale en Génie Logistique: Logistique Industrielle', score: 0 },
    { filiere: 'Licence Nationale en Sciences de Transport: Planification et Organisation des Transports', score: 0 },
    { filiere: 'Master Professionnel Génie Industriel et Logistique', score: 0 },
    { filiere: 'Mastère de Recherche en Économie Quantitative: Sciences des Transports et Logistique (STL)', score: 0 },
  ];

  niveauStats: NiveauStat[] = [
    { niveau: 'L', score: 0 },
    { niveau: 'M', score: 0 },
    { niveau: 'LM', score: 0 },
  ];

  readonly niveauFullLabels: Record<string, string> = {
    L: 'Licence',
    M: 'Master',
    LM: 'Licence et Master',
  };

  readonly yMax = 100;
  readonly yGridLines = [0, 25, 50, 75, 100];
  readonly yGridLinesReversed = [...this.yGridLines].reverse();
  readonly yGridLinesInner = this.yGridLines.slice(1).reverse();

  distributionBins: DistributionBin[] = [
    { range: '50-60', students: 0, percentage: 0 },
    { range: '60-70', students: 0, percentage: 0 },
    { range: '70-80', students: 0, percentage: 0 },
    { range: '80-90', students: 0, percentage: 0 },
    { range: '90-100', students: 0, percentage: 0 },
  ];

  distributionYMax = 120;
  distributionGrid = [0, 30, 60, 90, 120];
  distributionGridReversed = [...this.distributionGrid].reverse();
  distributionGridInner = this.distributionGrid.slice(1).reverse();

  rebuildDistributionGrid(maxStudents: number) {
    this.distributionYMax = Math.max(10, Math.ceil(maxStudents * 1.2));
    const step = this.distributionYMax / 4;
    this.distributionGrid = [0, step, step * 2, step * 3, this.distributionYMax].map((v) => Math.round(v));
    this.distributionGridReversed = [...this.distributionGrid].reverse();
    this.distributionGridInner = this.distributionGrid.slice(1).reverse();
  }

  scoreClass(score: number): string {
    if (score >= 75) return 'chip chip-good';
    if (score >= 55) return 'chip chip-mid';
    return 'chip chip-low';
  }

  niveauBarPct(score: number): number {
    return (score / this.yMax) * 100;
  }

  gridLinePct(g: number): number {
    return (g / this.yMax) * 100;
  }

  distributionBarPct(value: number): number {
    return (value / this.distributionYMax) * 100;
  }

  distributionGridPct(g: number): number {
    return (g / this.distributionYMax) * 100;
  }

  trackByFiliere(_: number, f: FiliereStat): string { return f.filiere; }
  trackByNiveau(_: number, n: NiveauStat): string { return n.niveau; }
  trackByGrid(_: number, g: number): number { return g; }
  trackByDistribution(_: number, d: DistributionBin): string { return d.range; }
}
