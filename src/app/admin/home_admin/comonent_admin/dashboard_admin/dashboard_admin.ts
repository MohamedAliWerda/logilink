import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-dashboard-admin',
  imports: [CommonModule],
  templateUrl: './dashboard_admin.html',
  styleUrl: './dashboard_admin.css',
})
export class DashboardAdmin implements OnInit, OnDestroy {
  adminName = 'Nour';
  sidebarCollapsed = false;
  activeMenu = 'dashboard';
  showStudentsPopup = false;
  readonly barW = 76;
  activeScoreFilter: 'cvAts' | 'employability' = 'cvAts';

  selectedStudent: null = null;

  stats = [
    { value: '...', label: 'Étudiants inscrits' },
    { value: '...', label: "Taux d'employabilité" },
    { value: '...', label: "Nombre d’étudiants inscrits sur la plateforme" },
    { value: '...', label: 'Nombre de matière' },
  ];

  donutLegend: { color: string; label: string; pct: number }[] = [];

  domainPieLegend: { color: string; label: string; pct: number }[] = [];

  radarAxes = ['Techniques', 'Organisation', 'Comportement', 'Physiques'];
  radarReq = [85, 80, 85, 75];
  radarAcq = [42, 55, 65, 70];
  radarChart: any;

  recentStudents: Array<{
    name: string;
    id: string;
    speciality: string;
    score: number;
    employabilityScore: number;
    employabilityScoreRaw?: string;
    details: {
      matchings: string[];
      gaps: string[];
      recommendations: string[];
    };
  }> = [];

  recentStudentsLoading = false;
  recentStudentsError: string | null = null;
  topGapsLoading = false;
  topGapsError: string | null = null;


  specialityColors: Record<string, { bg: string; color: string }> = {
    'Logistique': { bg: '#fef3e2', color: '#e07800' },
    'Transport': { bg: '#fef3e2', color: '#e07800' },
    'Supply Chain': { bg: '#e8f4fb', color: '#5baddb' },
    'Commerce Int.': { bg: '#e8f7ef', color: '#5dbf7a' },
  };

  getBadgeStyle(speciality: string) {
    return this.specialityColors[speciality] ?? { bg: '#f0f0f0', color: '#666' };
  }

  scoreColor(score: number): string {
    return 'rgb(102, 102, 102)';
  }

  openStudentsPopup() {
    this.router.navigate(['/admin/etud']);
  }

  closeStudentsPopup() {
    this.showStudentsPopup = false;
  }

  donutSegments: { color: string; dashArray: string; dashOffset: number }[] = [];
  domainPieSegments: { color: string; dashArray: string; dashOffset: number }[];
  domainPieLabels: { x: number; y: number; text: string; color: string }[];
  marketColor: string;
  coverageColor: string;
  gapsData: { label: string; marketPct: number; coverPct: number }[];
  gapsChart: { label: string; y: number; labelX: number; barX: number; marketPct: number; coverPct: number; marketW: number; coverW: number }[];
  barData: {
    range: string;
    labelX: number;
    bars: { x: number; y: number; width: number; height: number; color: string }[];
  }[];
  xGridLines: number[];
  yGridLines: { value: number; y: number }[];
  activeSeriesLegend: { label: string; color: string }[];

