import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { SupabaseService } from '../../../services/supabase.service';
import { environment } from '../../../../environments/environment';

type StepType = 'radio' | 'checkbox' | 'stars' | 'satisfaction';

interface FeedbackStep {
  tag: string;
  question: string;
  type: StepType;
  hint?: string;
  options?: string[];
}

interface RatingMap {
  tech: number;
  prob: number;
  team: number;
  comm: number;
  auto: number;
  agil: number;
}

interface FeedbackForm {
  q1: string;
  q3: string;
  q4: string[];
  q5: string;
  q6: string;
  q7: number | null;
  ratings: RatingMap;
  otherGap: string;
}

interface EligibleOffre {
  id: string;
  titre: string;
  date_creation: string;
}

type ScreenState = 'loading' | 'locked' | 'submitted' | 'select' | 'pre-question' | 'declined' | 'form';

@Component({
  selector: 'app-feedback-entreprise',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback-entreprise.html',
  styleUrl: './feedback-entreprise.css',
})
export class FeedbackEntreprise implements OnInit, OnDestroy {
  readonly totalSteps = 7;
  readonly storageKey = 'enterprise-feedback-draft';
  readonly offlineKey = 'enterprise-feedback-offline';

  screenState: ScreenState = 'loading';
  eligibleOffres: EligibleOffre[] = [];
  selectedOffre: EligibleOffre | null = null;
  showDeclineConfirm = false;

  currentStep = 0;
  isSubmitting = false;
  submitError = '';
  submitSuccess = false;
  companyName = 'Entreprise partenaire';
  companySector = 'Entreprise';

  readonly ratingKeys: Array<keyof RatingMap> = ['tech', 'prob', 'team', 'comm', 'auto', 'agil'];
  readonly ratingLabels = [
    'Compétences techniques métier',
    'Résolution de problèmes',
    'Travail en équipe / Collaboration',
    'Communication professionnelle',
    'Autonomie & Gestion des priorités',
    'Capacité d\'apprentissage & Agilité',
  ];
  readonly ratingScale = [1, 2, 3, 4, 5, 6];
  readonly satisfactionScale = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly satisfactionLabels = ['', 'Très insatisfait', 'Insatisfait', 'Plutôt insatisfait', 'Légèrement insatisfait', 'Neutre', 'Légèrement satisfait', 'Satisfait', 'Bien satisfait', 'Très satisfait', 'Extrêmement satisfait'];

  readonly steps: FeedbackStep[] = [
    {
      tag: 'Question 1 / 7',
      question: 'Quelle est la situation actuelle du diplômé dans votre Société ?',
      type: 'radio',
      options: ['Toujours en poste - même fonction', 'Toujours en poste - promu / changement de fonction', 'Mutation interne (autre département)', 'A quitté l\'entreprise (démission)', 'Fin de contrat (CDD/SIVP non renouvelé)', 'Licenciement / Rupture de période d\'essai'],
    },
    {
      tag: 'Question 2 / 7',
      question: 'Évaluez le diplômé ISGIS sur les dimensions suivantes',
      type: 'stars',
      hint: 'Notez chaque dimension de 1 (insuffisant) à 6 (excellent)',
    },
    {
      tag: 'Question 3 / 7',
      question: 'Le profil académique ISGIS correspond-il aux exigences du poste ?',
      type: 'radio',
      options: ['Très bien adapté - peu d\'effort d\'intégration requis', 'Bien adapté - adaptation rapide (< 1 mois)', 'Partiellement adapté - formation interne nécessaire', 'Peu adapté - écart significatif avec les besoins du poste'],
    },
    {
      tag: 'Question 4 / 7',
      question: 'Quelles lacunes avez-vous observées à l\'arrivée du diplômé ? (3 choix maximum)',
      type: 'checkbox',
      options: ['Maîtrise des outils métier (ERP, CFAO, Excel avancé...)', 'Anglais professionnel / technique', 'Gestion de projet et méthodes (Agile, Lean, 6 Sigma...)', 'Analyse de données / Outils BI', 'Communication écrite et orale professionnelle', 'Connaissance des processus industriels réels', 'Sens commercial / relation client', 'Aucune lacune notable', 'Autre'],
    },
    {
      tag: 'Question 5 / 7',
      question: 'Comment évaluez-vous la participation des diplômés dans la performance globale de votre société ?',
      type: 'radio',
      options: ['Progression rapide et remarquable', 'Progression régulière et satisfaisante', 'Progression lente mais continue', 'Stagnation / Peu d\'évolution observée'],
    },
    {
      tag: 'Question 6 / 7',
      question: 'Envisagez-vous de recruter d\'autres diplômés ISGIS ?',
      type: 'radio',
      options: ['Oui, certainement', 'Probablement oui', 'Incertain(e)', 'Non'],
    },
    {
      tag: 'Question 7 / 7',
      question: 'Sur une échelle de 0 à 10, quelle est votre satisfaction globale vis-à-vis du diplômé ISGIS ?',
      type: 'satisfaction',
    },
  ];

