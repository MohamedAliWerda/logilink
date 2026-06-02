import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { CvPreview } from '../../../../user/home/component/cv-preview/cv-preview';

type ViewMode = 'cohort' | 'student';
type SkillStatus = 'Aligné' | 'Partiel' | 'Gap fort' | 'Insuffisante';

interface SkillItem {
  label: string;
  acquis: number;
  requis: number;
  status: SkillStatus;
  gap: number;
  count: number;
}

interface PriorityItem {
  label: string;
  domain: string;
  count: number;
  status: SkillStatus;
  statusClass: string;
  gap: number;
}

interface StudentItem {
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

interface StudentDetailItem extends StudentItem {
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

interface JobItem {
  label: string;
  pct: number;
  tone: 'good' | 'warn' | 'alert';
}

interface CategoryDescriptor {
  key: string;
  label: string;
}

interface GapsDashboardPayload {
  cohortLabel: string;
  totalStudents: number;
  kpis: Array<{ label: string; value: string; note: string; tone: string }>;
  tabs: CategoryDescriptor[];
  skillCategories: Record<string, SkillItem[]>;
  students: StudentItem[];
  studentDetails: StudentDetailItem[];
  priorityItems: PriorityItem[];
  jobFit: JobItem[];
}

interface TargetJobStats {
  metierName: string;
  coveragePct: number;
  matched: number;
  total: number;
  strengths: string[];
  watchouts: string[];
  skillFocus: Array<{ label: string; acquis: number; requis: number; status: SkillStatus }>;
}

@Component({
  selector: 'app-gaps-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, CvPreview],
  templateUrl: './gaps_admin.html',
  styleUrl: './gaps_admin.css'
})
export class GapsAdmin implements OnInit {
  viewMode: ViewMode = 'cohort';
  selectedCategory = '';
  selectedStudentIndex = 0;
  filterFiliere = '';
  showAllStudents = false;

  loading = true;
  errorMessage: string | null = null;

  // CV modal
  cvModalOpen = false;
  cvModalLoading = false;
  cvModalCv: any | null = null;
  cvModalStudentName = '';
  cvModalError: string | null = null;

  // Métier visé toggle
  showTargetJobView = false;
  targetJobLoading = false;
  targetJobStats: TargetJobStats | null = null;
  targetJobError: string | null = null;

  private studentDataCache = new Map<string, any>();

  cohortLabel = '';
  totalStudents = 0;
  kpis: Array<{ label: string; value: string; note: string; tone: string }> = [];
  tabs: CategoryDescriptor[] = [];
  skillCategories: Record<string, SkillItem[]> = {};
  currentSkills: SkillItem[] = [];
  students: StudentItem[] = [];
  studentDetails: StudentDetailItem[] = [];
  priorityItems: PriorityItem[] = [];
  jobFit: JobItem[] = [];