  private readonly atsRanges = ['0-20', '20-40', '40-60', '60-80', '80-100'];
  private readonly employabilityRanges = ['50-60', '60-70', '70-80', '80-90', '90-100'];
  private cvAtsSeries = [0, 0, 0, 0, 0];
  private employabilitySeries = [0, 0, 0, 0, 0];


  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
  ) {
    this.domainPieSegments = [];
    this.domainPieLabels = [];

    // ── Top Gaps chart data — populated from backend ─────────────
    this.marketColor = '#1e2d5a';
    this.coverageColor = '#d97706';
    this.gapsData = [];
    this.gapsChart = [];

    this.radarChart = this.buildRadarChart();
    this.barData = [];
    this.xGridLines = [];
    this.yGridLines = [];
    this.activeSeriesLegend = [];
    this.rebuildBarChart();
  }

  private pollTimer: number | null = null;

  ngOnInit() {
    void this.loadStats();
    void this.fetchTopGaps();
    void this.fetchRecentStudents();
    this.pollTimer = window.setInterval(() => {
      void this.loadStats();
      void this.fetchTopGaps();
      void this.fetchRecentStudents();
    }, 30_000);
  }

  ngOnDestroy() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async loadStats(): Promise<void> {
    try {
      const url = `${environment.apiUrl}/admin/dashboard/stats`;
      const response = await firstValueFrom(this.http.get<any>(url));
      const stats = response?.data ?? response;
      if (!stats) return;

      this.updateEmployabilityStat(`${(stats.employability?.average ?? 0).toFixed(2)}%`);
      this.updateStudentsStat(String(stats.counts?.students ?? 0));
      this.updateMatiereStat(String(stats.counts?.matieres ?? 0));
      this.updateScoredStat(String(stats.counts?.scoredProfiles ?? 0));

      const dist = Array.isArray(stats.employability?.distribution) ? stats.employability.distribution : [0, 0, 0, 0, 0];
      this.employabilitySeries = [dist[0] ?? 0, dist[1] ?? 0, dist[2] ?? 0, dist[3] ?? 0, dist[4] ?? 0];

      const atsBackend: number[] = Array.isArray(stats.ats?.distribution) ? stats.ats.distribution : [0, 0, 0, 0];
      this.cvAtsSeries = [
        atsBackend[0] ?? 0,
        atsBackend[1] ?? 0,
        atsBackend[2] ?? 0,
        Math.round(((atsBackend[3] ?? 0) * 1) / 2),
        Math.round(((atsBackend[3] ?? 0) * 1) / 2),
      ];
      this.rebuildBarChart();

      this.applyFiliereChart(stats.employability?.filiereAverages);
      this.applySocieteRegions(stats.societeRegions ?? []);
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to load admin dashboard stats:', err);
    }
  }

  private applyFiliereChart(avgs: {
    licence_logistique: number;
    licence_transport: number;
    master_pro_industriel: number;
    master_recherche_stl: number;
  } | undefined): void {
    if (!avgs) return;
    const total = (avgs.licence_logistique ?? 0) + (avgs.licence_transport ?? 0) + (avgs.master_pro_industriel ?? 0) + (avgs.master_recherche_stl ?? 0);
    if (total <= 0) {
      this.donutLegend = [];
      this.donutSegments = [];
      return;
    }
    const entries = [
      { color: '#5baddb', label: 'Logistique', pct: (avgs.licence_logistique ?? 0) / total },
      { color: '#e06456', label: 'Transport', pct: (avgs.licence_transport ?? 0) / total },
      { color: '#5dbf7a', label: 'Master Pro', pct: (avgs.master_pro_industriel ?? 0) / total },
      { color: '#8b5cf6', label: 'Master Rech.', pct: (avgs.master_recherche_stl ?? 0) / total },
    ].filter((e) => e.pct > 0);
    this.donutLegend = entries;
    const c = 2 * Math.PI * 50;
    let covered = 0;
    this.donutSegments = entries.map((s) => {
      const arc = +(s.pct * c).toFixed(2);
      const seg = { color: s.color, dashArray: `${arc} ${+c.toFixed(2)}`, dashOffset: +(-covered).toFixed(2) };
      covered += arc;
      return seg;
    });
  }

  private applySocieteRegions(rows: Array<{ label: string; count: number }>): void {
    const sorted = [...rows].sort((a, b) => b.count - a.count);
    const top = sorted.slice(0, 5);
    const others = sorted.slice(5).reduce((s, r) => s + r.count, 0);
    if (others > 0) top.push({ label: 'Autres', count: others });
    const total = top.reduce((s, r) => s + r.count, 0);
    if (total <= 0) {
      this.domainPieLegend = [];
      this.domainPieSegments = [];
      return;
    }
    const palette = ['#e06456', '#2a9d8f', '#e9c46a', '#4f77ff', '#9b5de5', '#84a59d'];
    const segs = top.map((row, i) => ({ color: palette[i % palette.length], label: row.label, pct: row.count / total }));
    this.domainPieLegend = segs;
    const c = 2 * Math.PI * 50;
    let covered = 0;
    this.domainPieSegments = segs.map((s) => {
      const arc = +(s.pct * c).toFixed(2);
      const seg = { color: s.color, dashArray: `${arc} ${+c.toFixed(2)}`, dashOffset: +(-covered).toFixed(2) };
      covered += arc;
      return seg;
    });
  }

  private extractSocieteRegion(row: any): string {
    const direct = [
      row?.region,
      row?.gouvernorat,
      row?.governorat,
      row?.ville,
      row?.city,
    ]
      .map((value) => String(value ?? '').trim())
      .find((value) => value.length > 0);

    if (direct) {
      return direct;
    }

    const adresse = String(row?.adresse ?? '').trim();
    if (adresse) {
      const parts = adresse
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        return parts[parts.length - 1];
      }
    }

    return 'Non renseignée';
  }

  private isSocieteValidated(row: any): boolean {
    const boolCandidates = [
      row?.is_validated,
      row?.is_valide,
      row?.validated,
    ];

    if (boolCandidates.some((value) => value === true)) {
      return true;
    }

    const statusRaw = [
      row?.situation,
      row?.statut,
      row?.status,
      row?.validation_status,
      row?.etat_validation,
    ]
      .map((value) => String(value ?? '').trim())
      .find((value) => value.length > 0);

    if (!statusRaw) {
      return false;
    }

    const normalized = statusRaw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return normalized === 'validee' || normalized === 'valide' || normalized === 'approved' || normalized === 'active';
  }

  async fetchTopGaps(): Promise<void> {
    this.topGapsLoading = true;
    this.topGapsError = null;
    try {
      const url = `${environment.apiUrl}/admin/dashboard/top-gaps`;
      const response = await firstValueFrom(
        this.http.get<{ data?: Array<{ label: string; marketPct: number; coverPct: number; count: number }> } | Array<{ label: string; marketPct: number; coverPct: number; count: number }>>(url),
      );
      const items = Array.isArray(response)
        ? response
        : (response as { data?: any[] })?.data ?? [];
      this.gapsData = (items ?? []).map((item: any) => ({
        label: String(item?.label ?? '').trim() || '—',
        marketPct: Number(item?.marketPct ?? 0),
        coverPct: Number(item?.coverPct ?? 0),
      }));
      this.rebuildGapsChart();
    } catch (err) {
      console.error('Failed to load top gaps:', err);
      this.topGapsError = 'Impossible de charger les gaps marché.';
      this.gapsData = [];
      this.gapsChart = [];
    } finally {
      this.topGapsLoading = false;
      this.cdr.detectChanges();
    }
  }

  async fetchRecentStudents(): Promise<void> {
    this.recentStudentsLoading = true;
    this.recentStudentsError = null;
    try {
      const url = `${environment.apiUrl}/admin/dashboard/students`;
      const response = await firstValueFrom(
        this.http.get<{ data?: any[] } | any[]>(url),
      );
      const rows = Array.isArray(response)
        ? response
        : (response as { data?: any[] })?.data ?? [];
      const mapped = (rows ?? []).map((row: any) => ({
        name: String(row?.name ?? '').trim() || 'Étudiant',
        id: String(row?.id ?? '').trim(),
        speciality: String(row?.speciality ?? '').trim() || 'Non renseignée',
        score: Number(row?.score ?? 0),
        employabilityScore: Number(row?.employabilityScore ?? 0),
        employabilityScoreRaw: row?.employabilityScoreRaw != null ? String(row.employabilityScoreRaw) : undefined,
        details: {
          matchings: Array.isArray(row?.details?.matchings) ? row.details.matchings : [],
          gaps: Array.isArray(row?.details?.gaps) ? row.details.gaps : [],
          recommendations: Array.isArray(row?.details?.recommendations) ? row.details.recommendations : [],
        },
      }));

      // Sort by employabilityScore descending and keep top 10
      mapped.sort((a, b) => (b.employabilityScore ?? 0) - (a.employabilityScore ?? 0));
      this.recentStudents = mapped.slice(0, 10);
    } catch (err) {
      console.error('Failed to load recent students:', err);
      this.recentStudentsError = 'Impossible de charger la liste des étudiants.';
      this.recentStudents = [];
    } finally {
      this.recentStudentsLoading = false;
      this.cdr.detectChanges();
    }
  }

  private rebuildGapsChart(): void {
    const maxBarW = 420;
    const barX = 200;
    const labelX = 190;
    this.gapsChart = (this.gapsData ?? []).map((d, i) => {
      const y = 30 + i * 36;
      return {
        label: d.label,
        y,
        labelX,
        barX,
        marketPct: d.marketPct,
        coverPct: d.coverPct,
        marketW: +((d.marketPct / 100) * maxBarW).toFixed(2),
        coverW: +((d.coverPct / 100) * maxBarW).toFixed(2),
      };
    });
  }

  private calculateAtsDistribution(data: any[]): number[] {
    const dist = [0, 0, 0, 0, 0];
    if (!data) return dist;
    for (const row of data) {
      const score = row.ats_score || 0;
      if (score >= 0 && score < 20) dist[0]++;
      else if (score >= 20 && score < 40) dist[1]++;
      else if (score >= 40 && score < 60) dist[2]++;
      else if (score >= 60 && score < 80) dist[3]++;
      else if (score >= 80 && score <= 100) dist[4]++;
    }
    return dist;
  }

  private calculateEmployabilityDistribution(data: any[]): number[] {
    const dist = [0, 0, 0, 0, 0];
    if (!data) return dist;
    for (const row of data) {
      const score = row.score_final || 0;
      if (score >= 50 && score < 60) dist[0]++;
      else if (score >= 60 && score < 70) dist[1]++;
      else if (score >= 70 && score < 80) dist[2]++;
      else if (score >= 80 && score < 90) dist[3]++;
      else if (score >= 90 && score <= 100) dist[4]++;
    }
    return dist;
  }

  updateEmployabilityStat(newValue: string) {
    const statIndex = this.stats.findIndex(s => s.label === "Taux d'employabilité");
    if (statIndex !== -1) {
      const updatedStats = [...this.stats];
      updatedStats[statIndex] = { ...updatedStats[statIndex], value: newValue };
      this.stats = updatedStats;
      this.cdr.detectChanges();
    }
  }

  updateStudentsStat(newValue: string) {
    const statIndex = this.stats.findIndex(s => s.label === 'Étudiants inscrits');
    if (statIndex !== -1) {
      const updatedStats = [...this.stats];
      updatedStats[statIndex] = { ...updatedStats[statIndex], value: newValue };
      this.stats = updatedStats;
      this.cdr.detectChanges();
    }
  }

  updateMatiereStat(newValue: string) {
    const statIndex = this.stats.findIndex(s => s.label === 'Nombre de matière');
    if (statIndex !== -1) {
      const updatedStats = [...this.stats];
      updatedStats[statIndex] = { ...updatedStats[statIndex], value: newValue };
      this.stats = updatedStats;
      this.cdr.detectChanges();
    }
  }

  updateScoredStat(newValue: string) {
    const statIndex = this.stats.findIndex(s => s.label === "Nombre d’étudiants inscrits sur la plateforme");
    if (statIndex !== -1) {
      const updatedStats = [...this.stats];
      updatedStats[statIndex] = { ...updatedStats[statIndex], value: newValue };
      this.stats = updatedStats;
      this.cdr.detectChanges();
    }
  }

  private buildRadarChart() {
    const cx = 150, cy = 150, r = 100;
    const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
    const anchors = ['middle', 'start', 'middle', 'end'];

    const axes = this.radarAxes.map((label, i) => {
      let lxd = 0; let lyd = 0;
      if (i === 0) { lyd = 15; }
      else if (i === 1) { lxd = 15; lyd = 2; }
      else if (i === 2) { lyd = 15; }
      else if (i === 3) { lxd = 15; lyd = 2; }

      const lx = cx + (r + lxd) * Math.cos(angles[i]);
      const ly = cy + (r + lyd) * Math.sin(angles[i]);
      return {
        label,
        x1: cx, y1: cy,
        x2: cx + r * Math.cos(angles[i]),
        y2: cy + r * Math.sin(angles[i]),
        lx: lx,
        ly: ly,
        anchor: anchors[i]
      };
    });

    const getPath = (data: number[]) => {
      const points = data.map((val, i) => {
        const d = (val / 100) * r;
        return `${cx + d * Math.cos(angles[i])},${cy + d * Math.sin(angles[i])}`;
      });
      return points.join(' ');
    };

    const gridPolys = [20, 40, 60, 80, 100].map(level => getPath([level, level, level, level]));

    return {
      axes,
      gridPolys,
      reqPath: getPath(this.radarReq),
      acqPath: getPath(this.radarAcq)
    };
  }

  setScoreFilter(filter: 'cvAts' | 'employability') {
    this.activeScoreFilter = filter;
    this.rebuildBarChart();
  }

  averageGap(values: { value: number }[]): number {
    if (values.length === 0) {
      return 0;
    }
    const total = values.reduce((sum, item) => sum + item.value, 0);
    return Math.round(total / values.length);
  }

  private rebuildBarChart() {
    const BAR_MAX = Math.max(
      10,
      ...this.employabilitySeries,
      ...this.cvAtsSeries
    ) * 1.2; // dynamically scale Y-axis based on max item
    const CHART_H = 245;
    const Y_BOTTOM = 265;
    const X_START = 60;
    const SLOT_W = 96;

    const allSeries = {
      cvAts: {
        label: 'Score CV ATS',
        color: '#2f8f83',
        values: this.cvAtsSeries,
      },
      employability: {
        label: 'Score Employabilité',
        color: '#1e2d5a',
        values: this.employabilitySeries,
      },
    } as const;

    const activeSeries =
      this.activeScoreFilter === 'cvAts'
        ? [allSeries.cvAts]
        : [allSeries.employability];

    this.activeSeriesLegend = activeSeries.map((s) => ({
      label: s.label,
      color: s.color,
    }));

    const currentRanges =
      this.activeScoreFilter === 'cvAts'
        ? this.atsRanges
        : this.employabilityRanges;

    this.barData = currentRanges.map((range, i) => {
      const barCount = activeSeries.length;
      const groupWidth = 74;
      const intraGap = barCount > 1 ? 8 : 0;
      const barWidth = (groupWidth - intraGap * (barCount - 1)) / barCount;
      const startX = X_START + i * SLOT_W + (SLOT_W - groupWidth) / 2;

      const bars = activeSeries.map((series, j) => {
        const value = series.values[i];
        const h = Math.max(+(value / BAR_MAX * CHART_H).toFixed(2), 3);
        return {
          x: +(startX + j * (barWidth + intraGap)).toFixed(2),
          y: +(Y_BOTTOM - h).toFixed(2),
          width: +barWidth.toFixed(2),
          height: h,
          color: series.color,
        };
      });

      return {
        range,
        labelX: +(X_START + i * SLOT_W + SLOT_W / 2).toFixed(2),
        bars,
      };
    });

    this.xGridLines = this.barData.map((d) => d.labelX);

    const maxVal = BAR_MAX;
    const step = maxVal / 4;
    const gridVals = [maxVal, step * 3, step * 2, step, 0].map(v => Math.round(v));
    this.yGridLines = gridVals.map((v) => ({
      value: v,
      y: +(Y_BOTTOM - (v / BAR_MAX) * CHART_H).toFixed(2),
    }));
  }

  private getContrastColor(hex: string): string {
    if (!hex) return '#ffffff';
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 150 ? '#1a1a2e' : '#ffffff';
  }

  logout() {
    this.router.navigate(['/']);
  }

  setMenu(menu: string) {
    this.activeMenu = menu;
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}