  form: FeedbackForm = this.createEmptyForm();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute,
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.loadCompanyInfo();
    void this.initFeedbackScreen();
  }

  private async initFeedbackScreen(): Promise<void> {
    let societeId: number | null = null;
    try {
      const raw = localStorage.getItem('entreprise');
      if (raw) {
        const societe = JSON.parse(raw) as Record<string, unknown>;
        const parsed = Number(societe['id']);
        societeId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      }
    } catch { /* ignore */ }

    if (!societeId) {
      console.warn('[Feedback] No societeId found in localStorage');
      this.screenState = 'locked';
      this.cdr.detectChanges();
      return;
    }

    console.log('[Feedback] societeId=', societeId);

    try {
      // Call the backend with the JWT — service role on the server bypasses
      // RLS on `post`, which the anon client used in the frontend cannot read.
      const apiUrl = `${environment.apiUrl}/offres/company/${societeId}/feedback-eligible`;
      const response: any = await firstValueFrom(this.http.get<any>(apiUrl));
      console.log('[Feedback] backend response:', response);

      const rows = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.data?.data)
          ? response.data.data
          : Array.isArray(response)
            ? response
            : [];

      // The backend is authoritative: it joins feedback_societe.id_post
      // server-side. If the row was deleted, `submitted` is false and the
      // form must reopen — do NOT layer localStorage on top here.
      this.clearStaleLocalSubmissions(rows);

      const allEligible = rows.map((row: Record<string, unknown>) => {
        const idLine = String(row['id_line'] ?? row['id'] ?? '');
        return {
          id: idLine,
          titre: String(row['titre_poste'] ?? 'Offre sans titre'),
          date_creation: String(row['date_creation'] ?? ''),
          submitted: row['submitted'] === true,
        };
      }).filter((o: { id: string }) => o.id);

      const offres: EligibleOffre[] = allEligible
        .filter((o: { submitted: boolean }) => !o.submitted)
        .map(({ submitted, ...rest }: { submitted: boolean; id: string; titre: string; date_creation: string }) => rest);

      console.log('[Feedback] pending offres:', offres);

      if (offres.length === 0) {
        this.screenState = 'locked';
        this.cdr.detectChanges();
        return;
      }

      this.eligibleOffres = offres;

      const postIdParam = this.route.snapshot.queryParamMap.get('postId');
      if (postIdParam) {
        const match = offres.find(o => o.id === postIdParam);
        this.selectedOffre = match ?? offres[0];
      } else if (offres.length === 1) {
        this.selectedOffre = offres[0];
      } else {
        this.screenState = 'select';
        this.cdr.detectChanges();
        return;
      }

      this.screenState = 'pre-question';
    } catch (err) {
      console.error('[Feedback] Error loading eligible posts:', err);
      this.screenState = 'locked';
    }

    this.cdr.detectChanges();
  }

  selectOffre(offre: EligibleOffre): void {
    this.selectedOffre = offre;
    this.screenState = 'pre-question';
  }

  acceptedStudent(): void {
    this.showDeclineConfirm = false;
    this.restoreDraft();
    this.screenState = 'form';
  }

  requestDecline(): void {
    this.showDeclineConfirm = true;
  }

  cancelDecline(): void {
    this.showDeclineConfirm = false;
  }

  async declinedStudent(): Promise<void> {
    this.showDeclineConfirm = false;
    const declinedId = this.selectedOffre?.id;
    if (declinedId) {
      this.eligibleOffres = this.eligibleOffres.filter((o) => o.id !== declinedId);
    }
    this.screenState = 'declined';
    this.cdr.detectChanges();

    let societeId: number | null = null;
    try {
      const raw = localStorage.getItem('entreprise');
      if (raw) {
        const societe = JSON.parse(raw) as Record<string, unknown>;
        const parsed = Number(societe['id']);
        societeId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      }
    } catch { /* ignore */ }

    const postIdNum = Number(this.selectedOffre?.id);
    if (!societeId || !Number.isFinite(postIdNum) || postIdNum <= 0) {
      this.scheduleSuccessRedirect();
      return;
    }

    try {
      const apiUrl = `${environment.apiUrl}/offres/company/${societeId}/feedback/decline`;
      await firstValueFrom(this.http.post<any>(apiUrl, { id_post: postIdNum }));
    } catch (err) {
      console.warn('[Feedback] could not persist decline:', err);
    }
    this.scheduleSuccessRedirect();
  }

  get progressPercent(): number {
    return Math.round(((this.currentStep + 1) / this.totalSteps) * 100);
  }

  get isLastStep(): boolean {
    return this.currentStep === this.totalSteps - 1;
  }

  get selectedGapCount(): number {
    return this.form.q4.length;
  }

  get currentKey(): 'q1' | 'q3' | 'q5' | 'q6' {
    if (this.currentStep === 0) return 'q1';
    if (this.currentStep === 2) return 'q3';
    if (this.currentStep === 4) return 'q5';
    return 'q6';
  }

  isRadioSelected(value: string): boolean {
    return this.form[this.currentKey] === value;
  }

  isGapSelected(value: string): boolean {
    return this.form.q4.includes(value);
  }

  setRadio(value: string): void {
    this.form[this.currentKey] = value;
    this.submitError = '';
    this.persistDraft();
  }

  toggleGap(value: string): void {
    const index = this.form.q4.indexOf(value);
    if (index >= 0) {
      this.form.q4.splice(index, 1);
    } else if (this.form.q4.length < 3) {
      this.form.q4.push(value);
    }

    if (!this.form.q4.includes('Autre')) {
      this.form.otherGap = '';
    }

    this.submitError = '';
    this.persistDraft();
  }

  setRating(metric: keyof RatingMap, value: number): void {
    this.form.ratings[metric] = value;
    this.submitError = '';
    this.persistDraft();
  }

  setSatisfaction(value: number): void {
    this.form.q7 = value;
    this.submitError = '';
    this.persistDraft();
  }

  onOtherGapInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.form.otherGap = target?.value ?? '';
    this.persistDraft();
  }

  nextStep(): void {
    if (!this.validateCurrentStep()) {
      return;
    }

    if (!this.isLastStep) {
      this.currentStep += 1;
      return;
    }

    void this.submit();
  }

  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep -= 1;
      this.submitError = '';
      this.submitSuccess = false;
    }
  }

  goToStep(index: number): void {
    if (index <= this.currentStep) {
      this.currentStep = index;
      this.submitError = '';
      this.submitSuccess = false;
    }
  }

  resetForm(): void {
    this.form = this.createEmptyForm();
    this.currentStep = 0;
    this.submitError = '';
    this.submitSuccess = false;
    localStorage.removeItem(this.storageKey);
  }

  satisfactionText(): string {
    const value = this.form.q7;
    return value ? (this.satisfactionLabels[value] ?? '') : '';
  }

  async submit(): Promise<void> {
    if (!this.validateAll()) {
      return;
    }

    const payload = this.buildPayload();
    this.isSubmitting = true;
    this.submitError = '';

    const societeId = Number((payload as Record<string, unknown>)['id_soc']);
    if (!Number.isFinite(societeId) || societeId <= 0) {
      this.submitError = 'Compte société introuvable. Veuillez vous reconnecter.';
      this.isSubmitting = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      // Send via the backend so the service-role key bypasses RLS on
      // feedback_societe (the anon client used in the frontend is denied).
      const apiUrl = `${environment.apiUrl}/offres/company/${societeId}/feedback`;
      const response: any = await firstValueFrom(this.http.post<any>(apiUrl, payload));
      const ok = response?.success === true
        || response?.data?.success === true
        || (response?.data && response?.data?.success !== false);
      if (!ok) {
        throw new Error(response?.error ?? response?.data?.error ?? 'Échec de la soumission');
      }

      if (this.selectedOffre?.id) {
        this.markSubmittedLocally(this.selectedOffre.id);
        this.eligibleOffres = this.eligibleOffres.filter((o) => o.id !== this.selectedOffre?.id);
      }

      this.submitSuccess = true;
      localStorage.removeItem(this.storageKey);
      this.scheduleSuccessRedirect();
    } catch (err) {
      console.error('Feedback submit error:', err);
      this.persistOffline(payload);
      this.submitSuccess = true; // still show success (saved offline)
      this.scheduleSuccessRedirect();
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  get hasMoreFeedbacks(): boolean {
    return this.eligibleOffres.length > 0;
  }

  continueAfterSuccess(): void {
    this.cancelSuccessRedirect();
    if (this.hasMoreFeedbacks) {
      const next = this.eligibleOffres[0];
      this.selectedOffre = next;
      this.submitSuccess = false;
      this.submitError = '';
      this.currentStep = 0;
      this.form = this.createEmptyForm();
      this.screenState = 'pre-question';
      this.cdr.detectChanges();
      return;
    }
    this.router.navigate(['/entreprise/offres']);
  }

  ngOnDestroy(): void {
    this.cancelSuccessRedirect();
  }

  private successRedirectTimer: ReturnType<typeof setTimeout> | null = null;

  private cancelSuccessRedirect(): void {
    if (this.successRedirectTimer !== null) {
      clearTimeout(this.successRedirectTimer);
      this.successRedirectTimer = null;
    }
  }

  private scheduleSuccessRedirect(): void {
    this.cancelSuccessRedirect();
    this.successRedirectTimer = setTimeout(() => {
      this.successRedirectTimer = null;
      this.router.navigate(['/entreprise/offres']);
    }, 10000);
  }

  private validateCurrentStep(): boolean {
    const current = this.steps[this.currentStep];

    if (current.type === 'radio' && !this.form[this.currentKey]) {
      this.submitError = 'Veuillez sélectionner une option.';
      return false;
    }

    if (current.type === 'checkbox' && this.form.q4.length === 0) {
      this.submitError = 'Veuillez choisir au moins une option.';
      return false;
    }

    if (current.type === 'stars' && this.ratingKeys.some(key => this.form.ratings[key] <= 0)) {
      this.submitError = 'Veuillez noter toutes les dimensions.';
      return false;
    }

    if (current.type === 'satisfaction' && this.form.q7 === null) {
      this.submitError = 'Veuillez sélectionner une note.';
      return false;
    }

    this.submitError = '';
    return true;
  }

  private validateAll(): boolean {
    const snapshot = this.currentStep;
    for (let i = 0; i < this.steps.length; i += 1) {
      this.currentStep = i;
      if (!this.validateCurrentStep()) {
        this.currentStep = snapshot;
        return false;
      }
    }

    this.currentStep = snapshot;
    return true;
  }

  private buildPayload(): Record<string, unknown> {
    let societeId: number | null = null;
    try {
      const raw = localStorage.getItem('entreprise');
      if (raw) {
        const societe = JSON.parse(raw) as Record<string, unknown>;
        societeId = typeof societe['id'] === 'number' ? societe['id'] : null;
      }
    } catch { /* ignore */ }

    const lacunes = this.form.q4.slice();
    if (this.form.otherGap.trim()) {
      lacunes.push(this.form.otherGap.trim());
    }

    const postIdNum = Number(this.selectedOffre?.id);

    return {
      id_soc: societeId,
      id_post: Number.isFinite(postIdNum) && postIdNum > 0 ? postIdNum : null,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      "1. Quelle est la situation actuelle du diplômé dans votre ent": this.form.q1,
      "2. [Compétences techniques métier]": this.form.ratings.tech,
      "2. [Résolution de problèmes]": this.form.ratings.prob,
      "2. [Travail en équipe / Collaboration]": this.form.ratings.team,
      "2. [Communication professionnelle]": this.form.ratings.comm,
      "2. [Autonomie & Gestion des priorités]": this.form.ratings.auto,
      "2.[Capacité d'apprentissage & Agilité]": this.form.ratings.agil,
      "3. Le profil académique ISGIS correspond-il aux exigences du p": this.form.q3,
      "4. Quelles lacunes avez-vous observées à l'arrivée du diplô": lacunes.join(', '),
      "5. Comment évaluez-vous la participation des diplomés dans la": this.form.q5,
      "6. Envisagez-vous de recruter d'autres diplômés ISGIS ?": this.form.q6,
      "7. Sur une échelle de 0 à 10, quelle est votre satisfaction g": this.form.q7 ?? 0,
    };
  }

  private loadCompanyInfo(): void {
    try {
      const raw = localStorage.getItem('entreprise');
      if (!raw) return;
      const societe = JSON.parse(raw) as Record<string, unknown>;
      this.companyName = (societe['denomination_sociale'] ?? societe['nom'] ?? 'Entreprise partenaire') as string;
      this.companySector = (societe['secteur_activite'] ?? 'Entreprise') as string;
    } catch { /* keep defaults */ }
  }

  private readonly submittedKey = 'enterprise-feedback-submitted';

  private async loadSubmittedPostIds(societeId: number): Promise<Set<string>> {
    try {
      const { data, error } = await this.supabaseService.adminClient
        .from('feedback_societe')
        .select('id_post')
        .eq('id_soc', societeId);
      if (error) {
        console.warn('[Feedback] could not read feedback_societe (id_post column may be missing):', error.message);
        return new Set();
      }
      return new Set(
        (data || [])
          .map((row: Record<string, unknown>) => row['id_post'])
          .filter((value): value is number | string => value !== null && value !== undefined)
          .map((value) => String(value)),
      );
    } catch (err) {
      console.warn('[Feedback] feedback_societe lookup failed:', err);
      return new Set();
    }
  }

  private getSubmittedPostIds(): Set<string> {
    try {
      const raw = localStorage.getItem(this.submittedKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
    } catch {
      return new Set();
    }
  }

  private clearStaleLocalSubmissions(rows: Array<Record<string, unknown>>): void {
    try {
      const stillSubmittedOnServer = new Set(
        rows
          .filter((row) => row['submitted'] === true)
          .map((row) => String(row['id_line'] ?? row['id'] ?? '')),
      );
      const local = this.getSubmittedPostIds();
      const pruned = [...local].filter((id) => stillSubmittedOnServer.has(id));
      localStorage.setItem(this.submittedKey, JSON.stringify(pruned));
    } catch { /* ignore */ }
  }

  private markSubmittedLocally(postId: string): void {
    try {
      const ids = this.getSubmittedPostIds();
      ids.add(String(postId));
      localStorage.setItem(this.submittedKey, JSON.stringify([...ids]));
    } catch { /* ignore */ }
  }

  private persistDraft(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.form));
  }

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as FeedbackForm;
      this.form = {
        q1: draft.q1 ?? '',
        q3: draft.q3 ?? '',
        q4: Array.isArray(draft.q4) ? draft.q4 : [],
        q5: draft.q5 ?? '',
        q6: draft.q6 ?? '',
        q7: typeof draft.q7 === 'number' ? draft.q7 : null,
        ratings: {
          tech: draft.ratings?.tech ?? 0,
          prob: draft.ratings?.prob ?? 0,
          team: draft.ratings?.team ?? 0,
          comm: draft.ratings?.comm ?? 0,
          auto: draft.ratings?.auto ?? 0,
          agil: draft.ratings?.agil ?? 0,
        },
        otherGap: draft.otherGap ?? '',
      };
    } catch {
      // Ignore malformed drafts.
    }
  }

  private persistOffline(payload: Record<string, unknown>): void {
    try {
      const raw = localStorage.getItem(this.offlineKey);
      const existing = raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];
      existing.push({ ...payload, submittedAt: new Date().toISOString() });
      localStorage.setItem(this.offlineKey, JSON.stringify(existing));
    } catch {
      // Ignore offline persistence failures.
    }
  }

  private createEmptyForm(): FeedbackForm {
    return {
      q1: '',
      q3: '',
      q4: [],
      q5: '',
      q6: '',
      q7: null,
      ratings: {
        tech: 0,
        prob: 0,
        team: 0,
        comm: 0,
        auto: 0,
        agil: 0,
      },
      otherGap: '',
    };
  }
}
