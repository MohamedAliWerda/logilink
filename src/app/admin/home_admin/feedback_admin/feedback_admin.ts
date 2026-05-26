import { AfterViewInit, ChangeDetectionStrategy, Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { firstValueFrom } from 'rxjs';
import Chart from 'chart.js/auto';
import { SupabaseService } from '../../../services/supabase.service';
import { environment } from '../../../../environments/environment';

interface OldStudent {
  id: string;
  fullName: string;
  email: string;
  promotion: number;
  status: 'À répondu' | 'Non contacté' | 'Touché';
  company?: string;
  position?: string;
  rating?: number;
  employmentStatus?: 'CDI' | 'CDD / SIVP' | 'Freelance' | 'À l\'étranger (emploi)' | 'Formation supérieure' | 'Recherche active' | 'Inactif';
  salaryRange?: '< 800 TND' | '800-1200 TND' | '1200-1800 TND' | '1800-2500 TND' | '> 2500 TND';
  firstJobDelay?: 'Avant diplomation' | '< 1 mois' | '1 à 3 mois' | '3 à 6 mois' | '6 à 12 mois' | 'Plus de 12 mois' | 'Encore en recherche';
  recommendationNote?: number;
  recruitmentChannel?: 'LinkedIn' | 'Réseau personnel' | 'Portail emploi' | 'Bureau ISGIS' | 'Candidature spont.' | 'Salon emploi';
  adequation?: 'Totalement en lien' | 'Partiellement en lien' | 'Pas du tout en lien';
  competenceFeedback?: string[];
  feedbackDate?: string;
}

interface StatCard {
  value: string;
  label: string;
  icon?: string;
}

type CompanyRecruitmentIntent = 'Oui' | 'Non' | 'Probablement oui' | 'Incertain(e)';
type CompanySituation = 'CDI' | 'CDD' | 'Stage / PFE' | 'Freelance' | 'Sans emploi';

interface EnterpriseFeedback {
  id: string;
  company: string;
  sector: string;
  promotion: number;
  satisfactionGlobal: number; // /10
  recruitmentIntent: CompanyRecruitmentIntent;
  profileFitRate: number; // 0..100
  performanceContribution: number; // /5
  situation: CompanySituation;
  competenceTechnique: number; // /6
  resolutionProblemes: number; // /6
  travailEquipe: number; // /6
  communication: number; // /6
  autonomiePriorites: number; // /6
  apprentissageAgilite: number; // /6
  lacuneExperienceTerrain: number; // 0..100
  lacuneOutilsTms: number; // 0..100
  lacuneGestionCrise: number; // 0..100
  lacuneReglementation: number; // 0..100
  lacuneCommunicationClients: number; // 0..100
  lacuneAnglais: number; // 0..100
}

@Component({
  selector: 'app-feedback-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './feedback_admin.html',
  styleUrl: './feedback_admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-10px)' }),
        animate('300ms ease-in', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('300ms ease-out', style({ opacity: 0, transform: 'translateY(-10px)' }))
      ])
    ])
  ]
})
export class FeedbackAdmin implements AfterViewInit, OnDestroy, OnInit {
  searchTerm: string = '';
  companySearchTerm: string = '';
  sortColumn: string = '';
  sortDirection: 'asc' | 'desc' = 'asc';
  activeTab: 'anciens' | 'retours' | 'societes' | 'retours-societes' = 'anciens';
  selectedPromo: number | null = null;
  selectedCompanyFilter: string = 'all';
  private chartInstances: Record<string, Chart | undefined> = {};
  private dashboardUpdatedAt: Date = new Date();

  showProfileModal: boolean = false;
  selectedStudent: OldStudent | null = null;
  showAddStudentModal: boolean = false;
  newStudentForm = {
    fullName: '',
    email: '',
    promotion: '',
  };

  // Email Modal
  showSendEmailModal: boolean = false;
  emailSubject: string = 'Partagez votre expérience professionnelle - ISGI';
  emailMessage: string = `Chère ancienne diplômée / Cher ancien diplômé,

Nous aimerions connaître votre parcours professionnel et recueillir vos retours sur votre expérience à l'ISGI.

Votre avis nous est précieux pour continuer à améliorer notre programme de formation.

Nous vous invitons à répondre à quelques questions en cliquant sur le lien ci-dessous:

[Lien vers le formulaire]

Cordialement,
L'équipe ISGI`;

  showSuccessNotification: boolean = false;
  successMessage: string = '';
  showErrorNotification: boolean = false;
  errorNotifMessage: string = '';
  private notifTimer: number | undefined;

  showConfirmModal: boolean = false;
  confirmModalMessage: string = '';
  private pendingConfirmCallback: (() => void) | null = null;

  feedbackStudents: OldStudent[] = [];
  enterpriseFeedbacks: EnterpriseFeedback[] = [];
  private refreshIntervalId: number | undefined;

  constructor(
    private supabaseService: SupabaseService,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    void this.refreshAllData();
    this.refreshIntervalId = window.setInterval(() => {
      void this.refreshAllData();
    }, 15000);
  }

  private async refreshAllData(): Promise<void> {
    await this.loadAncienEtudiants(false);
    await this.loadDashboardFeedback(false);
    await this.loadEnterpriseFeedback(false);
    this.cdr.markForCheck();
    this.scheduleDashboardCharts();
    this.scheduleCompanyDashboardCharts();
  }

  private async loadAncienEtudiants(shouldRefreshCharts = true): Promise<void> {
    try {
      const rows = await this.supabaseService.fetchFeedback('ancien_etudiant');
      if (!rows) {
        return;
      }

      const mapped: OldStudent[] = (rows as any[]).map(r => this.mapRowToOldStudent(r));
      this.oldStudents = mapped;
      if (shouldRefreshCharts) {
        this.cdr.markForCheck();
        this.scheduleDashboardCharts();
      }
    } catch (err) {
      console.error('Supabase fetch error', err);
      throw err;
    }
  }

  private async loadDashboardFeedback(shouldRefreshCharts = true): Promise<void> {
    try {
      const rows = await this.supabaseService.fetchFeedback('feedback');
      if (!rows) {
        return;
      }

      const mapped: OldStudent[] = (rows as any[]).map(r => this.mapFeedbackRowToStudent(r));
      this.feedbackStudents = mapped;
      if (shouldRefreshCharts) {
        this.cdr.markForCheck();
        this.scheduleDashboardCharts();
        this.scheduleCompanyDashboardCharts();
      }
    } catch (err) {
      console.error('Supabase feedback fetch error', err);
      throw err;
    }
  }

  private async loadEnterpriseFeedback(shouldRefreshCharts = true): Promise<void> {
    try {
      // Route through the admin backend so the service-role key bypasses
      // RLS on feedback_societe and Societe (the anon client returns []).
      const apiUrl = `${environment.apiUrl}/admin/dashboard/feedback-societe`;
      const response: any = await firstValueFrom(this.http.get<any>(apiUrl));
      const rows: any[] = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response?.data?.data)
            ? response.data.data
            : [];
      this.enterpriseFeedbacks = rows.map(row => this.mapEnterpriseFeedbackRow(row));
    } catch (err) {
      console.error('feedback_societe load failed', err);
      this.enterpriseFeedbacks = [];
    }