  readonly statusClasses: Record<SkillStatus, string> = {
    'Aligné': 'status-aligne',
    'Partiel': 'status-partiel',
    'Gap fort': 'status-gap',
    'Insuffisante': 'status-absente',
  };

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.loading = true;
    this.errorMessage = null;
    this.studentDataCache.clear();
    try {
      const url = `${environment.apiUrl}/admin/gaps`;
      const response = await firstValueFrom(this.http.get<{ data?: GapsDashboardPayload } | GapsDashboardPayload>(url));
      const payload = (response as { data?: GapsDashboardPayload })?.data ?? (response as GapsDashboardPayload);
      this.applyPayload(payload);
    } catch (err) {
      console.error('Failed to load gaps dashboard:', err);
      this.errorMessage = 'Impossible de charger les données pour le moment.';
      this.applyPayload(this.emptyPayload());
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private applyPayload(payload: GapsDashboardPayload): void {
    this.cohortLabel = payload.cohortLabel;
    this.totalStudents = payload.totalStudents;
    this.kpis = payload.kpis ?? [];
    this.tabs = payload.tabs ?? [];
    this.skillCategories = payload.skillCategories ?? {};
    this.students = payload.students ?? [];
    this.studentDetails = payload.studentDetails ?? [];
    this.priorityItems = payload.priorityItems ?? [];
    this.jobFit = payload.jobFit ?? [];

    const firstTab = this.tabs[0];
    this.selectedCategory = firstTab ? firstTab.key : '';
    this.currentSkills = firstTab ? this.skillCategories[firstTab.key] ?? [] : [];

    this.selectedStudentIndex = 0;
  }

  private emptyPayload(): GapsDashboardPayload {
    return {
      cohortLabel: '',
      totalStudents: 0,
      kpis: [],
      tabs: [],
      skillCategories: {},
      students: [],
      studentDetails: [],
      priorityItems: [],
      jobFit: [],
    };
  }

  setCategory(key: string): void {
    this.selectedCategory = key;
    this.currentSkills = this.skillCategories[key] ?? [];
  }

  setViewMode(value: ViewMode): void {
    this.viewMode = value;
  }

  setStudent(index: number): void {
    if (index < 0 || index >= this.studentDetails.length) {
      return;
    }
    if (this.selectedStudentIndex !== index) {
      this.showTargetJobView = false;
      this.targetJobStats = null;
      this.targetJobError = null;
      this.cvModalOpen = false;
      this.cvModalCv = null;
    }
    this.selectedStudentIndex = index;
  }

  async openCvModal(cvSubmissionId: string, authId: string, studentName: string): Promise<void> {
    this.cvModalOpen = true;
    this.cvModalStudentName = studentName;
    this.cvModalCv = null;
    this.cvModalError = null;
    this.cvModalLoading = true;
    this.cdr.detectChanges();
    try {
      const data = await this.fetchStudentData(cvSubmissionId, authId);
      this.cvModalCv = data?.cv ?? null;
      if (!this.cvModalCv) this.cvModalError = 'Aucun CV trouvé pour cet étudiant.';
    } catch {
      this.cvModalError = 'Impossible de charger le CV.';
    } finally {
      this.cvModalLoading = false;
      this.cdr.detectChanges();
    }
  }

  closeCvModal(): void {
    this.cvModalOpen = false;
    this.cvModalCv = null;
  }

  async toggleTargetJobView(cvSubmissionId: string, authId: string): Promise<void> {
    if (this.showTargetJobView) {
      this.showTargetJobView = false;
      return;
    }
    this.targetJobLoading = true;
    this.targetJobError = null;
    this.cdr.detectChanges();
    try {
      const data = await this.fetchStudentData(cvSubmissionId, authId);
      this.targetJobStats = data?.targetJobStats ?? null;
      if (!this.targetJobStats) this.targetJobError = 'Aucune donnée métier visé disponible.';
      else this.showTargetJobView = true;
    } catch {
      this.targetJobError = 'Impossible de charger les données du métier visé.';
    } finally {
      this.targetJobLoading = false;
      this.cdr.detectChanges();
    }
  }

  private async fetchStudentData(cvSubmissionId: string, authId: string): Promise<any> {
    const cacheKey = cvSubmissionId || authId;
    if (this.studentDataCache.has(cacheKey)) return this.studentDataCache.get(cacheKey);
    const url = `${environment.apiUrl}/admin/student-cv/${cvSubmissionId}?authId=${encodeURIComponent(authId)}`;
    const raw = await firstValueFrom(this.http.get<any>(url));
    const data = (raw as any)?.data ?? raw;
    this.studentDataCache.set(cacheKey, data);
    return data;
  }

  get headerSubtitle(): string {
    return this.viewMode === 'cohort'
      ? 'Analyse approfondie des profils étudiants : adéquation entre les compétences techniques et le référentiel de compétences.'
      : 'Suivi détaillé d\'un étudiant';
  }

  get uniqueFilieres(): string[] {
    return [...new Set(this.studentDetails.map(s => s.filiere).filter(f => !!f))].sort();
  }

  get filteredStudentDetails(): StudentDetailItem[] {
    return this.studentDetails.filter(s => !this.filterFiliere || s.filiere === this.filterFiliere);
  }

  get selectedStudent(): StudentDetailItem | null {
    return this.studentDetails[this.selectedStudentIndex] ?? null;
  }

  statusClassFor(status: SkillStatus): string {
    return this.statusClasses[status] ?? '';
  }
}
