import { ChangeDetectionStrategy, Component, OnInit, signal, ChangeDetectorRef } from '@angular/core';
import { CvSubmissionService } from './cv-submission.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  buildCvAtsPrefill,
  STUDENT_PROFILE_DATA,
} from '../../student-profile.data';

type Level = 'Débutant' | 'Notions' | 'Intermediaire' | 'Avancé' | 'Expert';

interface AtsResult {
  matchScore: number;
  overallScore: number;
  successScore: number;
  missingKeywords: string;
  profileSummary: string;
  suggestions: string;
}

@Component({
  selector: 'app-cv-ats',
  imports: [CommonModule, FormsModule],
  templateUrl: './cv-ats.html',
  styleUrl: './cv-ats.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CvAts {
  private asString(v: any): string {
    if (v === undefined || v === null) return '';
    return String(v);
  }

  private formatToMonth(value: any): string {
    const raw = this.asString(value).trim();
    if (!raw) return '';

    // Already YYYY-MM
    const ym = raw.match(/^(\d{4})-(\d{2})$/);
    if (ym) return `${ym[1]}-${ym[2]}`;

    // If YYYY-MM-DD or ISO date, extract year-month
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) return `${ymd[1]}-${ymd[2]}`;

    // Try Date parse for other formats
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }

    return '';
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
    }

    return String(value).trim().toLowerCase();
  }

  private readonly lockedInfoFields = new Set([
    'prenom',
    'nom',
    'email',
    'telephone',
    'ville',
    'codePostal',
    'niveau',
    'sexe',
    'nationalite',
  ]);

  showPreview = false;
  step = 1;
  formError = '';
  navigationLock = false;
  formRestored = signal(false);
  restoredFromDate = signal<string | null>(null);
  readonly sharedProfileInfo = buildCvAtsPrefill(STUDENT_PROFILE_DATA);
  private studentFiliere = '';

  constructor(
    private cvSubmissionService: CvSubmissionService,
    private router: Router,
    private cd: ChangeDetectorRef,
  ) {
    this.applyLoggedInUser();
  }

  savedCvKey = 'mySavedCvHtml';
  savedCvTimestampKey = 'mySavedCvTimestamp';
  savedCvExists = false;

  private checkSavedCv(): void {
    try {
      const html = localStorage.getItem(this.savedCvKey);
      this.savedCvExists = !!html;
    } catch {
      this.savedCvExists = false;
    }
  }

  private async autoRestoreFormState(): Promise<void> {
    try {
      // Attempt to fetch existing CV from Supabase (no métier ID specified = get default)
      const existingCv = await this.cvSubmissionService.fetchMyCv();
      if (!existingCv) {
        // If the server endpoint didn't return a full CV object, try reading per-table rows directly from Supabase
        const tables = await this.cvSubmissionService.fetchCvTablesForCurrentUser();
        const hasTableData = (tables.formations?.length || tables.experiences?.length || tables.certifications?.length || tables.engagements?.length || tables.langues?.length) > 0;
        if (!hasTableData) {
          this.formRestored.set(false);
          return;
        }

        // Build a synthetic CV object from table rows and restore
        const syntheticCv: any = {
          formations: tables.formations,
          experiences: tables.experiences,
          certifications: tables.certifications,
          engagements: tables.engagements,
          langues: tables.langues,
        };
        await this.restoreFormFieldsFromCv(syntheticCv);
        this.formRestored.set(true);
        this.restoredFromDate.set(null);
        console.log('[CvAts] Form auto-restored from Supabase table rows', tables);
        return;
      }

      // Restore all form fields from the saved CV data
      await this.restoreFormFieldsFromCv(existingCv);
      this.formRestored.set(true);
      this.restoredFromDate.set(this.asString(existingCv.updatedAt ?? existingCv.createdAt));
      console.log('[CvAts] Form auto-restored from Supabase', existingCv);
    } catch (err) {
      console.debug('[CvAts] No previous CV found for auto-restore', err);
      this.formRestored.set(false);
    }
  }

  private async restoreFormFieldsFromCv(cv: any): Promise<void> {
    if (!cv || typeof cv !== 'object') return;

    // Restore info fields
    if (cv.info && typeof cv.info === 'object') {
      this.info.linkedin = this.asString(cv.info.linkedin ?? this.info.linkedin);
      this.info.dateNaissance = this.asString(cv.info.dateNaissance ?? this.info.dateNaissance);
      this.info.permis = this.asString(cv.info.permis ?? this.info.permis);
      this.info.photoName = this.asString(cv.info.photoName ?? this.info.photoName);
    }

    // Restore professional details
    this.professionalTitle = this.asString(cv.professionalTitle ?? this.professionalTitle);
    this.specialization = this.asString(cv.specialization ?? this.specialization);
    this.objectif = this.asString(cv.objectif ?? this.objectif);

    // Restore selected métier if available
    if (cv.metierId) {
      const normalizedMetierId = this.normalizeMetierId(cv.metierId);
      const found = this.metiers.find((m) => m._id === normalizedMetierId);
      if (found) {
        this.selectedMetierId = normalizedMetierId;
      }
    }

    // Restore formations
    if (Array.isArray(cv.formations) && cv.formations.length > 0) {
      this.formations = cv.formations.map((f: any) => ({
        diplome: this.asString(f.diplome ?? this.formations[0]?.diplome),
        institution: this.asString(f.institution ?? ''),
        dateDebut: this.formatToMonth(f.dateDebut ?? f.date_debut ?? ''),
        dateFin: this.formatToMonth(f.dateFin ?? f.date_fin ?? ''),
        moyenne: this.asString(f.moyenne ?? ''),
        modules: this.asString(f.modules ?? ''),
        pfeTitre: this.asString(f.pfeTitre ?? f.pfe_titre ?? ''),
        pfeEntreprise: this.asString(f.pfeEntreprise ?? f.pfe_entreprise ?? ''),
        pfeTechnologies: this.asString(f.pfeTechnologies ?? f.pfe_technologies ?? ''),
      }));
    }

    // Restore experiences
    if (Array.isArray(cv.experiences) && cv.experiences.length > 0) {
      this.experiences = cv.experiences.map((e: any) => ({
        poste: this.asString(e.poste ?? ''),
        entreprise: this.asString(e.entreprise ?? ''),
        secteur: this.asString(e.secteur ?? ''),
        dateDebut: this.formatToMonth(e.dateDebut ?? e.date_debut ?? ''),
        dateFin: this.formatToMonth(e.dateFin ?? e.date_fin ?? ''),
        lieu: this.asString(e.lieu ?? ''),
        description: this.asString(e.description ?? ''),
        motsCles: this.asString(e.motsCles ?? e.mots_cles ?? ''),
      }));
    }

    // Restore hard skills
    if (Array.isArray(cv.hardSkills) && cv.hardSkills.length > 0) {
      this.hardSkills = cv.hardSkills.map((s: any) => ({
        type: this.asString(s.skill_type ?? s.type ?? 'Metier T&L'),
        nom: this.asString(s.nom ?? ''),
        niveau: (s.niveau ?? 'Intermediaire') as Level,
        _system: s._system ?? false,
      }));
      this.skillsExtracted = true;
    }

    // Restore soft skills
    if (Array.isArray(cv.softSkills) && cv.softSkills.length > 0) {
      this.softSkills = cv.softSkills.map((s: any) => ({
        nom: this.asString(s.nom ?? ''),
        niveau: (s.niveau ?? 'Intermediaire') as Level,
        contexte: this.asString(s.contexte ?? ''),
      }));
    }

    // Restore languages
    if (Array.isArray(cv.langues) && cv.langues.length > 0) {
      this.langues = cv.langues.map((l: any) => ({
        langue: this.asString(l.langue ?? ''),
        niveau: this.asString(l.niveau ?? l.niveau_cecrl ?? 'B1'),
        certification: this.asString(l.certification ?? ''),
        score: this.asString(l.score ?? ''),
      }));
    }

    // Restore projects
    if (Array.isArray(cv.projets) && cv.projets.length > 0) {
      this.projets = cv.projets.map((p: any) => ({
        titre: this.asString(p.titre ?? ''),
        description: this.asString(p.description ?? ''),
        technologies: this.asString(p.technologies ?? ''),
        lien: this.asString(p.lien ?? ''),
      }));
    }

    // Restore certifications
    if (Array.isArray(cv.certifications) && cv.certifications.length > 0) {
      this.certifications = cv.certifications.map((c: any) => ({
        titre: this.asString(c.titre ?? ''),
        organisme: this.asString(c.organisme ?? ''),
        date: this.formatToMonth(c.date ?? c.date_obtenue ?? ''),
        verification: this.asString(c.verification ?? ''),
      }));
    }

    // Restore engagements
    if (Array.isArray(cv.engagements) && cv.engagements.length > 0) {
      this.engagements = cv.engagements.map((e: any) => ({
        type: this.asString(e.type ?? 'Associatif'),
        role: this.asString(e.role ?? ''),
        dateDebut: this.formatToMonth(e.dateDebut ?? e.date_debut ?? ''),
        dateFin: this.formatToMonth(e.dateFin ?? e.date_fin ?? ''),
      }));
    }

    // Restore interests
    if (Array.isArray(cv.interests) && cv.interests.length > 0) {
      this.interests = cv.interests.map((i: any) => ({
        label: this.asString(i.label ?? ''),
      }));
    }

    // Restore other metadata
    this.consentGiven = Boolean(cv.consentGiven);
    this.atsScore = Number(cv.atsScore ?? 0);
    this.cohortRank = Number(cv.cohortRank ?? 0);
  }

  private readStoredUserProfile(): Record<string, any> | null {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, any> | null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  clearRestoredForm(): void {
    // Reset form to default state and clear restoration flag
    this.formRestored.set(false);
    this.restoredFromDate.set(null);

    // Reset all form fields to defaults
    this.professionalTitle = '';
    this.specialization = '';
    this.objectif = '';
    this.selectedMetierId = '';

    this.formations = [
      {
        diplome: this.studentFiliere || this.sharedProfileInfo.filiere,
        institution: 'Institut Supérieur De Gestion Industrielle De Sfax',
        dateDebut: '',
        dateFin: '',
        moyenne: '',
        modules: '',
        pfeTitre: '',
        pfeEntreprise: '',
        pfeTechnologies: '',
      },
    ];

    this.experiences = [
      {
        poste: '',
        entreprise: '',
        secteur: '',
        dateDebut: '',
        dateFin: '',
        lieu: '',
        description: '',
        motsCles: '',
      },
    ];

    this.hardSkills = [
      { type: 'Metier T&L', nom: '', niveau: 'Intermediaire' as Level },
      { type: 'Outil / Logiciel', nom: '', niveau: 'Intermediaire' as Level },
    ];

    this.softSkills = [
      { nom: 'Communication', niveau: 'Intermediaire' as Level, contexte: '' },
    ];

    this.langues = [{ langue: '', niveau: 'B1', certification: '', score: '' }];
    this.projets = [{ titre: '', description: '', technologies: '', lien: '' }];
    this.certifications = [{ titre: '', organisme: '', date: '', verification: '' }];
    this.engagements = [{ type: 'Associatif', role: '', dateDebut: '', dateFin: '' }];
    this.interests = [{ label: '' }];

    this.consentGiven = false;
    this.atsScore = 0;
    this.cohortRank = 0;
    this.skillsExtracted = false;
  }

  metiers: Array<{ _id: string; nom_metier: string; domaine: string }> = [];
  selectedMetierId = '';

  async ngOnInit(): Promise<void> {
    try {
      const cinPassport = await this.cvSubmissionService.fetchStudentCinPassport();
      if (cinPassport) {
        this.studentId = cinPassport;
      }

      const rawMetiers = await this.cvSubmissionService.fetchMetiers();
      this.metiers = (Array.isArray(rawMetiers) ? rawMetiers : [])
        .map((m: any) => ({
          _id: this.normalizeMetierId(m?._id),
          nom_metier: this.asString(m?.nom_metier).trim(),
          domaine: this.asString(m?.domaine).trim(),
        }))
        .filter((m) => m._id.length > 0 && m.nom_metier.length > 0);

      this.checkSavedCv();
      // Try to auto-restore form data for returning users
      await this.autoRestoreFormState();

      // Fetch real filiere from profils_etudiant and apply to formations[0].diplome
      const filiere = await this.cvSubmissionService.fetchStudentFiliere();
      if (filiere) {
        this.studentFiliere = filiere;
        this.formations[0].diplome = filiere;
        this.cd.markForCheck();
      }
    } catch (err) {
      console.error('Failed to load metiers', err);
    }
  }

  private async loadExtractedSkills(metierId?: string, forceRegeneration = false): Promise<void> {
    const requestedMetierId = this.normalizeMetierId(metierId ?? this.selectedMetierId);
    this.hardSkillsClosed = false;

    // If CV already exists, restore saved skills.
    const existingCv = await this.cvSubmissionService.fetchMyCv(requestedMetierId);
    if (!forceRegeneration && (existingCv?.hardSkills?.length || existingCv?.softSkills?.length)) {
      this.hardSkills = (Array.isArray(existingCv.hardSkills) ? existingCv.hardSkills : []).map((s: any) => ({
        type: s.skill_type ?? s.type ?? 'Metier T&L',
        nom: s.nom ?? '',
        niveau: (s.niveau ?? 'Intermediaire') as Level,
        _system: true,
      }));

      this.softSkills = (Array.isArray(existingCv.softSkills) ? existingCv.softSkills : []).map((s: any) => ({
        nom: s.nom ?? '',
        niveau: (s.niveau ?? 'Intermediaire') as Level,
        contexte: s.contexte ?? '',
      }));

      this.skillsExtracted = this.hardSkills.length > 0;
      this.hardSkillsClosed = requestedMetierId.length > 0 && this.hardSkills.length === 0;
      return;
    }

    if (!requestedMetierId) {
      this.skillsExtracted = false;
      this.hardSkillsClosed = false;
      return;
    }

    // First-time CV: fetch auto-generated skills from notes.
    this.skillsLoading = true;
    try {
      const result = await this.cvSubmissionService.fetchExtractedSkills(requestedMetierId);
      if (result.found && result.hardSkills.length > 0) {
        this.hardSkills = result.hardSkills.map((s) => ({
          type: s.type,
          nom: s.nom,
          niveau: s.niveau as Level,
          _system: true,
        }));

        this.skillsExtracted = this.hardSkills.length > 0;
        this.hardSkillsClosed = false;
      } else {
        this.hardSkills = [];
        this.skillsExtracted = false;
        this.hardSkillsClosed = true;
      }
    } catch (err) {
      console.error('Failed to extract skills from notes', err);
    } finally {
      this.skillsLoading = false;
    }
  }

  private pick<T = any>(obj: Record<string, any> | null | undefined, ...keys: string[]): T | undefined {
    if (!obj) return undefined;
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k] as T;
    }
    return undefined;
  }

  private applyLoggedInUser(): void {
    const userProfile = this.readStoredUserProfile();
    if (!userProfile) {
      return;
    }

    this.info.prenom = this.asString(this.pick(userProfile, 'prenom', 'firstName', 'given_name'));
    this.info.nom = this.asString(this.pick(userProfile, 'nom', 'lastName', 'family_name'));
    this.info.email = this.asString(this.pick(userProfile, 'email', 'email_address') ?? this.info.email);
    this.info.telephone = this.asString(this.pick(userProfile, 'telephone', 'phone', 'phone_number') ?? this.info.telephone);
    this.info.ville = this.asString(this.pick(userProfile, 'ville', 'city') ?? this.info.ville);
    this.info.codePostal = this.asString(this.pick(userProfile, 'code_postal', 'postal_code', 'zip') ?? this.info.codePostal);
    this.info.niveau = this.asString(this.pick(userProfile, 'niveau', 'level') ?? this.info.niveau);
    this.info.sexe = this.asString(this.pick(userProfile, 'sexe', 'gender'));
    this.info.nationalite = this.asString(this.pick(userProfile, 'nationalite', 'nationality') ?? this.info.nationalite);

    const filiere = this.asString(this.pick(userProfile, 'filiere', 'major'));
    if (filiere) {
      this.formations[0].diplome = filiere;
    }
  }

  steps = [
    { label: 'Infos', icon: 'fa-user' },
    { label: 'Profil', icon: 'fa-bullseye' },
    { label: 'Formation', icon: 'fa-graduation-cap' },
    { label: 'Stages', icon: 'fa-briefcase' },
    { label: 'Hard Skills', icon: 'fa-code' },
    { label: 'Soft Skills', icon: 'fa-people-group' },
    { label: 'Langues', icon: 'fa-globe' },
    { label: 'Projets', icon: 'fa-diagram-project' },
    { label: 'Certifs', icon: 'fa-award' },
    { label: 'Para-Univ.', icon: 'fa-handshake-angle' },
    { label: 'Validation', icon: 'fa-circle-check' }
  ];

  info = {
    prenom: '',
    nom: '',
    email: '',
    telephone: '',
    ville: '',
    codePostal: '',
    niveau: '',
    sexe: '',
    nationalite: '',
    linkedin: '',
    dateNaissance: '',
    permis: '',
    photoName: ''
  };

  professionalTitle = '';
  specialization = '';
  objectif = '';

  async onMetierChange(selected: string): Promise<void> {
    const normalizedMetierId = this.normalizeMetierId(selected);
    this.selectedMetierId = normalizedMetierId;

    const found = this.metiers.find((m) => m._id === normalizedMetierId);
    if (!found) {
      this.professionalTitle = '';
      this.specialization = '';
      this.hardSkills = [];
      this.skillsExtracted = false;
      this.hardSkillsClosed = false;
      return;
    }

    this.professionalTitle = found.nom_metier;
    this.specialization = found.domaine || '';

    // Changing métier must not overwrite the user's current objective or typed fields.
    // Only refresh the skills block for the selected métier.
    try {
      await this.loadExtractedSkills(normalizedMetierId, false);
    } catch (err) {
      console.debug('[CvAts] Failed to load extracted skills for selected métier', err);
    }
  }

  savePreviewAsHtml(): boolean {
    const printContent = document.getElementById('cv-paper');
    if (!printContent) return false;

    const cvStyles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Times New Roman', Times, serif; color: #111; background: #fff; line-height: 1.5; }
      @page { size: A4; margin: 15mm; }
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Mon CV</title><style>${cvStyles}</style></head><body>${printContent.outerHTML}</body></html>`;

    try {
      localStorage.setItem(this.savedCvKey, html);
      localStorage.setItem(this.savedCvTimestampKey, new Date().toISOString());
      this.savedCvExists = true;
      return true;
    } catch (err) {
      console.error('Failed to save CV HTML to localStorage', err);
      return false;
    }
  }

  openSavedCv(alsoPrint = false) {
    try {
      const html = localStorage.getItem(this.savedCvKey);
      if (!html) return;
      const popup = window.open('', '_blank', 'width=900,height=1200');
      if (!popup) return;
      popup.document.open();
      popup.document.write(html + (alsoPrint ? `<script>window.onload = function(){ window.print(); };<\/script>` : ''));
      popup.document.close();
    } catch (err) {
      console.error('Failed to open saved CV', err);
    }
  }

  formations = [
    {
      diplome: this.studentFiliere || this.sharedProfileInfo.filiere,
      institution: 'Institut Supérieur De Gestion Industrielle De Sfax',
      dateDebut: '',
      dateFin: '',
      moyenne: '',
      modules: '',
      pfeTitre: '',
      pfeEntreprise: '',
      pfeTechnologies: ''
    }
  ];

  experiences = [
    {
      poste: '',
      entreprise: '',
      secteur: '',
      dateDebut: '',
      dateFin: '',
      lieu: '',
      description: '',
      motsCles: ''
    }
  ];

  hardSkills: Array<{ type: string; nom: string; niveau: Level; _system?: boolean }> = [
    { type: 'Metier T&L', nom: '', niveau: 'Intermediaire' as Level },
    { type: 'Outil / Logiciel', nom: '', niveau: 'Intermediaire' as Level }
  ];

  softSkills: Array<{ nom: string; niveau: Level; contexte: string }> = [
    { nom: 'Communication', niveau: 'Intermediaire' as Level, contexte: '' }
  ];

  skillsExtracted = false;
  hardSkillsClosed = false;
  skillsLoading = false;

  langues = [
    { langue: '', niveau: 'B1', certification: '', score: '' }
  ];

  projets = [
    { titre: '', description: '', technologies: '', lien: '' }
  ];

  certifications = [
    { titre: '', organisme: '', date: '', verification: '' }
  ];

  engagements = [
    { type: 'Associatif', role: '', dateDebut: '', dateFin: '' }
  ];

  interests = [
    { label: '' }
  ];

  consentGiven = false;
  studentId = '';
  createdAt = new Date().toISOString();
  updatedAt = new Date().toISOString();
  atsScore = 0;
  cohortRank = 0;

  niveaux: Level[] = ['Débutant', 'Notions', 'Intermediaire', 'Avancé', 'Expert'];
  niveauxLangue = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  secteurOptions = ['Transport routier', 'Transport maritime', 'Transport aerien', 'Logistique 3PL/4PL', 'Supply Chain', 'Douane'];
  engagementTypes = ['Associatif', 'Sport', 'Bénévolat', 'Club'];
  permisOptions = ['Aucun', 'B', 'C', 'CE', 'D'];

  atsJobDescription = '';
  atsLoading = false;
  atsError = '';
  atsResult: AtsResult | null = null;
  getScoreLoading = false;
  getScoreError = '';

  get totalSteps(): number {
    return this.steps.length;
  }

  isInfoFieldLocked(fieldName: keyof CvAts['info']): boolean {
    return this.lockedInfoFields.has(fieldName);
  }

  lockedFieldMessage(fieldName: keyof CvAts['info']): string {
    return this.isInfoFieldLocked(fieldName)
      ? 'Renseigné automatiquement à partir de votre profil.'
      : '';
  }

  isFormationDiplomaLocked(index: number): boolean {
    return index === 0;
  }

  formationDiplomaHelper(index: number): string {
    return this.isFormationDiplomaLocked(index)
      ? 'Renseigné automatiquement à partir de votre profil'
      : '';
  }

  get fullName(): string {
    return `${this.asString(this.info.prenom)} ${this.asString(this.info.nom)}`.trim();
  }

  get interestLabels(): string {
    return this.interests
      .map((it) => this.asString(it.label).trim())
      .filter((label) => !!label)
      .join(', ');
  }

  async goTo(step: number): Promise<void> {
    if (step >= 1 && step <= this.totalSteps) {
      if (step === 5 && this.selectedMetierId) {
        await this.loadExtractedSkills(this.selectedMetierId, true);
      }
      this.step = step;
      // Ensure UI updates immediately under OnPush
      try { this.cd.detectChanges(); } catch {}
      this.formError = '';
    }
  }

  async next(): Promise<void> {
    const allowClosedHardSkillsContinue = this.step === 5 && this.hardSkillsClosed;
    if (this.navigationLock && !allowClosedHardSkillsContinue) return;
    if (!allowClosedHardSkillsContinue) this.navigationLock = true;
    try {
      if (!this.canGoNext() && !allowClosedHardSkillsContinue) {
        this.formError = 'Veuillez remplir les champs obligatoires de cette etape.';
        return;
      }

      // Load extracted skills if user selected a métier on the Profil step
      if (this.step === 2 && this.selectedMetierId) {
        await this.loadExtractedSkills(this.selectedMetierId, true);
      }

      this.formError = '';
      if (this.step < this.totalSteps) {
        // Ensure we only advance by a single step and never skip
        this.step = Math.min(this.step + 1, this.totalSteps);
        // Ensure UI updates immediately under OnPush
        try { this.cd.detectChanges(); } catch {}
      }
    } finally {
      if (!allowClosedHardSkillsContinue) {
        this.navigationLock = false;
      }
    }
  }

  prev() {
    this.formError = '';
    if (this.step > 1) {
      this.step -= 1;
    }
  }

  canGoNext(): boolean {
    if (this.step === 1) {
      return !!(
        this.asString(this.info.prenom).trim() &&
        this.asString(this.info.nom).trim() &&
        this.asString(this.info.email).trim() &&
        this.asString(this.info.telephone).trim()
      );
    }
    if (this.step === 2) {
      return !!(this.asString(this.professionalTitle).trim() && this.asString(this.objectif).trim());
    }
    if (this.step === 3) {
      const first = this.formations[0];
      return !!(this.asString(first?.diplome).trim() && this.asString(first?.institution).trim());
    }
    if (this.step === 4) {
      const first = this.experiences[0];
      return !!(
        this.asString(first?.poste).trim() &&
        this.asString(first?.entreprise).trim() &&
        this.asString(first?.dateDebut).trim() &&
        this.asString(first?.dateFin).trim() &&
        this.asString(first?.description).trim() &&
        this.asString(first?.motsCles).trim()
      );
    }
    return true;
  }

  async generate() {
    console.log('generate() clicked, consentGiven=', this.consentGiven);
    try {
      if (!this.consentGiven) {
        this.formError = 'Le consentement RGPD / Loi tunisienne est obligatoire pour generer le CV.';
        console.warn('Generation blocked: consent not given');
        return;
      }

      this.formError = '';
      this.updatedAt = new Date().toISOString();
      try {
        this.atsScore = this.computeCompletenessScore();
      } catch (e) {
        console.error('computeCompletenessScore() threw', e);
        this.formError = 'Erreur lors du calcul du score. Voir console.';
        return;
      }

      this.showPreview = true;
      console.log('showPreview set true');

      // Save printable HTML and generate PDF stored in localStorage so 'Mon CV' can display it
      try {
        this.savePreviewAsHtml();
        await this.generatePdfAndSave();
        this.checkSavedCv();
      } catch (err) {
        console.warn('Auto-save PDF failed:', err);
      }

      // CV persistence layer call (after preview)
      const payload = this.buildSubmissionPayload(this.atsScore) as any;
      delete payload.atsScore;

      this.cvSubmissionService.upsertCv(payload).catch((err) => console.error('CV save failed:', err));
    } catch (err) {
      console.error('Unexpected error in generate()', err);
      this.formError = 'Erreur inattendue lors de la génération.';
    }
  }

  private buildSubmissionPayload(atsScore: number) {
    const cleanArray = (arr: any[], predicate: (item: any) => boolean) => (Array.isArray(arr) ? arr.filter(predicate) : []);

    return {
      professionalTitle: this.asString(this.professionalTitle),
      metierId: this.asString(this.selectedMetierId),
      specialization: this.asString(this.specialization),
      objectif: this.asString(this.objectif),
      atsScore: Math.max(0, Math.min(100, Math.round(Number(atsScore) || 0))),
      consentGiven: this.consentGiven,
      info: { ...this.info, telephone: this.asString(this.info.telephone) },
      formations: cleanArray(this.formations, (f) => (this.asString(f?.diplome).trim().length > 0) || (this.asString(f?.institution).trim().length > 0)),
      experiences: cleanArray(this.experiences, (e) => (this.asString(e?.poste).trim().length > 0) || (this.asString(e?.entreprise).trim().length > 0) || (this.asString(e?.description).trim().length > 0)),
      hardSkills: cleanArray(this.hardSkills, (s) => this.asString(s?.nom).trim().length > 0),
      softSkills: cleanArray(this.softSkills, (s) => this.asString(s?.nom).trim().length > 0),
      langues: cleanArray(this.langues, (l) => this.asString(l?.langue).trim().length > 0),
      projets: cleanArray(this.projets, (p) => this.asString(p?.titre).trim().length > 0),
      certifications: cleanArray(this.certifications, (c) => this.asString(c?.titre).trim().length > 0),
      engagements: cleanArray(this.engagements, (en) => (this.asString(en?.role).trim().length > 0) || (this.asString(en?.type).trim().length > 0)),
    };
  }

  async getYourScoreAndGoDashboard(): Promise<void> {
    if (this.getScoreLoading) return;

    this.getScoreLoading = true;
    this.getScoreError = '';

    try {
      const baseScore = this.atsScore > 0 ? this.atsScore : this.computeCompletenessScore();
      const scoreResult = await this.cvSubmissionService.calculateAtsScore(
        this.buildSubmissionPayload(baseScore),
      );

      this.atsScore = scoreResult.atsScore;
      this.atsResult = {
        matchScore: scoreResult.matchScore,
        overallScore: scoreResult.atsScore,
        successScore: scoreResult.successScore,
        missingKeywords: '',
        profileSummary: 'Score ATS calculé via Gemini avec le référentiel de compétences de la base de données.',
        suggestions: '',
      };

      localStorage.setItem('latestAtsMatchScore', String(scoreResult.matchScore));
      localStorage.setItem('latestAtsSuccessScore', String(scoreResult.successScore));

      await this.cvSubmissionService.upsertCv(this.buildSubmissionPayload(scoreResult.atsScore));

      try {
        await this.cvSubmissionService.runMatchingAnalysis(true);
      } catch (matchingErr) {
        console.warn('Matching analysis failed after CV generation:', matchingErr);
      }

      await this.router.navigate(['/home/dashboard']);
    } catch (err) {
      console.error('getYourScoreAndGoDashboard error', err);
      this.getScoreError = 'Impossible de finaliser votre score ATS et l\'enregistrement du CV pour le moment. Veuillez reessayer.';
    } finally {
      this.getScoreLoading = false;
    }
  }

  private loadHtml2PdfScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).html2pdf) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.9.3/html2pdf.bundle.min.js';
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  private async generatePdfAndSave(): Promise<boolean> {
    const el = document.getElementById('cv-paper');
    if (!el) return false;

    try {
      await this.loadHtml2PdfScript();
      const html2pdf = (window as any).html2pdf;
      if (!html2pdf) return false;

      const opt = {
        margin:       10,
        filename:     'mon_cv.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      // html2pdf returns a chainable instance; to get the pdf object we use toPdf().get('pdf')
      const worker = html2pdf().from(el).set(opt).toPdf();
      const pdf: any = await worker.get('pdf');
      const dataUriString: string = pdf.output('datauristring');
      const base64 = dataUriString.split(',')[1];
      localStorage.setItem('mySavedCvPdf', base64);
      localStorage.setItem('mySavedCvTimestamp', new Date().toISOString());
      return true;
    } catch (err) {
      console.error('generatePdfAndSave failed', err);
      return false;
    }
  }

  backToForm() {
    this.showPreview = false;
  }

  download() {
    const printContent = document.getElementById('cv-paper');
    if (!printContent) {
      return;
    }

    const cvStyles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Times New Roman', Times, serif;
        color: #111;
        background: #fff;
        line-height: 1.5;
      }
      @page { size: A4; margin: 15mm; }

      /* ── Paper wrapper ── */
      .cv-paper {
        background: #fff;
        font-family: 'Times New Roman', Times, serif;
        color: #111;
        line-height: 1.5;
      }

      /* ── Header ── */
      .ats-header {
        text-align: center;
        margin-bottom: 18px;
        padding-bottom: 14px;
        border-bottom: 2px solid #111;
      }
      .ats-name {
        font-size: 1.75rem;
        font-weight: 700;
        color: #111;
        margin: 0 0 4px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .ats-title {
        font-size: 0.95rem;
        color: #333;
        margin: 0 0 2px;
        font-style: italic;
      }
      .ats-subtitle {
        font-size: 0.88rem;
        color: #475569;
        font-weight: 500;
        margin: 0 0 10px;
      }
      .ats-contacts {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0;
        font-size: 0.82rem;
        color: #333;
        margin-top: 6px;
      }
      .ats-contacts span { display: inline; }
      .ats-contacts span + span::before { content: ' | '; color: #888; }

      /* ── Sections ── */
      .ats-section { margin-bottom: 18px; }
      .ats-section-title {
        font-size: 0.82rem;
        font-weight: 700;
        color: #111;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        border-bottom: 1.5px solid #111;
        padding-bottom: 3px;
        margin-bottom: 10px;
        font-family: 'Arial', sans-serif;
      }

      /* ── Objective ── */
      .ats-objective {
        font-size: 0.88rem;
        color: #222;
        margin: 0;
        line-height: 1.6;
        text-align: justify;
      }

      /* ── Entries ── */
      .ats-entry { margin-bottom: 12px; }
      .ats-entry:last-child { margin-bottom: 0; }
      .ats-entry-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }
      .ats-entry-left { display: flex; flex-direction: column; }
      .ats-entry-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        flex-shrink: 0;
      }
      .ats-entry-main { font-size: 0.92rem; font-weight: 700; color: #111; }
      .ats-entry-org   { font-size: 0.84rem; color: #444; font-style: italic; }
      .ats-entry-date  { font-size: 0.80rem; color: #555; white-space: nowrap; }
      .ats-entry-detail{ font-size: 0.78rem; color: #666; }
      .ats-entry-desc  {
        font-size: 0.84rem;
        color: #333;
        margin: 5px 0 0;
        line-height: 1.55;
        text-align: justify;
      }
      .ats-entry-desc strong { font-weight: 700; }

      /* ── Skills / Languages two-column grid ── */
      .ats-skills-wrap {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 4px 24px;
      }
      .ats-skill-item {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 0.84rem;
        padding: 2px 0;
        border-bottom: 1px dotted #ccc;
      }
      .ats-skill-name  { color: #111; font-weight: 600; }
      .ats-skill-level { color: #555; font-style: italic; font-size: 0.78rem; }

      /* ── Generic paragraph inside section ── */
      .ats-section p, .ats-entry p {
        font-size: 0.84rem;
        color: #333;
        margin: 3px 0 0;
        line-height: 1.55;
      }
      strong { font-weight: 700; }
    `;

    const popupWin = window.open('', '_blank', 'width=900,height=1200');
    if (!popupWin) {
      return;
    }

    popupWin.document.open();
    popupWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>CV ATS - ${this.fullName || 'Etudiant'}</title>
          <style>${cvStyles}</style>
        </head>
        <body onload="window.print(); window.close();">
          ${printContent.outerHTML}
        </body>
      </html>
    `);
    popupWin.document.close();
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.info.photoName = file ? file.name : '';
  }

  addFormation() {
    this.formations.push({
      diplome: '',
      institution: 'Institut Supérieur De Gestion Industrielle De Sfax',
      dateDebut: '',
      dateFin: '',
      moyenne: '',
      modules: '',
      pfeTitre: '',
      pfeEntreprise: '',
      pfeTechnologies: ''
    });
  }

  removeFormation(i: number) {
    if (this.formations.length > 1) {
      this.formations.splice(i, 1);
    }
  }

  addExperience() {
    this.experiences.push({
      poste: '',
      entreprise: '',
      secteur: '',
      dateDebut: '',
      dateFin: '',
      lieu: '',
      description: '',
      motsCles: ''
    });
  }

  removeExperience(i: number) {
    if (this.experiences.length > 1) {
      this.experiences.splice(i, 1);
    }
  }

  addHardSkill() {
    if (this.isHardSkillLocked()) return;
    this.hardSkills.push({ type: 'Metier T&L', nom: '', niveau: 'Intermediaire' });
  }

  removeHardSkill(i: number) {
    if (this.isHardSkillLocked()) return;
    if (this.hardSkills.length > 1) {
      this.hardSkills.splice(i, 1);
    }
  }

  addSoftSkill() {
    this.softSkills.push({ nom: '', niveau: 'Intermediaire', contexte: '' });
  }

  removeSoftSkill(i: number) {
    if (this.softSkills.length > 1) {
      this.softSkills.splice(i, 1);
    }
  }

  isHardSkillLocked(): boolean {
    return this.skillsExtracted || this.hardSkillsClosed;
  }

  addLangue() {
    this.langues.push({ langue: '', niveau: 'B1', certification: '', score: '' });
  }

  removeLangue(i: number) {
    if (this.langues.length > 1) {
      this.langues.splice(i, 1);
    }
  }

  addProjet() {
    this.projets.push({ titre: '', description: '', technologies: '', lien: '' });
  }

  removeProjet(i: number) {
    if (this.projets.length > 1) {
      this.projets.splice(i, 1);
    }
  }

  addCertification() {
    this.certifications.push({ titre: '', organisme: '', date: '', verification: '' });
  }

  removeCertification(i: number) {
    if (this.certifications.length > 1) {
      this.certifications.splice(i, 1);
    }
  }

  addEngagement() {
    this.engagements.push({ type: 'Associatif', role: '', dateDebut: '', dateFin: '' });
  }

  removeEngagement(i: number) {
    if (this.engagements.length > 1) {
      this.engagements.splice(i, 1);
    }
  }

  addInterest() {
    if (this.interests.length < 5) {
      this.interests.push({ label: '' });
    }
  }

  removeInterest(i: number) {
    if (this.interests.length > 1) {
      this.interests.splice(i, 1);
    }
  }

  skillWidth(level: Level): string {
    const widths: Record<Level, string> = {
      Débutant: '20%',
      Notions: '40%',
      Intermediaire: '60%',
      Avancé: '80%',
      Expert: '100%'
    };
    return widths[level];
  }

  skillColor(level: Level): string {
    const colors: Record<Level, string> = {
      Débutant: '#94a3b8',
      Notions: '#60a5fa',
      Intermediaire: '#22c55e',
      Avancé: '#f59e0b',
      Expert: '#ef4444'
    };
    return colors[level];
  }

  scoreColor(score: number): string {
    if (score >= 80) {
      return '#16a34a';
    }
    if (score >= 60) {
      return '#f59e0b';
    }
    return '#ef4444';
  }

  scoreGrade(score: number): string {
    if (score >= 80) {
      return 'Excellent';
    }
    if (score >= 60) {
      return 'Correct';
    }
    return 'A ameliorer';
  }

  checkAts() {
    const jd = this.asString(this.atsJobDescription).trim();
    if (!jd) {
      this.atsError = 'Veuillez coller une offre d emploi.';
      return;
    }

    this.atsLoading = true;
    this.atsError = '';
    this.atsResult = null;

    setTimeout(() => {
      const descriptionKeywords = this.extractKeywords(jd);
      const profileText = this.profileAsText();
      const profileKeywords = new Set(this.extractKeywords(profileText));

      let matched = 0;
      for (const keyword of descriptionKeywords) {
        if (profileKeywords.has(keyword)) {
          matched += 1;
        }
      }

      const matchScore = Math.min(100, Math.round((matched / Math.max(descriptionKeywords.length, 1)) * 100));
      const completeness = this.computeCompletenessScore();
      const structureScore = this.computeStructureScore();
      const sectorScore = this.computeSectorRelevance(descriptionKeywords, profileKeywords);

      const overallScore = Math.round(
        matchScore * 0.4 +
        structureScore * 0.2 +
        completeness * 0.2 +
        sectorScore * 0.2
      );
      const successScore = Math.round(overallScore * 0.65 + matchScore * 0.35);

      const missing = descriptionKeywords.filter((keyword) => !profileKeywords.has(keyword)).slice(0, 12);

      this.atsScore = overallScore;
      this.atsResult = {
        matchScore,
        overallScore,
        successScore,
        missingKeywords: missing.join(', '),
        profileSummary: `${this.fullName || 'Profil'} - ${this.professionalTitle || 'Etudiant'} avec ${this.hardSkills.filter((s) => this.asString(s.nom).trim()).length} hard skills, ${this.softSkills.filter((s) => this.asString(s.nom).trim()).length} soft skills et ${this.experiences.filter((e) => this.asString(e.poste).trim()).length} experiences renseignees.`,
        suggestions: this.buildSuggestions(missing)
      };

      this.atsLoading = false;
    }, 750);
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'avec', 'pour', 'dans', 'une', 'des', 'les', 'sur', 'par', 'this', 'that', 'from',
      'vous', 'votre', 'vos', 'etre', 'avoir', 'plus', 'moins', 'nous', 'leur', 'the', 'and'
    ]);

    const words = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    return Array.from(new Set(words)).slice(0, 180);
  }

  private profileAsText(): string {
    const formations = this.formations
      .map((f) => `${f.diplome} ${f.institution} ${f.modules} ${f.pfeTitre} ${f.pfeTechnologies}`)
      .join(' ');
    const experiences = this.experiences
      .map((e) => `${e.poste} ${e.entreprise} ${e.secteur} ${e.description} ${e.motsCles}`)
      .join(' ');
    const hard = this.hardSkills.map((h) => `${h.type} ${h.nom}`).join(' ');
    const soft = this.softSkills.map((s) => `${s.nom} ${s.contexte}`).join(' ');
    const langues = this.langues.map((l) => `${l.langue} ${l.niveau} ${l.certification}`).join(' ');
    const projets = this.projets.map((p) => `${p.titre} ${p.description} ${p.technologies}`).join(' ');
    const certs = this.certifications.map((c) => `${c.titre} ${c.organisme}`).join(' ');

    return `${this.fullName} ${this.professionalTitle} ${this.specialization} ${this.objectif} ${formations} ${experiences} ${hard} ${soft} ${langues} ${projets} ${certs}`;
  }

  private computeCompletenessScore(): number {
    const safe = (v: any) => String(v ?? '').trim();
    const checks = [
      !!safe(this.info.prenom),
      !!safe(this.info.nom),
      !!safe(this.info.email),
      !!safe(this.info.telephone),
      !!safe(this.professionalTitle),
      !!safe(this.objectif),
      !!safe(this.formations?.[0]?.diplome),
      !!safe(this.experiences?.[0]?.poste),
      !!this.hardSkills.some((h) => !!safe(h.nom)),
      !!this.softSkills.some((s) => !!safe(s.nom)),
      !!this.langues.some((l) => !!safe(l.langue)),
      !!this.consentGiven,
    ];

    const completed = checks.filter(Boolean).length;
    return Math.round((completed / checks.length) * 100);
  }

  private computeStructureScore(): number {
    const safe = (v: any) => String(v ?? '').trim();
    const sections = [
      this.formations.some((f) => !!safe(f?.diplome)),
      this.experiences.some((e) => !!safe(e?.poste) && !!safe(e?.description)),
      this.hardSkills.some((h) => !!safe(h?.nom)),
      this.softSkills.some((s) => !!safe(s?.nom)),
      this.langues.some((l) => !!safe(l?.langue)),
      this.projets.some((p) => !!safe(p?.titre)),
      this.certifications.some((c) => !!safe(c?.titre)),
    ];

    return Math.round((sections.filter(Boolean).length / sections.length) * 100);
  }

  private computeSectorRelevance(descriptionKeywords: string[], profileKeywords: Set<string>): number {
    const sectorTokens = ['logistique', 'supply', 'transport', 'douane', 'incoterms', 'wms', 'tms', 'sap', 'excel', 'powerbi'];
    const selected = descriptionKeywords.filter((k) => sectorTokens.includes(k));
    if (!selected.length) {
      return 65;
    }
    const matched = selected.filter((k) => profileKeywords.has(k)).length;
    return Math.round((matched / selected.length) * 100);
  }

  private buildSuggestions(missing: string[]): string {
    const tips: string[] = [];

    if (missing.length) {
      tips.push(`Ajoutez ces mots-cles de l'offre dans vos experiences et competences: ${missing.slice(0, 6).join(', ')}.`);
    }
    if (!this.info.permis || this.info.permis === 'Aucun') {
      tips.push('Renseignez votre permis de conduire (important pour les profils transport/logistique).');
    }
    if (!this.experiences.some((e) => /\d/.test(e.description))) {
      tips.push('Ajoutez des resultats chiffres dans vos missions (ex: reduction de 15% des delais).');
    }
    if (!this.langues.some((l) => ['B2', 'C1', 'C2'].includes(l.niveau))) {
      tips.push('Precisez au moins une langue avec un niveau CECRL B2 ou plus si possible.');
    }

    return tips.join(' ');
  }

}