    if (shouldRefreshCharts) {
      this.cdr.markForCheck();
      this.scheduleCompanyDashboardCharts();
    }
  }

  private normalizeNumber(raw: unknown, fallback: number, min: number, max: number): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.min(max, Math.max(min, raw));
    }

    if (typeof raw === 'string') {
      const normalized = raw.replace(',', '.').replace('%', '').trim();
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        return Math.min(max, Math.max(min, parsed));
      }
    }

    return Math.min(max, Math.max(min, fallback));
  }

  private normalizeIntent(raw: unknown): CompanyRecruitmentIntent {
    const text = String(raw ?? '').toLowerCase().trim();
    if (text.includes('certainement') || text === 'oui') return 'Oui';
    if (text.includes('probablement')) return 'Probablement oui';
    if (text.includes('incertain')) return 'Incertain(e)';
    if (text === 'non' || text.startsWith('non')) return 'Non';
    return 'Incertain(e)';
  }

  private normalizeSituation(raw: unknown): CompanySituation {
    const text = String(raw ?? '').toLowerCase();
    // Q1 text answers from feedback_societe
    if (text.includes('toujours en poste') || text.includes('mutation interne')) return 'CDI';
    if (text.includes('fin de contrat') || text.includes('sivp')) return 'CDD';
    if (text.includes('stage') || text.includes('pfe')) return 'Stage / PFE';
    if (text.includes('free')) return 'Freelance';
    // Legacy / fallback values
    if (text.includes('cdi')) return 'CDI';
    if (text.includes('cdd')) return 'CDD';
    return 'Sans emploi';
  }

  private parsePromotion(raw: unknown): number {
    const text = String(raw ?? '').trim();
    const m = text.match(/(19\d{2}|20\d{2})/);
    if (m) return Number(m[1]);
    const numeric = Number(text);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  }

  private mapEnterpriseFeedbackRow(row: any): EnterpriseFeedback {
    // Company name from Supabase FK join, or fallback to id_soc label
    const societeJoin = row?.['Societe'] as any;
    const company = String(
      societeJoin?.denomination_sociale
      ?? societeJoin?.nom
      ?? (row?.id_soc ? `Société #${row.id_soc}` : null)
      ?? 'Entreprise non renseignée',
    ).trim() || 'Entreprise non renseignée';

    const sector = String(societeJoin?.secteur_activite ?? 'Non renseigné').trim();

    // Q2: Skill ratings (stored as 1–6)
    const competenceTechnique = this.normalizeNumber(row?.['2. [Compétences techniques métier]'], 4, 1, 6);
    const resolutionProblemes  = this.normalizeNumber(row?.['2. [Résolution de problèmes]'], 4, 1, 6);
    const travailEquipe        = this.normalizeNumber(row?.['2. [Travail en équipe / Collaboration]'], 4, 1, 6);
    const communication        = this.normalizeNumber(row?.['2. [Communication professionnelle]'], 4, 1, 6);
    const autonomiePriorites   = this.normalizeNumber(row?.['2. [Autonomie & Gestion des priorités]'], 4, 1, 6);
    const apprentissageAgilite = this.normalizeNumber(row?.["2.[Capacité d'apprentissage & Agilité]"], 4, 1, 6);

    // Q3: Profile fit → 0-100
    const profileText = String(row?.['3. Le profil académique ISGIS correspond-il aux exigences du p'] ?? '').toLowerCase();
    let profileFitRate = 60;
    if (profileText.includes('très bien')) profileFitRate = 90;
    else if (profileText.includes('bien adapt')) profileFitRate = 75;
    else if (profileText.includes('partiellement')) profileFitRate = 50;
    else if (profileText.includes('peu adapt')) profileFitRate = 20;

    // Q5: Performance contribution → 1-5
    const contribText = String(row?.['5. Comment évaluez-vous la participation des diplomés dans la'] ?? '').toLowerCase();
    let performanceContribution = 3;
    if (contribText.includes('rapide et remarquable')) performanceContribution = 5;
    else if (contribText.includes('régulière') || contribText.includes('reguliere')) performanceContribution = 4;
    else if (contribText.includes('lente mais')) performanceContribution = 3;
    else if (contribText.includes('stagnation')) performanceContribution = 1;

    // Q4: Lacunes (comma-separated text) → binary 100/0 per option; average across rows = % of respondents
    const lacunesStr = String(row?.["4. Quelles lacunes avez-vous observées à l'arrivée du diplô"] ?? '').toLowerCase();
    const hasLacune  = (keyword: string) => lacunesStr.includes(keyword.toLowerCase()) ? 100 : 0;

    return {
      id: String(row?.id ?? row?.id_soc ?? company),
      company,
      sector,
      promotion: new Date().getFullYear(),
      satisfactionGlobal: this.normalizeNumber(
        row?.['7. Sur une échelle de 0 à 10, quelle est votre satisfaction g'], 7, 0, 10,
      ),
      recruitmentIntent: this.normalizeIntent(
        row?.["6. Envisagez-vous de recruter d'autres diplômés ISGIS ?"],
      ),
      profileFitRate,
      performanceContribution,
      situation: this.normalizeSituation(
        row?.['1. Quelle est la situation actuelle du diplômé dans votre ent'],
      ),
      competenceTechnique,
      resolutionProblemes,
      travailEquipe,
      communication,
      autonomiePriorites,
      apprentissageAgilite,
      lacuneExperienceTerrain: hasLacune('processus industriels'),
      lacuneOutilsTms:          hasLacune('outils métier'),
      lacuneGestionCrise:       hasLacune('gestion de projet'),
      lacuneReglementation:     hasLacune('analyse de données'),
      lacuneCommunicationClients: hasLacune('communication écrite'),
      lacuneAnglais:            hasLacune('anglais'),
    };
  }

  private buildEnterpriseFallbackRows(): EnterpriseFeedback[] {
    const responded = this.feedbackStudents.filter(s => s.status === 'À répondu');
    if (!responded.length) {
      return [];
    }

    return responded.map((student, index) => {
      const recommendation = this.normalizeNumber(student.recommendationNote, 7, 0, 10);
      const profileFitRate = student.adequation === 'Totalement en lien'
        ? 82
        : student.adequation === 'Partiellement en lien'
          ? 62
          : 24;

      const baseSkill = student.rating ? this.normalizeNumber(student.rating, 3.8, 0, 5) : 3.8;
      const toSix = (v: number) => this.normalizeNumber((v / 5) * 6, 4, 0, 6);

      return {
        id: `fallback-${student.id}-${index}`,
        company: String(student.company ?? 'Entreprise non renseignée').trim() || 'Entreprise non renseignée',
        sector: 'Logistique & Transport',
        promotion: student.promotion,
        satisfactionGlobal: recommendation,
        recruitmentIntent: recommendation >= 7 ? 'Oui' : recommendation <= 4 ? 'Non' : 'Incertain(e)',
        profileFitRate,
        performanceContribution: this.normalizeNumber(student.rating, 3.6, 0, 5),
        situation: this.normalizeSituation(student.employmentStatus),
        competenceTechnique: toSix(baseSkill + 0.3),
        resolutionProblemes: toSix(baseSkill + 0.1),
        travailEquipe: toSix(baseSkill + 0.5),
        communication: toSix(baseSkill - 0.2),
        autonomiePriorites: toSix(baseSkill - 0.4),
        apprentissageAgilite: toSix(baseSkill + 0.6),
        lacuneExperienceTerrain: 71,
        lacuneOutilsTms: 58,
        lacuneGestionCrise: 50,
        lacuneReglementation: 44,
        lacuneCommunicationClients: 38,
        lacuneAnglais: 31,
      };
    });
  }

  private mapRowToOldStudent(row: any): OldStudent {
    // Prefer actual column names from Supabase `ancien_etudiant` (may contain spaces/accents)
    const id = row.id ?? row.ID ?? row['ID'] ?? `${row.EMAIL ?? row.email ?? 'unknown'}-${row.PROMOTION ?? row.promotion ?? ''}`;
    const namePart = `${row.prenom ?? row.PRENOM ?? ''} ${row.nom ?? row.NOM ?? ''}`.trim();
    const nameCandidate = row.NOM ?? namePart;
    const fullName = row.full_name ?? row.name ?? (nameCandidate || row.EMAIL || row.email || id);
    const email = row.email ?? row.EMAIL ?? row.mail ?? row.MAIL ?? '';

    // Promotion: try parse year from various formats (date or year string)
    let promotionRaw = row.promotion ?? row.PROMOTION ?? row.annee ?? row.promo ?? '';
    let promotion = 0;
    if (promotionRaw) {
      const asDate = new Date(promotionRaw);
      if (!isNaN(asDate.getTime())) {
        promotion = asDate.getFullYear();
      } else {
        const yearMatch = String(promotionRaw).match(/(20\d{2}|19\d{2})/);
        promotion = yearMatch ? Number(yearMatch[0]) : Number(promotionRaw) || 0;
      }
    }

    // Status detection: only 'Non contacté' or 'Touché'.
    const statutInv = (row['STATUT INVITATION'] ?? row['STATUT_INVITATION'] ?? row.statut ?? row.status ?? '').toString().trim().toLowerCase();
    let status: OldStudent['status'] = 'Non contacté';
    if (statutInv.includes('touch') || statutInv.includes('invit')) {
      status = 'Touché';
    }

    const employmentStatus = (row.employment_status ?? row['STATUT EMPLOI'] ?? row['STATUT_EMPLOI'] ?? row.statut_emploi) as OldStudent['employmentStatus'];
    const salaryRange = (row.salary_range ?? row['FOURCHETTE SALARIALE'] ?? row.salaire) as OldStudent['salaryRange'];
    const firstJobDelay = (row.first_job_delay ?? row['DELAI PREMIER EMPLOI'] ?? row.delai_premier_emploi) as OldStudent['firstJobDelay'];
    const recommendationNote = Number(row.recommendation_note ?? row['NOTE RECOMMANDATION'] ?? row.note_recommandation ?? row.note) || undefined;
    const recruitmentChannel = (row.recruitment_channel ?? row['CANAL RECRUTEMENT'] ?? row.canal_recrutement) as OldStudent['recruitmentChannel'];
    const adequation = (row.adequation ?? row['ADEQUATION'] ?? row.adequation_fr) as OldStudent['adequation'];
    const competenceFeedback = row.competence_feedback ? (typeof row.competence_feedback === 'string' ? JSON.parse(row.competence_feedback) : row.competence_feedback) : (row.competences ?? row.COMPETENCES ?? []);
    const feedbackDate = row.feedback_date ?? row['FEEDBACK_DATE'] ?? row.created_at ?? row.date ?? row.PROMOTION;

    return {
      id: String(id),
      fullName: String(fullName),
      email: String(email),
      promotion,
      status,
      company: row.company ?? row.entreprise,
      position: row.position ?? row.job_title,
      rating: row.rating ? Number(row.rating) : undefined,
      employmentStatus,
      salaryRange,
      firstJobDelay,
      recommendationNote,
      recruitmentChannel,
      adequation,
      competenceFeedback,
      feedbackDate,
    };
  }

  private mapFeedbackRowToStudent(row: any): OldStudent {
    const id = row.id ?? row.ID ?? `${row.email ?? row.EMAIL ?? 'unknown'}-${row.promotion ?? row.PROMOTION ?? ''}`;
    const fullName = row.nom_prenom ?? row.NOM ?? row.full_name ?? row.name ?? row.email ?? row.EMAIL ?? id;
    const email = row.email ?? row.EMAIL ?? '';

    let promotion = 0;
    const promotionRaw = row.promotion ?? row.PROMOTION ?? '';
    if (promotionRaw) {
      const yearMatch = String(promotionRaw).match(/(20\d{2}|19\d{2})/);
      promotion = yearMatch ? Number(yearMatch[0]) : Number(promotionRaw) || 0;
    }

    const situation = String(row.situation_actuelle ?? '').toLowerCase();
    let employmentStatus: OldStudent['employmentStatus'] = 'Inactif';
    if (situation.includes('cdi')) {
      employmentStatus = 'CDI';
    } else if (situation.includes('cdd') || situation.includes('sivp')) {
      employmentStatus = 'CDD / SIVP';
    } else if (situation.includes('freelance')) {
      employmentStatus = 'Freelance';
    } else if (situation.includes('étranger') || situation.includes('etranger')) {
      employmentStatus = 'À l\'étranger (emploi)';
    } else if (situation.includes('formation')) {
      employmentStatus = 'Formation supérieure';
    } else if (situation.includes('recherche')) {
      employmentStatus = 'Recherche active';
    }

    const salaryText = String(row.salaire_brut_mensuel ?? '').toLowerCase();
    let salaryRange: OldStudent['salaryRange'] = '< 800 TND';
    if (salaryText.includes('800') && salaryText.includes('1 200')) {
      salaryRange = '800-1200 TND';
    } else if (salaryText.includes('1200') || salaryText.includes('1 200')) {
      salaryRange = '1200-1800 TND';
    } else if (salaryText.includes('1800') || salaryText.includes('2500')) {
      salaryRange = '1800-2500 TND';
    } else if (salaryText.includes('plus') || salaryText.includes('>')) {
      salaryRange = '> 2500 TND';
    }

    const delayText = String(row.delai_premier_emploi ?? '').toLowerCase();
    let firstJobDelay: OldStudent['firstJobDelay'] = 'Encore en recherche';
    if (delayText.includes('avant')) {
      firstJobDelay = 'Avant diplomation';
    } else if (delayText.includes('1 mois') || delayText.includes('< 1')) {
      firstJobDelay = '< 1 mois';
    } else if (delayText.includes('1 à 3') || delayText.includes('1 a 3')) {
      firstJobDelay = '1 à 3 mois';
    } else if (delayText.includes('3 à 6') || delayText.includes('3 a 6')) {
      firstJobDelay = '3 à 6 mois';
    } else if (delayText.includes('6 à 12') || delayText.includes('6 a 12')) {
      firstJobDelay = '6 à 12 mois';
    } else if (delayText.includes('12')) {
      firstJobDelay = 'Plus de 12 mois';
    }

    const recruitmentChannel = (row.canal_efficace ?? row.CANAL_EFFICACE ?? row.canal_recrutement ?? row['CANAL RECRUTEMENT']) as OldStudent['recruitmentChannel'];
    const adequationText = String(row.poste_en_lien_formation ?? '').toLowerCase();
    let adequation: OldStudent['adequation'] = 'Pas du tout en lien';
    if (adequationText.includes('totalement')) {
      adequation = 'Totalement en lien';
    } else if (adequationText.includes('partiellement')) {
      adequation = 'Partiellement en lien';
    }

    const recommendationRaw = row.recommandation_isgis ?? row.RECOMMANDATION_ISGIS ?? row.recommendation_isgis;
    const recommendationNote = Number(recommendationRaw) || undefined;
    const rating = adequation === 'Totalement en lien' ? 5 : adequation === 'Partiellement en lien' ? 3 : 1;

    return {
      id: String(id),
      fullName: String(fullName),
      email: String(email),
      promotion,
      status: 'À répondu',
      company: row.secteur,
      position: row.situation_actuelle,
      rating,
      employmentStatus,
      salaryRange,
      firstJobDelay,
      recommendationNote,
      recruitmentChannel,
      adequation,
      competenceFeedback: [
        row.competences_techniques,
        row.competences_gestion_projet,
        row.competences_numeriques,
        row.competences_communication,
        row.maitrise_langues,
        row.capacite_adaptation,
      ]
        .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
        .map(value => String(value)),
      feedbackDate: row.created_at ?? row.updated_at ?? row.feedback_date,
    };
  }

  oldStudents: OldStudent[] = [];

  private readonly employmentScoreMap: Record<NonNullable<OldStudent['employmentStatus']>, number> = {
    'CDI': 1.0,
    'CDD / SIVP': 0.7,
    'Freelance': 0.8,
    'À l\'étranger (emploi)': 0.9,
    'Formation supérieure': 0.5,
    'Recherche active': 0.0,
    'Inactif': 0.0,
  };

  private readonly employmentMetaMap: Record<NonNullable<OldStudent['employmentStatus']>, { code: string; score: number; isEmployed: boolean }> = {
    'CDI': { code: 'EMPLOYE_STABLE', score: 1.0, isEmployed: true },
    'CDD / SIVP': { code: 'EMPLOYE_PRECAIRE', score: 0.7, isEmployed: true },
    'Freelance': { code: 'INDEPENDANT', score: 0.8, isEmployed: true },
    'À l\'étranger (emploi)': { code: 'EMPLOYE_ETRANGER', score: 0.9, isEmployed: true },
    'Formation supérieure': { code: 'EN_FORMATION', score: 0.5, isEmployed: false },
    'Recherche active': { code: 'CHERCHEUR', score: 0.0, isEmployed: false },
    'Inactif': { code: 'INACTIF', score: 0.0, isEmployed: false },
  };

  private readonly delayScoreMap: Record<NonNullable<OldStudent['firstJobDelay']>, number> = {
    'Avant diplomation': 100,
    '< 1 mois': 95,
    '1 à 3 mois': 80,
    '3 à 6 mois': 60,
    '6 à 12 mois': 35,
    'Plus de 12 mois': 10,
    'Encore en recherche': 0,
  };

  private readonly delayMetaMap: Record<NonNullable<OldStudent['firstJobDelay']>, { delayMonths: number | null; score: number }> = {
    'Avant diplomation': { delayMonths: 0, score: 100 },
    '< 1 mois': { delayMonths: 0.5, score: 95 },
    '1 à 3 mois': { delayMonths: 2, score: 80 },
    '3 à 6 mois': { delayMonths: 4.5, score: 60 },
    '6 à 12 mois': { delayMonths: 9, score: 35 },
    'Plus de 12 mois': { delayMonths: 15, score: 10 },
    'Encore en recherche': { delayMonths: null, score: 0 },
  };

  private readonly adequationScoreMap: Record<NonNullable<OldStudent['adequation']>, number> = {
    'Totalement en lien': 100,
    'Partiellement en lien': 50,
    'Pas du tout en lien': 0,
  };

  private readonly employmentColors: Record<NonNullable<OldStudent['employmentStatus']>, string> = {
    'CDI': '#1D9E75',
    'CDD / SIVP': '#5DCAA5',
    'Freelance': '#7F77DD',
    'À l\'étranger (emploi)': '#2563EB',
    'Formation supérieure': '#F5A623',
    'Recherche active': '#EF4444',
    'Inactif': '#A1A1AA',
  };

  private readonly salaryOrder: NonNullable<OldStudent['salaryRange']>[] = [
    '< 800 TND',
    '800-1200 TND',
    '1200-1800 TND',
    '1800-2500 TND',
    '> 2500 TND',
  ];

  private readonly delayOrder: NonNullable<OldStudent['firstJobDelay']>[] = [
    'Avant diplomation',
    '< 1 mois',
    '1 à 3 mois',
    '3 à 6 mois',
    '6 à 12 mois',
    'Plus de 12 mois',
    'Encore en recherche',
  ];

  private readonly channelOrder: NonNullable<OldStudent['recruitmentChannel']>[] = [
    'LinkedIn',
    'Réseau personnel',
    'Portail emploi',
    'Bureau ISGIS',
    'Candidature spont.',
    'Salon emploi',
  ];

  private distributionRows<T extends string>(
    values: T[],
    order: T[],
    colorResolver: (label: T) => string,
  ): { label: string; count: number; percent: number; color: string }[] {
    const total = values.length;
    const counts = new Map<string, number>();

    values.forEach(value => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    });

    return order
      .map(label => {
        const count = counts.get(label) ?? 0;
        return {
          label,
          count,
          percent: total ? Math.round((count / total) * 100) : 0,
          color: colorResolver(label),
        };
      })
      .filter(item => item.count > 0 || total === 0);
  }

  private getEmploymentMeta(student: OldStudent): { code: string; score: number; isEmployed: boolean } {
    return this.employmentMetaMap[student.employmentStatus ?? 'Inactif'];
  }

  private getDelayMeta(student: OldStudent): { delayMonths: number | null; score: number } {
    return this.delayMetaMap[student.firstJobDelay ?? 'Encore en recherche'];
  }

  private getIpeScore(student: OldStudent): number {
    const adequation = student.adequation;
    if (adequation === 'Totalement en lien') {
      return 1;
    }

    if (adequation === 'Partiellement en lien') {
      return 0.5;
    }

    return 0;
  }

  /**
   * Collect recommendation notes and normalise them to a 0-10 scale.
   *
   * Source: every row in `feedbackStudents` (the `feedback` table) — these
   * are all real form submissions.  Admin-created stubs are already excluded
   * because `confirmAddStudent` stores `recommandation_isgis = '0'`, which
   * maps to `recommendationNote = undefined` and is filtered below.
   *
   * Scale auto-detection: when every note in the sample is ≤ 5 the data is
   * on a 1-5 star scale → multiply by 2 to reach the 0-10 NPS scale so that
   * thresholds (≥ 9 promoter, < 7 detractor) remain meaningful.
   */
  private resolveNpsNotes(): number[] {
    // Apply the current promo filter so the NPS scope matches every other KPI.
    const source = this.selectedPromo !== null
      ? this.feedbackStudents.filter(s => s.promotion === this.selectedPromo)
      : this.feedbackStudents;

    const raw = source
      .map(s => s.recommendationNote)
      .filter((n): n is number => typeof n === 'number' && n > 0);

    if (!raw.length) return [];

    const max = Math.max(...raw);
    // 1-5 scale detected → normalise to 0-10
    if (max <= 5) return raw.map(n => Math.round((n / 5) * 10));
    return raw;
  }

  /** Number of valid responses included in the current NPS calculation. */
  get npsRespondentsCount(): number {
    return this.resolveNpsNotes().length;
  }

  // ── Satisfaction globale (star rating) ──────────────────────────────────

  /** Helper for star-loop iteration in the template. */
  readonly starRange = [1, 2, 3, 4, 5];

  /**
   * Average satisfaction on a 1-5 scale, derived from the adequation field:
   *   Totalement en lien → 5 | Partiellement en lien → 3 | Pas du tout → 1
   * Only includes students who have a non-zero rating (i.e. adequation filled).
   */
  get satisfactionAverage(): number {
    const ratings = this.dashboardStudents
      .map(s => s.rating)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    if (!ratings.length) return 0;
    return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
  }

  /** Formatted average text (e.g. "3.8"). */
  get satisfactionAverageText(): string {
    return this.satisfactionAverage.toFixed(1);
  }

  /** Number of filled stars to display (rounded from average). */
  get satisfactionFilledStars(): number {
    return Math.round(this.satisfactionAverage);
  }

  /** Qualitative label for the satisfaction score. */
  get satisfactionLabel(): string {
    const avg = this.satisfactionAverage;
    if (avg >= 4.5) return 'Excellent';
    if (avg >= 3.5) return 'Bon';
    if (avg >= 2.5) return 'Moyen';
    if (avg > 0)    return 'À améliorer';
    return '—';
  }

  /** CSS tone class for the satisfaction label chip. */
  get satisfactionToneClass(): string {
    const avg = this.satisfactionAverage;
    if (avg >= 4.5) return 'tone-success';
    if (avg >= 3.5) return 'tone-good';
    if (avg >= 2.5) return 'tone-warn';
    return 'tone-danger';
  }

  /** Distribution rows for the 3 adequation levels, ordered 5→3→1. */
  get satisfactionDistribution(): { stars: number; label: string; count: number; percent: number }[] {
    const students = this.dashboardStudents.filter(
      s => typeof s.rating === 'number' && s.rating > 0,
    );
    const total = students.length;

    return [
      { stars: 5, label: 'Totalement en lien' },
      { stars: 3, label: 'Partiellement en lien' },
      { stars: 1, label: 'Pas du tout en lien' },
    ].map(({ stars, label }) => {
      const count = students.filter(s => s.rating === stars).length;
      return { stars, label, count, percent: total ? Math.round((count / total) * 100) : 0 };
    });
  }

  /** Number of students included in the satisfaction score. */
  get satisfactionRespondentsCount(): number {
    return this.dashboardStudents.filter(
      s => typeof s.rating === 'number' && s.rating > 0,
    ).length;
  }

  /** Hex colour for a satisfaction row's bar. */
  satisfactionBarColor(stars: number): string {
    if (stars >= 5) return '#1D9E75';
    if (stars >= 3) return '#F5A623';
    return '#EF4444';
  }

  private getRecommendationCategory(note: number): 'promoteur' | 'neutre' | 'detracteur' {
    if (note >= 9) {
      return 'promoteur';
    }

    if (note >= 7) {
      return 'neutre';
    }

    return 'detracteur';
  }

  ngAfterViewInit(): void {
    this.scheduleDashboardCharts();
    this.scheduleCompanyDashboardCharts();
  }

  ngOnDestroy(): void {
    if (this.refreshIntervalId !== undefined) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = undefined;
    }
    if (this.notifTimer !== undefined) {
      window.clearTimeout(this.notifTimer);
    }
    this.destroyAllCharts();
  }

  private showSuccess(message: string): void {
    this.successMessage = message;
    this.showSuccessNotification = true;
    this.showErrorNotification = false;
    if (this.notifTimer !== undefined) window.clearTimeout(this.notifTimer);
    this.notifTimer = window.setTimeout(() => {
      this.showSuccessNotification = false;
      this.cdr.markForCheck();
    }, 5000);
    this.cdr.markForCheck();
  }

  private showError(message: string): void {
    this.errorNotifMessage = message;
    this.showErrorNotification = true;
    this.showSuccessNotification = false;
    if (this.notifTimer !== undefined) window.clearTimeout(this.notifTimer);
    this.notifTimer = window.setTimeout(() => {
      this.showErrorNotification = false;
      this.cdr.markForCheck();
    }, 6000);
    this.cdr.markForCheck();
  }

  private openConfirm(message: string, callback: () => void): void {
    this.confirmModalMessage = message;
    this.pendingConfirmCallback = callback;
    this.showConfirmModal = true;
    this.cdr.markForCheck();
  }

  onConfirmYes(): void {
    this.showConfirmModal = false;
    const cb = this.pendingConfirmCallback;
    this.pendingConfirmCallback = null;
    if (cb) cb();
    this.cdr.markForCheck();
  }

  onConfirmNo(): void {
    this.showConfirmModal = false;
    this.pendingConfirmCallback = null;
    this.cdr.markForCheck();
  }

  closeErrorNotif(): void {
    this.showErrorNotification = false;
    this.cdr.markForCheck();
  }

  get dashboardLastUpdate(): string {
    return this.dashboardUpdatedAt.toLocaleString('fr-FR');
  }

  private scheduleDashboardCharts(): void {
    if (this.activeTab !== 'retours') {
      return;
    }

    this.dashboardUpdatedAt = new Date();
    setTimeout(() => this.renderDashboardCharts(), 0);
  }

  private scheduleCompanyDashboardCharts(): void {
    if (this.activeTab !== 'retours-societes') {
      return;
    }

    this.dashboardUpdatedAt = new Date();
    setTimeout(() => this.renderCompanyDashboardCharts(), 0);
  }

  private destroyAllCharts(): void {
    Object.keys(this.chartInstances).forEach(key => {
      this.chartInstances[key]?.destroy();
      this.chartInstances[key] = undefined;
    });
  }

  private resetChart(key: string): void {
    this.chartInstances[key]?.destroy();
    this.chartInstances[key] = undefined;
  }

  private renderDashboardCharts(): void {
    if (this.activeTab !== 'retours') {
      return;
    }

    this.renderEmploymentStatusChart();
    this.renderSalaryChart();
    this.renderDelayChart();
    this.renderRecruitmentChannelChart();
    this.renderAdequationChart();
  }

  private renderCompanyDashboardCharts(): void {
    if (this.activeTab !== 'retours-societes') {
      return;
    }

    this.renderCompanySituationChart();
    this.renderCompanySatisfactionChart();
  }

  private renderCompanySituationChart(): void {
    const canvas = document.getElementById('company-situation-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('company-situation');
    this.chartInstances['company-situation'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: this.companySituationRows.map(item => item.label),
        datasets: [
          {
            data: this.companySituationRows.map(item => item.percent),
            backgroundColor: this.companySituationRows.map(item => item.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  private renderCompanySatisfactionChart(): void {
    const canvas = document.getElementById('company-satisfaction-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('company-satisfaction');
    this.chartInstances['company-satisfaction'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: this.companySatisfactionDistribution.map(item => String(item.score)),
        datasets: [
          {
            data: this.companySatisfactionDistribution.map(item => item.count),
            backgroundColor: this.companySatisfactionDistribution.map(item => item.color),
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { font: { size: 10 }, color: '#71717a' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          y: {
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#71717a' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
    });
  }

  private renderEmploymentStatusChart(): void {
    const canvas = document.getElementById('employment-status-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('employment-status');
    this.chartInstances['employment-status'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: this.employmentStatusRows.map(item => item.label),
        datasets: [
          {
            data: this.employmentStatusRows.map(item => item.count),
            backgroundColor: this.employmentStatusRows.map(item => item.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '48%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              font: { size: 10 },
            },
          },
        },
      },
    });
  }

  private renderSalaryChart(): void {
    const canvas = document.getElementById('salary-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('salary');
    this.chartInstances['salary'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: this.salaryRows.map(item => item.label),
        datasets: [
          {
            data: this.salaryRows.map(item => item.count),
            backgroundColor: 'rgba(127, 119, 221, 0.35)',
            borderColor: '#7f77dd',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { font: { size: 10 }, color: '#71717a' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 2, font: { size: 10 }, color: '#71717a' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
    });
  }

  private renderDelayChart(): void {
    const canvas = document.getElementById('delay-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('delay');
    this.chartInstances['delay'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: this.delayRows.map(item => item.label.length > 14 ? `${item.label.slice(0, 14)}...` : item.label),
        datasets: [
          {
            data: this.delayRows.map(item => item.count),
            backgroundColor: this.delayRows.map((_, index) => `hsl(${155 - index * 15}, 55%, 45%)`),
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#71717a' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          y: {
            ticks: { font: { size: 10 }, color: '#71717a' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
    });
  }

  private renderRecruitmentChannelChart(): void {
    const canvas = document.getElementById('recruitment-channel-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('recruitment-channel');
    this.chartInstances['recruitment-channel'] = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: this.recruitmentChannelRows.map(item => item.label),
        datasets: [
          {
            data: this.recruitmentChannelRows.map(item => item.count),
            backgroundColor: ['#1D9E75', '#7F77DD', '#F5A623', '#2563EB', '#EF4444', '#0EA5E9'],
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              font: { size: 10 },
            },
          },
        },
      },
    });
  }

  private renderAdequationChart(): void {
    const canvas = document.getElementById('adequation-chart') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    this.resetChart('adequation');
    this.chartInstances['adequation'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: this.adequationRows.map(item => item.label.replace(' en lien', '')),
        datasets: [
          {
            data: this.adequationRows.map(item => item.count),
            backgroundColor: this.adequationRows.map(item => item.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '52%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              font: { size: 10 },
            },
          },
        },
      },
    });
  }

  get stats(): StatCard[] {
    const responded = this.oldStudents.filter(s => s.status === 'À répondu').length;
    const invited = this.oldStudents.filter(s => s.status === 'Touché').length;

    return [
      { value: this.oldStudents.length.toString(), label: 'Anciens recensés' },
      { value: invited.toString(), label: 'Invitations envoyées' },
      { value: responded.toString(), label: 'Réponses reçues' },
    ];
  }

  get invitedCount(): number {
    return this.oldStudents.filter(s => s.status === 'Touché').length;
  }

  get respondedCount(): number {
    return this.oldStudents.filter(s => s.status === 'À répondu').length;
  }

  get waitingResponseCount(): number {
    return this.oldStudents.filter(s => s.status !== 'À répondu').length;
  }

  get uncontactedCount(): number {
    return this.oldStudents.filter(s => s.status === 'Non contacté').length;
  }

  get feedbackCount(): number {
    return this.feedbackStudents.length;
  }

  get responseRate(): number {
    if (!this.oldStudents.length) {
      return 0;
    }

    return Math.round((this.respondedCount / this.oldStudents.length) * 100);
  }

  get promotions(): number[] {
    return [...new Set(this.oldStudents.map(student => student.promotion))].sort((a, b) => a - b);
  }

  get dashboardStudents(): OldStudent[] {
    const respondedStudents = this.feedbackStudents.filter(student => student.status === 'À répondu');

    if (this.selectedPromo === null) {
      return respondedStudents;
    }

    return respondedStudents.filter(student => student.promotion === this.selectedPromo);
  }

  get insertionRate(): number {
    if (!this.dashboardStudents.length) {
      return 0;
    }

    const inserted = this.dashboardStudents.filter(student => this.getEmploymentMeta(student).isEmployed).length;
    return Math.round((inserted / this.dashboardStudents.length) * 100);
  }

  get averageRatingOn5(): string {
    const scores = this.dashboardStudents
      .map(student => this.getIpeScore(student))
      .filter(score => !Number.isNaN(score));

    if (!scores.length) {
      return '-';
    }

    const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    return avg.toFixed(1);
  }

  get averageRating(): number {
    const avg = Number(this.averageRatingOn5);
    return Number.isNaN(avg) ? 0 : Math.round(avg * 100);
  }

  get averageDelayMonths(): string {
    const months = this.dashboardStudents
      .filter(student => this.getEmploymentMeta(student).isEmployed)
      .map(student => this.getDelayMeta(student).delayMonths)
      .filter((month): month is number => month !== null);

    if (!months.length) {
      return '-';
    }

    const avg = months.reduce((sum, value) => sum + value, 0) / months.length;
    return `${avg.toFixed(1)} mois`;
  }

  get employmentStatusRows(): { label: string; count: number; percent: number; color: string }[] {
    const statuses = this.dashboardStudents
      .map(student => student.employmentStatus)
      .filter((status): status is NonNullable<OldStudent['employmentStatus']> => !!status);

    const order = Object.keys(this.employmentScoreMap) as NonNullable<OldStudent['employmentStatus']>[];
    return this.distributionRows(statuses, order, label => this.employmentColors[label]);
  }

  get salaryRows(): { label: string; count: number; percent: number; color: string }[] {
    const rows = this.dashboardStudents
      .map(student => student.salaryRange)
      .filter((salary): salary is NonNullable<OldStudent['salaryRange']> => !!salary);

    return this.distributionRows(rows, this.salaryOrder, () => '#7F77DD');
  }

  get delayRows(): { label: string; count: number; percent: number; color: string }[] {
    const rows = this.dashboardStudents
      .map(student => student.firstJobDelay)
      .filter((delay): delay is NonNullable<OldStudent['firstJobDelay']> => !!delay);

    return this.distributionRows(rows, this.delayOrder, () => '#1D9E75');
  }

  get recruitmentChannelRows(): { label: string; count: number; percent: number; color: string }[] {
    const rows = this.dashboardStudents
      .map(student => student.recruitmentChannel)
      .filter((channel): channel is NonNullable<OldStudent['recruitmentChannel']> => !!channel);

    return this.distributionRows(rows, this.channelOrder, () => '#2563EB');
  }

  get dominantChannel(): string {
    const sorted = [...this.recruitmentChannelRows].sort((a, b) => b.count - a.count);
    return sorted[0]?.label ?? '—';
  }

  get adequationRows(): { label: string; count: number; percent: number; color: string }[] {
    const rows = this.dashboardStudents
      .map(student => student.adequation)
      .filter((adequation): adequation is NonNullable<OldStudent['adequation']> => !!adequation);

    const order: NonNullable<OldStudent['adequation']>[] = ['Totalement en lien', 'Partiellement en lien', 'Pas du tout en lien'];
    const colors: Record<NonNullable<OldStudent['adequation']>, string> = {
      'Totalement en lien': '#1D9E75',
      'Partiellement en lien': '#F5A623',
      'Pas du tout en lien': '#EF4444',
    };

    return this.distributionRows(rows, order, label => colors[label]);
  }

  get weightedEmployabilityScore(): number {
    if (!this.dashboardStudents.length) {
      return 0;
    }

    const scores = this.dashboardStudents.map(student => {
      const employment = student.employmentStatus ? this.getEmploymentMeta(student).score * 100 : 0;
      const delay = student.firstJobDelay ? this.getDelayMeta(student).score : 0;
      const adequation = student.adequation ? this.adequationScoreMap[student.adequation] : 0;

      return (employment * 0.5) + (delay * 0.25) + (adequation * 0.25);
    });

    const total = scores.reduce((sum, score) => sum + score, 0);
    return Math.round(total / scores.length);
  }



  /** Percentage of promoters, neutrals and detractors from the recommendation notes. */
  get npsBreakdown(): { promoteurs: number; neutres: number; detracteurs: number } {
    const notes = this.resolveNpsNotes();
    if (!notes.length) return { promoteurs: 0, neutres: 0, detracteurs: 0 };

    const total = notes.length;
    const promoteurs  = notes.filter(n => n >= 9).length;
    const neutres     = notes.filter(n => n >= 7 && n < 9).length;
    const detracteurs = notes.filter(n => n < 7).length;

    return {
      promoteurs:  Math.round((promoteurs  / total) * 100),
      neutres:     Math.round((neutres     / total) * 100),
      detracteurs: Math.round((detracteurs / total) * 100),
    };
  }

  get npsScore(): number {
    const notes = this.resolveNpsNotes();
    if (!notes.length) return 0;

    const promoters  = notes.filter(n => this.getRecommendationCategory(n) === 'promoteur').length;
    const detractors = notes.filter(n => this.getRecommendationCategory(n) === 'detracteur').length;
    return Math.round(((promoters - detractors) / notes.length) * 100);
  }

  get npsLabel(): string {
    if (this.npsScore > 50) {
      return 'Excellent';
    }

    if (this.npsScore >= 20) {
      return 'Bon';
    }

    if (this.npsScore >= 0) {
      return 'À améliorer';
    }

    return 'Critique';
  }

  get npsToneClass(): string {
    if (this.npsScore > 50) {
      return 'tone-success';
    }

    if (this.npsScore >= 20) {
      return 'tone-good';
    }

    if (this.npsScore >= 0) {
      return 'tone-warn';
    }

    return 'tone-danger';
  }

  get invitationStatusRows(): { label: string; percent: number; color: string }[] {
    const total = this.oldStudents.length;

    if (!total) {
      return [];
    }

    const map = [
      { label: 'Répondu', count: this.respondedCount, color: '#1D9E75' },
      { label: 'Touché', count: this.invitedCount, color: '#F5A623' },
      {
        label: 'Non contacté',
        count: this.oldStudents.filter(student => student.status === 'Non contacté').length,
        color: '#71717A'
      }
    ];

    return map.map(item => ({
      ...item,
      percent: Math.round((item.count / total) * 100)
    }));
  }

  get topCompanies(): { name: string; count: number }[] {
    const companyCounter = new Map<string, number>();

    this.dashboardStudents.forEach(student => {
      if (!student.company) {
        return;
      }

      const current = companyCounter.get(student.company) ?? 0;
      companyCounter.set(student.company, current + 1);
    });

    return [...companyCounter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  get latestRespondents(): OldStudent[] {
    return [...this.dashboardStudents]
      .sort((a, b) => (b.feedbackDate ?? '').localeCompare(a.feedbackDate ?? ''))
      .slice(0, 5);
  }

  get companyRows(): Array<{
    name: string;
    sector: string;
    promotionLabel: string;
    respondents: number;
    satisfaction: number;
    recruitmentYesRate: number;
    profileFitRate: number;
    performance: number;
  }> {
    const byCompany = new Map<string, EnterpriseFeedback[]>();
    this.enterpriseFeedbacks.forEach(row => {
      const key = row.company || 'Entreprise non renseignée';
      const current = byCompany.get(key) ?? [];
      current.push(row);
      byCompany.set(key, current);
    });

    return [...byCompany.entries()].map(([name, rows]) => {
      const avg = (picker: (r: EnterpriseFeedback) => number) => {
        const values = rows.map(picker);
        return values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);
      };

      const sector = rows.find(r => r.sector)?.sector ?? 'Logistique & Transport';
      const promotions = [...new Set(rows.map(r => r.promotion).filter(p => p > 0))].sort((a, b) => a - b);

      return {
        name,
        sector,
        promotionLabel: promotions.length ? String(promotions[promotions.length - 1]) : '—',
        respondents: rows.length,
        satisfaction: Number(avg(r => r.satisfactionGlobal).toFixed(1)),
        recruitmentYesRate: Math.round((rows.filter(r => r.recruitmentIntent === 'Oui').length / rows.length) * 100),
        profileFitRate: Math.round(avg(r => r.profileFitRate)),
        performance: Number(avg(r => r.performanceContribution).toFixed(1)),
      };
    }).sort((a, b) => b.respondents - a.respondents);
  }

  get filteredCompanyRows() {
    const q = this.companySearchTerm.trim().toLowerCase();
    if (!q) return this.companyRows;
    return this.companyRows.filter(row =>
      row.name.toLowerCase().includes(q)
      || row.sector.toLowerCase().includes(q)
      || row.promotionLabel.toLowerCase().includes(q),
    );
  }

  get companyFilterOptions(): string[] {
    return this.companyRows.map(row => row.name);
  }

  get companyDashboardRows(): EnterpriseFeedback[] {
    if (this.selectedCompanyFilter === 'all') {
      return this.enterpriseFeedbacks;
    }
    return this.enterpriseFeedbacks.filter(row => row.company === this.selectedCompanyFilter);
  }

  get companyDashboardLabel(): string {
    if (this.selectedCompanyFilter === 'all') {
      return 'Toutes les sociétés';
    }
    return this.selectedCompanyFilter;
  }

  private averageCompanyMetric(picker: (row: EnterpriseFeedback) => number, digits = 1): number {
    const rows = this.companyDashboardRows;
    if (!rows.length) return 0;
    const total = rows.map(picker).reduce((sum, value) => sum + value, 0);
    return Number((total / rows.length).toFixed(digits));
  }

  get companyRespondentsCount(): number {
    return this.companyDashboardRows.length;
  }

  get companySatisfactionAverage(): number {
    return this.averageCompanyMetric(row => row.satisfactionGlobal, 1);
  }

  get companyRecruitmentYesRate(): number {
    const rows = this.companyDashboardRows;
    if (!rows.length) return 0;
    const yes = rows.filter(row => row.recruitmentIntent === 'Oui').length;
    return Math.round((yes / rows.length) * 100);
  }

  get companyProfileFitAverage(): number {
    return Math.round(this.averageCompanyMetric(row => row.profileFitRate, 1));
  }

  get companyPerformanceAverage(): number {
    return this.averageCompanyMetric(row => row.performanceContribution, 1);
  }

  get companySkillRows(): Array<{ label: string; value: number; color: string }> {
    return [
      { label: 'Compétences techniques métier', value: this.averageCompanyMetric(r => r.competenceTechnique, 1), color: '#2563eb' },
      { label: 'Résolution de problèmes', value: this.averageCompanyMetric(r => r.resolutionProblemes, 1), color: '#1d9e75' },
      { label: 'Travail en équipe / Collaboration', value: this.averageCompanyMetric(r => r.travailEquipe, 1), color: '#0ea5e9' },
      { label: 'Communication professionnelle', value: this.averageCompanyMetric(r => r.communication, 1), color: '#b45309' },
      { label: 'Autonomie & Gestion des priorités', value: this.averageCompanyMetric(r => r.autonomiePriorites, 1), color: '#c2410c' },
      { label: 'Capacité d\'apprentissage & Agilité', value: this.averageCompanyMetric(r => r.apprentissageAgilite, 1), color: '#4338ca' },
    ];
  }

  get companySituationRows(): Array<{ label: CompanySituation; percent: number; color: string }> {
    const rows = this.companyDashboardRows;
    const total = rows.length;
    const palette: Record<CompanySituation, string> = {
      'CDI': '#2166ac',
      'CDD': '#1d9e75',
      'Stage / PFE': '#4338ca',
      'Freelance': '#b45309',
      'Sans emploi': '#71717a',
    };

    const labels: CompanySituation[] = ['CDI', 'CDD', 'Stage / PFE', 'Freelance', 'Sans emploi'];
    return labels.map(label => {
      const count = rows.filter(row => row.situation === label).length;
      const percent = total ? Math.round((count / total) * 100) : 0;
      return { label, percent, color: palette[label] };
    });
  }

  get companyGapRows(): Array<{ label: string; percent: number; color: string }> {
    return [
      { label: 'Processus industriels', percent: Math.round(this.averageCompanyMetric(r => r.lacuneExperienceTerrain, 1)), color: '#9a3412' },
      { label: 'Outils métier', percent: Math.round(this.averageCompanyMetric(r => r.lacuneOutilsTms, 1)), color: '#b45309' },
      { label: 'Gestion de projet', percent: Math.round(this.averageCompanyMetric(r => r.lacuneGestionCrise, 1)), color: '#2563eb' },
      { label: 'Analyse de données', percent: Math.round(this.averageCompanyMetric(r => r.lacuneReglementation, 1)), color: '#4338ca' },
      { label: 'Communication pro.', percent: Math.round(this.averageCompanyMetric(r => r.lacuneCommunicationClients, 1)), color: '#047857' },
      { label: 'Anglais professionnel', percent: Math.round(this.averageCompanyMetric(r => r.lacuneAnglais, 1)), color: '#71717a' },
    ];
  }

  get companyProfileBreakdown(): { toutAFait: number; partiellement: number; peuAdapte: number; nonAdapte: number } {
    const rows = this.companyDashboardRows;
    if (!rows.length) {
      return { toutAFait: 0, partiellement: 0, peuAdapte: 0, nonAdapte: 0 };
    }

    const toutAFait = rows.filter(r => r.profileFitRate >= 75).length;
    const partiellement = rows.filter(r => r.profileFitRate >= 50 && r.profileFitRate < 75).length;
    const peuAdapte = rows.filter(r => r.profileFitRate >= 25 && r.profileFitRate < 50).length;
    const nonAdapte = rows.filter(r => r.profileFitRate < 25).length;
    const toPercent = (n: number) => Math.round((n / rows.length) * 100);

    return {
      toutAFait: toPercent(toutAFait),
      partiellement: toPercent(partiellement),
      peuAdapte: toPercent(peuAdapte),
      nonAdapte: toPercent(nonAdapte),
    };
  }

  get companyRecruitmentBreakdown(): { oui: number; non: number; probablement: number; incertain: number } {
    const rows = this.companyDashboardRows;
    if (!rows.length) {
      return { oui: 0, non: 0, probablement: 0, incertain: 0 };
    }
    const toPercent = (n: number) => Math.round((n / rows.length) * 100);
    return {
      oui:         toPercent(rows.filter(r => r.recruitmentIntent === 'Oui').length),
      non:         toPercent(rows.filter(r => r.recruitmentIntent === 'Non').length),
      probablement: toPercent(rows.filter(r => r.recruitmentIntent === 'Probablement oui').length),
      incertain:   toPercent(rows.filter(r => r.recruitmentIntent === 'Incertain(e)').length),
    };
  }

  get companySatisfactionDistribution(): Array<{ score: number; count: number; color: string }> {
    const rows = this.companyDashboardRows;
    const bins = Array.from({ length: 11 }, (_, score) => ({ score, count: 0 }));
    rows.forEach(row => {
      const score = Math.max(0, Math.min(10, Math.round(row.satisfactionGlobal)));
      bins[score].count += 1;
    });

    const colorsByScore: Record<number, string> = {
      0: '#94a3b8',
      1: '#94a3b8',
      2: '#94a3b8',
      3: '#f59e0b',
      4: '#f59e0b',
      5: '#f59e0b',
      6: '#93c5fd',
      7: '#3b82f6',
      8: '#2166ac',
      9: '#1d9e75',
      10: '#0f766e',
    };

    return bins.map(bin => ({
      ...bin,
      color: colorsByScore[bin.score] ?? '#94a3b8',
    }));
  }

  get uniqueSectorsCount(): number {
    return new Set(this.enterpriseFeedbacks.map(r => r.sector).filter(s => s && s !== 'Non renseigné')).size;
  }

  get companyInsight(): string {
    const strongest = [...this.companySkillRows].sort((a, b) => b.value - a.value)[0];
    const weakest = [...this.companyGapRows].sort((a, b) => b.percent - a.percent)[0];
    if (!strongest || !weakest) {
      return 'Données insuffisantes pour générer un insight société.';
    }
    return `Point fort : ${strongest.label.toLowerCase()} (${strongest.value.toFixed(1)}/6). Axe d'amélioration prioritaire : ${weakest.label.toLowerCase()} (${weakest.percent}%).`;
  }

  get filteredStudents(): OldStudent[] {
    let filtered = this.oldStudents.filter(s => {
      const matchTab = this.activeTab === 'anciens' || (this.activeTab === 'retours' && s.status === 'À répondu');
      const matchSearch = !this.searchTerm.trim() ||
        s.fullName.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        s.email.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        s.id.toLowerCase().includes(this.searchTerm.toLowerCase());

      return matchTab && matchSearch;
    });

    if (this.sortColumn) {
      filtered.sort((a, b) => {
        const valA = (a as any)[this.sortColumn];
        const valB = (b as any)[this.sortColumn];

        let comparison = 0;
        if (typeof valA === 'string') {
          comparison = valA.localeCompare(valB);
        } else if (typeof valA === 'number') {
          comparison = valA - valB;
        }

        return this.sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }

  setSort(column: string) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }

  setActiveTab(tab: 'anciens' | 'retours' | 'societes' | 'retours-societes') {
    this.activeTab = tab;
    this.sortColumn = '';
    this.searchTerm = '';
    this.scheduleDashboardCharts();
    this.scheduleCompanyDashboardCharts();
  }

  setCompanyFilter(value: string): void {
    this.selectedCompanyFilter = value;
    this.scheduleCompanyDashboardCharts();
  }

  setPromoFilter(promo: number | null): void {
    this.selectedPromo = promo;
    this.scheduleDashboardCharts();
  }

  statusBadgeClass(status: OldStudent['status']): string {
    if (status === 'À répondu') {
      return 'badge-green';
    }

    if (status === 'Touché') {
      return 'badge-blue';
    }

    return 'badge-gray';
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'À répondu':
        return 'status-responded';
      case 'Non contacté':
        return 'status-not-contacted';
      case 'Touché':
        return 'status-invited';
      default:
        return '';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'À répondu':
        return '✓';
      case 'Touché':
        return '✉';
      default:
        return '○';
    }
  }

  renderStars(rating: number): string {
    return '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
  }

  viewProfile(studentId: string): void {
    const student = this.oldStudents.find(s => s.id === studentId);
    if (student) {
      this.selectedStudent = student;
      this.showProfileModal = true;
    }
  }

  closeProfileModal(): void {
    this.showProfileModal = false;
    this.selectedStudent = null;
  }

  sendInvitation(studentId: string): void {
    const student = this.oldStudents.find(s => s.id === studentId);
    if (!student || student.status !== 'Non contacté') return;

    this.supabaseService.sendSingleAncienEtudiantInvitation(studentId, {
      subject: this.emailSubject,
      message: this.emailMessage,
    })
      .then(() => {
        student.status = 'Touché';
        this.showSuccess(`Invitation envoyée à ${student.fullName}`);
        this.scheduleDashboardCharts();
      })
      .catch((err: unknown) => {
        const e = err as any;
        const msg = e?.error?.message ?? e?.message ?? 'Erreur inconnue';
        this.showError(`Échec d'envoi pour ${student.fullName} : ${msg}`);
      });
  }

  deleteStudent(studentId: string): void {
    const student = this.oldStudents.find(s => s.id === studentId);
    const name = student?.fullName ?? 'cet ancien diplômé';
    this.openConfirm(`Êtes-vous sûr de vouloir supprimer ${name} ?`, () => {
      this.supabaseService.deleteAncienEtudiant(studentId, student?.email)
        .then(() => {
          this.oldStudents = this.oldStudents.filter(s => s.id !== studentId);
          this.showSuccess(`${name} a été supprimé.`);
          this.scheduleDashboardCharts();
        })
        .catch((err: unknown) => {
          const e = err as any;
          const msg = e?.error?.message ?? e?.message ?? 'Erreur inconnue';
          this.showError(`Impossible de supprimer ${name} : ${msg}`);
        });
    });
  }

  trackById(index: number, item: OldStudent): string {
    return item.id;
  }

  openSendEmailModal(): void {
    this.showSendEmailModal = true;
  }

  openAddStudentModal(): void {
    this.newStudentForm = {
      fullName: '',
      email: '',
      promotion: '',
    };
    this.showAddStudentModal = true;
  }

  closeAddStudentModal(): void {
    this.showAddStudentModal = false;
  }

  async confirmAddStudent(): Promise<void> {
    const fullName = this.newStudentForm.fullName.trim();
    const email = this.newStudentForm.email.trim();
    const promotion = this.newStudentForm.promotion.trim();

    if (!fullName || !email || !promotion) {
      this.showError('Veuillez renseigner le nom, l\'email et la promotion.');
      return;
    }

    try {
      const createdRow = await this.supabaseService.createAncienEtudiant({
        NOM: fullName,
        EMAIL: email,
        PROMOTION: promotion,
        'STATUT INVITATION': 'Non contacté',
        'RÉPONSE': 'Non répondu',
        ACTIONS: 'Relancer',
      });

      await this.supabaseService.createFeedback({
        nom_prenom: fullName,
        email,
        promotion,
        diplome: 'Licence',
        filiere: '',
        situation_actuelle: 'En recherche d\'emploi',
        secteur: '',
        poste_en_lien_formation: 'Pas du tout en lien',
        delai_premier_emploi: 'Encore en recherche',
        salaire_brut_mensuel: 'Ne souhaite pas',
        canal_efficace: 'LinkedIn',
        competences_techniques: '0',
        competences_gestion_projet: '0',
        competences_numeriques: '0',
        competences_communication: '0',
        maitrise_langues: '0',
        capacite_adaptation: '0',
        recommandation_isgis: '0',
        message_suggestion: '',
      });

      const mappedStudent = this.mapRowToOldStudent(createdRow);
      await this.refreshAllData();
      this.showAddStudentModal = false;
      this.showSuccess(`${mappedStudent.fullName} a été ajouté au tableau.`);
    } catch (err) {
      console.error('Failed to add ancien étudiant', err);
      this.showError('Impossible d\'ajouter cet ancien diplômé. Vérifiez que la séquence Supabase est synchronisée.');
    }
  }

  closeSendEmailModal(): void {
    this.showSendEmailModal = false;
  }

  getUncontactedStudents(): OldStudent[] {
    return this.oldStudents.filter(s => s.status === 'Non contacté');
  }

  isSendingEmails: boolean = false;

  async confirmSendEmail(): Promise<void> {
    const uncontactedCount = this.getUncontactedStudents().length;

    if (uncontactedCount === 0) {
      this.showError('Aucun ancien diplômé à contacter.');
      return;
    }

    this.openConfirm(
      `Envoyer ${uncontactedCount} email(s) ?\n\nObjet : ${this.emailSubject}`,
      async () => {
        this.isSendingEmails = true;
        this.cdr.markForCheck();

        try {
          const result = await this.supabaseService.sendAncienEtudiantInvitations({
            subject: this.emailSubject,
            message: this.emailMessage,
          });

          const sent = result?.sent ?? 0;
          const failed = result?.failed ?? 0;
          const attempted = result?.attempted ?? uncontactedCount;

          if (sent > 0) {
            this.showSuccess(failed > 0
              ? `${sent}/${attempted} email(s) envoyé(s). ${failed} échec(s).`
              : `${sent} email(s) envoyé(s) avec succès !`);
          } else {
            const firstError = result?.errors?.[0]?.reason;
            this.showError(`Aucun email envoyé.${firstError ? ' ' + firstError : ''}`);
          }

          this.showSendEmailModal = false;
          await this.refreshAllData();
        } catch (err) {
          console.error('Failed to send invitations', err);
          const message = err instanceof Error ? err.message : 'Erreur inconnue';
          this.showError(`Échec de l'envoi : ${message}`);
        } finally {
          this.isSendingEmails = false;
          this.cdr.markForCheck();
        }
      },
    );
  }
}
