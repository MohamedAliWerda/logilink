import { CommonModule } from '@angular/common';
import { CvPreview } from '../../component/cv-preview/cv-preview';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  STUDENT_PROFILE_DATA,
  StudentProfileData,
} from '../../student-profile.data';
import { environment } from '../../../../../environments/environment';


@Component({
  selector: 'app-profil',
  imports: [CommonModule, CvPreview],
  templateUrl: './profil.html',
  styleUrl: './profil.css',
})
export class Profil {
  private static readonly maxProfileImageSize = 5 * 1024 * 1024;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly apiBaseUrl = environment.apiUrl;
  private readonly supabaseUrl = environment.supabaseUrl;
  private readonly supabaseAnonKey = environment.supabaseAnonKey;

  protected readonly activeSection = signal<'info' | 'mon-cv'>('info');
  protected readonly profileImageUrl = signal<string | null>(null);
  protected readonly profileImageError = signal<string | null>(null);

  protected profileData: StudentProfileData = this.buildProfileFromStorage();
  protected userName = this.profileData.displayName;
  protected profileStatus = this.profileData.status;
  protected profileSummaryItems = this.profileData.summaryItems;
  protected infoSectionTitle = this.profileData.infoSectionTitle;
  protected infoSectionSubtitle = this.profileData.infoSectionSubtitle;
  protected profileInfoGroups = this.profileData.infoGroups;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const section = params.get('section');
      if (section === 'mon-cv') {
        this.activeSection.set('mon-cv');
      } else {
        this.activeSection.set('info');
      }
    });

    void this.loadRemoteProfile();
    this.loadSavedPdf();
    void this.checkCvExists();
  }

  savedCvPdfBase64: string | null = null;
  savedCvDataUrl: SafeResourceUrl | null = null;
  savedCvExists = false;
  savedCvFromDb: any | null = null;
  debugCvInfo: string | null = null;

  private loadSavedPdf(): void {
    try {
      const b64 = localStorage.getItem('mySavedCvPdf');
      this.savedCvPdfBase64 = b64 && b64.length > 0 ? b64 : null;
      if (this.savedCvPdfBase64) {
        try {
          const raw = 'data:application/pdf;base64,' + this.savedCvPdfBase64;
          this.savedCvDataUrl = this.sanitizer.bypassSecurityTrustResourceUrl(raw);
        } catch {
          this.savedCvDataUrl = null;
        }
      } else {
        this.savedCvDataUrl = null;
      }
    } catch {
      this.savedCvPdfBase64 = null;
    }
  }

  private async checkCvExists(): Promise<void> {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        this.debugCvInfo = 'No token in localStorage; user not authenticated.';
        this.savedCvExists = false;
        this.savedCvFromDb = null;
        return;
      }

      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      console.debug('[Profil] Checking CV existence with token:', token?.substring?.(0, 12) + '...');
      const respRaw = await firstValueFrom(this.http.get<any>(`${this.apiBaseUrl}/cv-submissions/me`, { headers }));
      console.debug('[Profil] /cv-submissions/me raw response:', respRaw);
      // API may return either { found, cv } or wrapped { success, message, data: { found, cv } }
      const resp = (respRaw && typeof respRaw === 'object' && 'data' in respRaw) ? respRaw.data : respRaw;
      this.debugCvInfo = JSON.stringify(respRaw, null, 2);
      if (resp && resp.found) {
        this.savedCvExists = true;
        this.savedCvFromDb = resp.cv ?? null;
      } else {
        this.savedCvExists = false;
        this.savedCvFromDb = null;
      }
    } catch (err: any) {
      console.error('[Profil] checkCvExists error', err);
      this.debugCvInfo = 'Error checking CV: ' + (err?.message ?? String(err));
      this.savedCvExists = false;
      this.savedCvFromDb = null;
    }
  }

  // Mon CV should not navigate to the CV editor from the profile view.

  private mergeProfileRecord(
    base: StudentProfileData,
    record: Record<string, unknown>,
  ): StudentProfileData {
    const pickText = (keys: string[]): string | null => {
      for (const key of keys) {
        const value = record[key as keyof typeof record];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      }
      return null;
    };

    const fullName = [
      pickText(['prenom', 'firstName', 'prenom_etudiant', 'given_name']),
      pickText(['nom', 'lastName', 'nom_etudiant', 'family_name']),
    ]
      .filter((v): v is string => Boolean(v))
      .join(' ')
      .trim();

    return {
      ...base,
      displayName: fullName || pickText(['displayName', 'display_name']) || pickText(['email', 'email_institutionnel']) || base.displayName,
      firstName: pickText(['prenom', 'firstName', 'prenom_etudiant']) || base.firstName,
      lastName: pickText(['nom', 'lastName', 'nom_etudiant']) || base.lastName,
      summaryItems: base.summaryItems.map((item) => {
        const key = item.label.toLowerCase();
        if (key.includes('groupe')) {
          return { ...item, value: pickText(['groupe', 'groupe_etudiant', 'group', 'group_name']) || '-' };
        }
        if (key.includes('niveau')) {
          return { ...item, value: pickText(['niveau', 'level', 'annee', 'classe']) || '-' };
        }
        if (key.includes('filiere')) {
          return { ...item, value: pickText(['filiere', 'specialite', 'major', 'programme', 'formation']) || '-' };
        }
        if (key.includes('departement')) {
          return { ...item, value: pickText(['departement', 'department']) || '-' };
        }
        return item;
      }),
      infoGroups: base.infoGroups.map((group) => ({
        ...group,
        items: group.items.map((it) => {
          const label = it.label.toLowerCase();
          if (label.includes('nom') || label.includes('prenom')) {
            return { ...it, value: fullName || pickText(['displayName', 'display_name']) || base.displayName || '-' };
          }
          if (label.includes('sexe')) {
            return { ...it, value: pickText(['sexe', 'gender']) || '-' };
          }
          if (label.includes('cin') || label.includes('passport')) {
            return { ...it, value: pickText(['cin_passport', 'cinPassport', 'cin', 'passport']) || '-' };
          }
          if (label.includes('nationalite')) {
            return { ...it, value: pickText(['nationalite', 'nationality']) || '-' };
          }
          if (label.includes('ville de naissance') || label.includes('lieu de naissance') || label.includes('naissance')) {
            return { ...it, value: pickText(['ville_naissance', 'lieu_naissance', 'birth_place']) || '-' };
          }
          if (label.includes('ville') && !label.includes('naissance')) {
            return { ...it, value: pickText(['ville', 'city', 'ville_residence']) || '-' };
          }
          if (label.includes('adresse') || label.includes('adresse postale')) {
            return { ...it, value: pickText(['adresse_postale', 'adresse', 'address', 'street_address']) || '-' };
          }
          if (label.includes('code postal') || label.includes('postal')) {
            return { ...it, value: pickText(['code_postal', 'postal_code', 'zip']) || '-' };
          }
          if (label.includes('email')) {
            return { ...it, value: pickText(['email', 'email_institutionnel', 'email_personnel', 'email_address', 'mail']) || '-' };
          }
          if (label.includes('telephone') || label.includes('téléphone') || label.includes('tel')) {
            return { ...it, value: pickText(['telephone', 'telephone_mobile', 'telephone_fixe', 'phone', 'phone_number', 'mobile']) || '-' };
          }
          if (label.includes('date de naissance') || (label.includes('date') && label.includes('naissance'))) {
            return { ...it, value: pickText(['date_naissance', 'dateNaissance', 'birthdate', 'birthday']) || '-' };
          }
          if (label.includes('linkedin')) {
            return { ...it, value: pickText(['linkedin', 'linkedin_url', 'linkedinUrl']) || '-' };
          }
          if (label.includes('permis')) {
            return { ...it, value: pickText(['permis', 'permis_de_conduire', 'driving_license']) || '-' };
          }
          return it;
        }),
      })),
    };
  }

  private buildProfileFromStorage(): StudentProfileData {
    const formatNameFromEmail = (email: string): string => {
      const local = email.split('@')[0] ?? '';
      const parts = local.split(/[._-]+/).filter(Boolean);
      if (parts.length === 0) return email;
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    };

    try {
      const raw = localStorage.getItem('user');
      if (!raw) return STUDENT_PROFILE_DATA;

      const parsed = JSON.parse(raw) as Record<string, unknown> | null;
      if (!parsed) return STUDENT_PROFILE_DATA;

      const displayNameFromFields =
        (typeof parsed['displayName'] === 'string' && parsed['displayName']) ||
        ((typeof parsed['prenom'] === 'string' || typeof parsed['nom'] === 'string')
          ? `${String(parsed['prenom'] ?? '')} ${String(parsed['nom'] ?? '')}`.trim()
          : undefined) ||
        ((typeof parsed['firstName'] === 'string' ||
          typeof parsed['lastName'] === 'string')
          ? `${String(parsed['firstName'] ?? '')} ${String(parsed['lastName'] ?? '')}`.trim()
          : undefined);

      const email = typeof parsed['email'] === 'string' ? parsed['email'] : undefined;
      const displayName = displayNameFromFields || (email ? formatNameFromEmail(email) : undefined);

      const base: StudentProfileData = {
        ...STUDENT_PROFILE_DATA,
        displayName: displayName ?? STUDENT_PROFILE_DATA.displayName,
        firstName:
          typeof parsed['firstName'] === 'string'
            ? parsed['firstName']
            : typeof parsed['prenom'] === 'string'
              ? parsed['prenom']
            : STUDENT_PROFILE_DATA.firstName,
        lastName:
          typeof parsed['lastName'] === 'string'
            ? parsed['lastName']
            : typeof parsed['nom'] === 'string'
              ? parsed['nom']
            : STUDENT_PROFILE_DATA.lastName,
        status:
          typeof parsed['status'] === 'string'
            ? parsed['status']
            : STUDENT_PROFILE_DATA.status,
        summaryItems: STUDENT_PROFILE_DATA.summaryItems.map((item) => ({
          ...item,
          value: '-',
        })),
        infoGroups: STUDENT_PROFILE_DATA.infoGroups.map((group) => ({
          ...group,
          items: group.items.map((it) => ({
            ...it,
            value: '-',
          })),
        })),
      };

      return this.mergeProfileRecord(base, parsed);
    } catch {
      return STUDENT_PROFILE_DATA;
    }
  }

  private applyProfileData(data: StudentProfileData): void {
    this.profileData = data;
    this.userName = data.displayName;
    this.profileStatus = data.status;
    this.profileSummaryItems = data.summaryItems;
    this.infoSectionTitle = data.infoSectionTitle;
    this.infoSectionSubtitle = data.infoSectionSubtitle;
    this.profileInfoGroups = data.infoGroups;
  }

  private async loadRemoteProfile(): Promise<void> {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      const respRaw = await firstValueFrom(
        this.http.get<any>(`${this.apiBaseUrl}/profile`, { headers }),
      );

      if (!respRaw) {
        await this.loadSupabaseProfileFallback();
        return;
      }

      // API may return either { message, data } or { success, data } or the raw profile object.
      let remote: Record<string, unknown> | null = null;
      if (typeof respRaw === 'object' && respRaw !== null && 'data' in respRaw) {
        const maybe = respRaw.data as unknown;
        if (typeof maybe === 'object' && maybe !== null) {
          // If the backend returned { data: { data: profile } } handle nested shape
          if ('data' in (maybe as Record<string, unknown>)) {
            const nested = (maybe as Record<string, unknown>)['data'];
            if (nested && typeof nested === 'object') remote = nested as Record<string, unknown>;
          } else {
            remote = maybe as Record<string, unknown>;
          }
        }
      } else if (typeof respRaw === 'object' && respRaw !== null) {
        // respRaw may already be the profile object
        remote = respRaw as Record<string, unknown>;
      }

      if (!remote) {
        await this.loadSupabaseProfileFallback();
        return;
      }

      const merged: StudentProfileData = this.mergeProfileRecord(this.profileData, remote);
      this.applyProfileData(merged);
    } catch {
      await this.loadSupabaseProfileFallback();
    }
  }

  private async loadSupabaseProfileFallback(): Promise<void> {
    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return;
      const user = JSON.parse(rawUser) as Record<string, unknown>;
      const cin =
        typeof user['cin_passport'] === 'number'
          ? String(user['cin_passport'])
          : typeof user['cin_passport'] === 'string'
            ? user['cin_passport']
            : '';

      if (!cin) return;

      const headers = new HttpHeaders({
        apikey: this.supabaseAnonKey,
        Authorization: `Bearer ${this.supabaseAnonKey}`,
      });

      const url = `${this.supabaseUrl}/rest/v1/profils_etudiant?cin_passport=eq.${encodeURIComponent(cin)}&select=*`;
      const rows = await firstValueFrom(
        this.http.get<Record<string, unknown>[]>(url, { headers }),
      );

      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (!row) return;

      const merged = this.mergeProfileRecord(this.profileData, row);
      this.applyProfileData(merged);
    } catch {
      // Keep current data if fallback also fails.
    }
  }

  public showInfoSection(): void {
    this.activeSection.set('info');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section: null },
      queryParamsHandling: 'merge',
    });
  }

  public async showReleveNotesSection(): Promise<void> {
    this.activeSection.set('mon-cv');
    this.loadSavedPdf();
    // Ensure we fetch latest CV metadata and content from backend before showing
    await this.checkCvExists();

    // Navigate to the mon-cv section in the URL
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section: 'mon-cv' },
      queryParamsHandling: 'merge',
    });
    // Note: Do not auto-generate or auto-save PDFs when the user opens the Mon CV
    // section. The user must explicitly click the "Générer et enregistrer" or
    // "Télécharger mon CV (PDF)" buttons to create/save the PDF.
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

  public async generatePdfFromDb(): Promise<void> {
    try {
      if (!this.savedCvFromDb) {
        await this.checkCvExists();
      }
      const cv = this.savedCvFromDb;
      if (!cv) return;

      // Normalize cv fields coming from backend (snake_case -> camelCase)
      const normalizeCv = (cvObj: any) => {
        if (!cvObj || typeof cvObj !== 'object') return;
        const mapDates = (obj: any, starts: string[], ends: string[]) => {
          if (!obj || typeof obj !== 'object') return;
          if (!('dateDebut' in obj)) {
            for (const k of starts) if (k in obj && obj[k]) { obj.dateDebut = obj[k]; break; }
          }
          if (!('dateFin' in obj)) {
            for (const k of ends) if (k in obj && obj[k]) { obj.dateFin = obj[k]; break; }
          }
        };

        if (cvObj.info && typeof cvObj.info === 'object') {
          const info = cvObj.info;
          if (!('email' in info) && 'email_institutionnel' in info) info.email = info.email_institutionnel;
          if (!('codePostal' in info) && 'code_postal' in info) info.codePostal = info.code_postal;
          if (!('dateNaissance' in info) && 'date_naissance' in info) info.dateNaissance = info.date_naissance;
        }

        if (Array.isArray(cvObj.formations)) {
          cvObj.formations.forEach((f: any) => {
            mapDates(f, ['dateDebut', 'date_debut', 'startDate'], ['dateFin', 'date_fin', 'endDate']);
            if (!('pfeTitre' in f) && 'pfe_titre' in f) f.pfeTitre = f.pfe_titre;
            if (!('pfeEntreprise' in f) && 'pfe_entreprise' in f) f.pfeEntreprise = f.pfe_entreprise;
          });
        }

        if (Array.isArray(cvObj.experiences)) {
          cvObj.experiences.forEach((e: any) => {
            mapDates(e, ['dateDebut', 'date_debut', 'startDate'], ['dateFin', 'date_fin', 'endDate']);
            if (!('motsCles' in e) && 'mots_cles' in e) e.motsCles = e.mots_cles;
          });
        }

        if (Array.isArray(cvObj.engagements)) {
          cvObj.engagements.forEach((en: any) => {
            mapDates(en, ['dateDebut', 'date_debut', 'startDate'], ['dateFin', 'date_fin', 'endDate']);
          });
        }

        if (Array.isArray(cvObj.certifications)) {
          cvObj.certifications.forEach((c: any) => {
            if (!('date' in c) && 'date_obtenue' in c) c.date = c.date_obtenue;
          });
        }
      };

      normalizeCv(cv);

      // Build printable HTML using the same layout and styles as CV-ATS preview
      const cvStyles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Times New Roman', Times, serif; color: #111; background: #fff; line-height: 1.5; }
      @page { size: A4; margin: 15mm; }
      .cv-paper { background: #fff; font-family: 'Times New Roman', Times, serif; color: #111; line-height: 1.5; padding:20px; }
      .ats-header { text-align: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid #111; }
      .ats-name { font-size: 1.75rem; font-weight: 700; color: #111; margin: 0 0 4px; letter-spacing: 0.02em; text-transform: uppercase; }
      .ats-title { font-size: 0.95rem; color: #333; margin: 0 0 2px; font-style: italic; }
      .ats-subtitle { font-size: 0.88rem; color: #475569; font-weight: 500; margin: 0 0 10px; }
      .ats-contacts { display: flex; flex-wrap: wrap; justify-content: center; gap: 0; font-size: 0.82rem; color: #333; margin-top: 6px; }
      .ats-contacts span { display: inline; }
      .ats-contacts span + span::before { content: ' | '; color: #888; }
      .ats-section { margin-bottom: 18px; }
      .ats-section-title { font-size: 0.82rem; font-weight: 700; color: #111; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1.5px solid #111; padding-bottom: 3px; margin-bottom: 10px; font-family: 'Arial', sans-serif; }
      .ats-objective { font-size: 0.88rem; color: #222; margin: 0; line-height: 1.6; text-align: justify; }
      .ats-entry { margin-bottom: 12px; }
      .ats-entry-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .ats-entry-left { display: flex; flex-direction: column; }
      .ats-entry-right { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
      .ats-entry-main { font-size: 0.92rem; font-weight: 700; color: #111; }
      .ats-entry-org { font-size: 0.84rem; color: #444; font-style: italic; }
      .ats-entry-date { font-size: 0.80rem; color: #555; white-space: nowrap; }
      .ats-entry-detail{ font-size: 0.78rem; color: #666; }
      .ats-entry-desc  { font-size: 0.84rem; color: #333; margin: 5px 0 0; line-height: 1.55; text-align: justify; }
      .ats-skills-wrap { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; }
      .ats-skill-item { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.84rem; padding: 2px 0; border-bottom: 1px dotted #ccc; }
      .ats-skill-name  { color: #111; font-weight: 600; }
      .ats-skill-level { color: #555; font-style: italic; font-size: 0.78rem; }
      .ats-section p, .ats-entry p { font-size: 0.84rem; color: #333; margin: 3px 0 0; line-height: 1.55; }
      strong { font-weight: 700; }
      `;

      const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const pickFromObject = (obj: Record<string, unknown> | null | undefined, keys: string[]): string | null => {
        if (!obj || typeof obj !== 'object') return null;
        for (const key of keys) {
          // direct property
          if (key in obj) {
            const v = obj[key as keyof typeof obj];
            if (typeof v === 'string' && v.trim()) return v.trim();
            if (typeof v === 'number' && Number.isFinite(v)) return String(v);
          }
          // case-insensitive / normalized match
          const nk = normalize(key);
          for (const k of Object.keys(obj)) {
            if (normalize(k) === nk) {
              const v = obj[k as keyof typeof obj];
              if (typeof v === 'string' && v.trim()) return v.trim();
              if (typeof v === 'number' && Number.isFinite(v)) return String(v);
            }
            // allow substring matches (label vs key differences)
            if (normalize(k).includes(nk) || nk.includes(normalize(k))) {
              const v = obj[k as keyof typeof obj];
              if (typeof v === 'string' && v.trim()) return v.trim();
              if (typeof v === 'number' && Number.isFinite(v)) return String(v);
            }
          }
        }
        return null;
      };

      const profileLookup = (labels: string | string[]): string => {
        const arr = Array.isArray(labels) ? labels : [labels];
        try {
          if (!this.profileData) return '';
          for (const label of arr) {
            const nk = normalize(label);
            for (const g of this.profileData.infoGroups || []) {
              for (const it of g.items || []) {
                const nl = normalize(it.label);
                const val = it.value || '';
                if (!val) continue;
                if (nl === nk || nl.includes(nk) || nk.includes(nl)) return String(val);
              }
            }
            for (const it of this.profileData.summaryItems || []) {
              const nl = normalize(it.label);
              const val = it.value || '';
              if (!val) continue;
              if (nl === nk || nl.includes(nk) || nk.includes(nl)) return String(val);
            }
          }
        } catch {
          // ignore
        }
        return '';
      };

      const pickFromCvOrProfile = (infoKeys: string[], profileLabels?: string[]) => {
        const fromCv = pickFromObject(cv.info, infoKeys);
        if (fromCv) return fromCv;
        if (profileLabels) {
          const fromProfile = profileLookup(profileLabels);
          if (fromProfile) return fromProfile;
        }
        return '';
      };

      const makeContact = (info: any) => {
        const parts: string[] = [];
        const email = pickFromCvOrProfile(['email', 'email_institutionnel', 'email_address', 'mail'], ['email', 'email_institutionnel', 'mail']);
        const tel = pickFromCvOrProfile(['telephone', 'telephone_mobile', 'telephone_fixe', 'phone', 'phone_number', 'mobile'], ['telephone', 'phone', 'mobile', 'tel']);
        const ville = pickFromCvOrProfile(['ville', 'city', 'ville_residence', 'ville_residence_etudiant', 'ville_etablissement'], ['ville', 'city']);
        const codePostal = pickFromCvOrProfile(['code_postal', 'postal_code', 'zip', 'codepostal'], ['code postal', 'postal code', 'zip']);
        const linkedin = pickFromCvOrProfile(['linkedin', 'linkedin_url', 'linkedinUrl', 'linkedin_profile'], ['linkedin']);
        const permis = pickFromCvOrProfile(['permis', 'permis_de_conduire', 'driving_license'], ['permis', 'driving license']);

        if (email) parts.push(`<span><i class="fa-regular fa-envelope"></i> ${email}</span>`);
        if (tel) parts.push(`<span><i class="fa-solid fa-phone"></i> ${tel}</span>`);
        if (ville) parts.push(`<span><i class="fa-solid fa-location-dot"></i> ${ville}${codePostal ? ' ' + codePostal : ''}</span>`);
        if (linkedin) parts.push(`<span><i class="fa-brands fa-linkedin"></i> ${linkedin}</span>`);
        if (permis && permis !== 'Aucun') parts.push(`<span><i class="fa-solid fa-car"></i> Permis ${permis}</span>`);
        return parts.join('');
      };

      const nameFirst = pickFromObject(cv.info, ['prenom', 'firstName', 'prenom_etudiant', 'given_name', 'givenname']);
      const nameLast = pickFromObject(cv.info, ['nom', 'lastName', 'nom_etudiant', 'family_name', 'surname']);
      const fullFromCv = pickFromObject(cv.info, ['nom_complet', 'fullName', 'displayName', 'name', 'nom_prenom']);
      const headerName = this.profileData?.displayName || (nameFirst || nameLast ? [nameFirst, nameLast].filter(Boolean).join(' ') : (fullFromCv || 'Votre nom complet'));

      // Build only the printable body (not a full HTML document) and append it
      const bodyHtml = `
        <div id="cv-paper" class="cv-paper">
          <div class="ats-header">
            <h1 class="ats-name">${headerName || 'Votre nom complet'}</h1>
            ${cv.professionalTitle ? `<p class="ats-title">${cv.professionalTitle}</p>` : ''}
            ${cv.specialization ? `<p class="ats-subtitle">${cv.specialization}</p>` : ''}
            <div class="ats-contacts">${makeContact(cv.info || {})}</div>
          </div>

          ${cv.objectif ? `<div class="ats-section"><div class="ats-section-title">OBJECTIF PROFESSIONNEL</div><p class="ats-objective">${cv.objectif}</p></div>` : ''}

          ${Array.isArray(cv.experiences) && cv.experiences.length ? `<div class="ats-section"><div class="ats-section-title">STAGES</div>${cv.experiences.map((e:any)=>`<div class="ats-entry"><div class="ats-entry-row"><div class="ats-entry-left"><span class="ats-entry-main">${e.poste || e.titre || ''}</span><span class="ats-entry-org">${e.entreprise || e.organisation || ''}${e.secteur ? ' — ' + e.secteur : ''}</span>${e.lieu?'<span class="ats-entry-detail">'+e.lieu+'</span>':''}</div><div class="ats-entry-right">${(e.dateDebut||e.dateFin) ? '<span class="ats-entry-date">'+(e.dateDebut||'')+(e.dateFin? ' — ' + e.dateFin : ' — En cours')+'</span>':''}</div></div>${e.description?'<p class="ats-entry-desc">'+e.description+'</p>':''}${e.motsCles?'<p class="ats-entry-desc"><strong>Mots-clés :</strong> '+e.motsCles+'</p>':''}</div>`).join('')}</div>` : ''}

          ${Array.isArray(cv.formations) && cv.formations.length ? `<div class="ats-section"><div class="ats-section-title">DIPLÔMES</div>${cv.formations.map((f:any)=>`<div class="ats-entry"><div class="ats-entry-row"><div class="ats-entry-left"><span class="ats-entry-main">${f.diplome||''}</span><span class="ats-entry-org">${f.institution||''}</span>${f.moyenne?'<span class="ats-entry-detail">Mention : '+f.moyenne+'</span>':''}</div><div class="ats-entry-right">${(f.dateDebut||f.dateFin)?'<span class="ats-entry-date">'+(f.dateDebut||'')+(f.dateFin? ' — ' + f.dateFin : ' — En cours')+'</span>':''}</div></div>${f.modules?'<p class="ats-entry-desc"><strong>Modules clés :</strong> '+f.modules+'</p>':''}${f.pfeTitre?'<p class="ats-entry-desc"><strong>PFE :</strong> '+f.pfeTitre+(f.pfeEntreprise? ' ('+f.pfeEntreprise+')':'')+'</p>':''}</div>`).join('')}</div>` : ''}

          ${Array.isArray(cv.projets) && cv.projets.length ? `<div class="ats-section"><div class="ats-section-title">PROJETS ACADÉMIQUES & PERSONNELS</div>${cv.projets.map((p:any)=>`<div class="ats-entry"><div class="ats-entry-row"><div class="ats-entry-left"><span class="ats-entry-main">${p.titre||''}</span>${p.technologies?'<span class="ats-entry-org">'+p.technologies+'</span>':''}</div><div class="ats-entry-right">${p.lien?'<span class="ats-entry-date">'+p.lien+'</span>':''}</div></div>${p.description?'<p class="ats-entry-desc">'+p.description+'</p>':''}</div>`).join('')}</div>` : ''}

          ${((cv.hardSkills && cv.hardSkills.length) || (cv.softSkills && cv.softSkills.length)) ? `<div class="ats-section"><div class="ats-section-title">COMPÉTENCES</div><div class="ats-skills-wrap">${(cv.hardSkills||[]).map((h:any)=>`<div class="ats-skill-item"><span class="ats-skill-name">${h.nom||''}</span><span class="ats-skill-level">${h.type||''} · ${h.niveau||''}</span></div>`).join('')}${(cv.softSkills||[]).map((s:any)=>`<div class="ats-skill-item"><span class="ats-skill-name">${s.nom||''}</span><span class="ats-skill-level">${s.niveau||''}</span></div>`).join('')}</div></div>` : ''}

          ${Array.isArray(cv.langues) && cv.langues.length ? `<div class="ats-section"><div class="ats-section-title">LANGUES</div><div class="ats-skills-wrap">${cv.langues.map((l:any)=>`<div class="ats-skill-item"><span class="ats-skill-name">${l.langue||''}</span><span class="ats-skill-level">${l.niveau||''}${l.certification? ' · '+l.certification:''}${l.score? ' '+l.score:''}</span></div>`).join('')}</div></div>` : ''}

          ${Array.isArray(cv.certifications) && cv.certifications.length ? `<div class="ats-section"><div class="ats-section-title">CERTIFICATIONS</div>${cv.certifications.map((c:any)=>`<div class="ats-entry"><div class="ats-entry-row"><div class="ats-entry-left"><span class="ats-entry-main">${c.titre||''}</span>${c.organisme?'<span class="ats-entry-org">'+c.organisme+'</span>':''}</div><div class="ats-entry-right">${c.date?'<span class="ats-entry-date">'+c.date+'</span>':''}</div></div></div>`).join('')}</div>` : ''}

          ${Array.isArray(cv.engagements) && cv.engagements.length ? `<div class="ats-section"><div class="ats-section-title">ACTIVITÉS PARA-UNIVERSITAIRES</div>${cv.engagements.map((e:any)=>`<div class="ats-entry"><div class="ats-entry-row"><div class="ats-entry-left"><span class="ats-entry-main">${e.role||''}</span><span class="ats-entry-org">${e.type||''}</span></div><div class="ats-entry-right">${(e.dateDebut||e.dateFin)?'<span class="ats-entry-date">'+(e.dateDebut||'')+(e.dateFin? ' — ' + e.dateFin : '')+'</span>':''}</div></div></div>`).join('')}</div>` : ''}

        </div>
      `;

      // Add a visible (to the renderer) debug block with the raw CV JSON to help
      // diagnose empty-PDF render problems. We escape HTML to avoid breaking markup.
      const debugHtml = `<div id="cv-debug" style="margin-top:12px;padding:8px;background:#ffffff;border:1px dashed #ddd;font-family:monospace;font-size:10px;white-space:pre-wrap;color:#000;">${this.escapeHtml(JSON.stringify(cv, null, 2))}</div>`;

      const container = document.createElement('div');
      // Place the element off-screen but still renderable by the browser.
      // Use opacity:0 (instead of visibility:hidden) so html2canvas can render its contents.
      container.style.position = 'absolute';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = '210mm';
      container.style.background = '#fff';
      // Create a fullscreen overlay so we can place the printable container
      // centered and visible to the renderer, while keeping it visually hidden
      // from the user behind the overlay.
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.background = 'rgba(255,255,255,0.0)';
      overlay.style.zIndex = '2147483646';
      overlay.style.pointerEvents = 'none';

      container.style.position = 'absolute';
      container.style.left = '50%';
      container.style.top = '50%';
      container.style.transform = 'translate(-50%, -50%)';
      container.style.opacity = '1';
      container.style.zIndex = '2147483647';
      container.style.pointerEvents = 'none';
      container.style.background = '#fff';
      // Do NOT include debugHtml inside the printable container — keep debug data
      // available in console only so it is not embedded into generated PDFs.
      container.innerHTML = `<style>${cvStyles}</style>` + bodyHtml;
      console.debug('[Profil] CV debug (not included in PDF):', debugHtml);

      overlay.appendChild(container);
      document.body.appendChild(overlay);

      // Give the browser a slightly longer moment to layout fonts/images before rendering
      await new Promise((r) => setTimeout(r, 600));

      // Collect diagnostics about the container so we can see what html2canvas will attempt to render.
      try {
        const rect = container.getBoundingClientRect();
        const innerLen = container.innerHTML.length;
        const imgCount = container.querySelectorAll('img').length;
        console.debug('[Profil] PDF container rect', rect, 'innerHTML length', innerLen, 'imgCount', imgCount);
        this.debugCvInfo = `PDF Debug:\nrect=${JSON.stringify({ width: rect.width, height: rect.height, top: rect.top, left: rect.left })}\ninnerLen=${innerLen}\nimgCount=${imgCount}\nkeys=${Object.keys(cv||{}).join(',')}`;
      } catch (e) {
        console.warn('[Profil] Could not collect container diagnostics', e);
      }

      await this.loadHtml2CanvasAndJsPdfScript();
      const html2canvas = (window as any).html2canvas;
      const jspdfLib = (window as any).jspdf || (window as any).jsPDF || (window as any).jspdf?.jsPDF;
      if (!html2canvas || !jspdfLib) throw new Error('html2canvas/jsPDF not available');

      try {
        const canvas: HTMLCanvasElement = await html2canvas(container, { scale: 2, useCORS: true, allowTaint: false });
        const imgData = canvas.toDataURL('image/jpeg', 1.0);
        const cW = canvas.width;
        const cH = canvas.height;
        const pdfWidthMm = 210;
        const pageHeightMm = 297;
        const pdfImageHeightMm = (cH * pdfWidthMm) / cW;
        const pages = Math.max(1, Math.ceil(pdfImageHeightMm / pageHeightMm));

        const jsPDFConstructor = (jspdfLib && jspdfLib.jsPDF) ? jspdfLib.jsPDF : jspdfLib;
        const pdf: any = new (jsPDFConstructor as any)('p', 'mm', 'a4');

        if (pages === 1) {
          pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, pdfImageHeightMm);
        } else {
          const pageHeightPx = Math.floor((pageHeightMm * cW) / pdfWidthMm);
          let yOffset = 0;
          for (let p = 0; p < pages; p++) {
            const sliceHeightPx = Math.min(pageHeightPx, cH - yOffset);
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = cW;
            sliceCanvas.height = sliceHeightPx;
            const ctx = sliceCanvas.getContext('2d');
            if (ctx) ctx.drawImage(canvas, 0, yOffset, cW, sliceHeightPx, 0, 0, cW, sliceHeightPx);
            const sliceData = sliceCanvas.toDataURL('image/jpeg', 1.0);
            const sliceHeightMm = (sliceHeightPx * pdfWidthMm) / cW;
            pdf.addImage(sliceData, 'JPEG', 0, 0, pdfWidthMm, sliceHeightMm);
            if (p < pages - 1) pdf.addPage();
            yOffset += sliceHeightPx;
          }
        }

        const dataUriString = pdf.output('datauristring');
        const base64 = dataUriString.split(',')[1];

        if (base64 && base64.length > 1500) {
          localStorage.setItem('mySavedCvPdf', base64);
          localStorage.setItem('mySavedCvTimestamp', new Date().toISOString());
          this.loadSavedPdf();
          const a = document.createElement('a');
          a.href = 'data:application/pdf;base64,' + base64;
          a.download = 'mon_cv.pdf';
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          console.warn('[Profil] html2canvas/jsPDF produced empty or too-small PDF (len=' + (base64 ? base64.length : 0) + '). Attempting fallbacks.');
          this.debugCvInfo = (this.debugCvInfo || '') + '\nWarning: html2canvas/jsPDF produced empty PDF.';

          // Fallback: render a simple test div via html2canvas+jsPDF
          try {
            const testDiv = document.createElement('div');
            testDiv.style.position = 'absolute';
            testDiv.style.left = '0';
            testDiv.style.top = '0';
            testDiv.style.width = '210mm';
            testDiv.style.background = '#fff';
            testDiv.style.zIndex = '10000';
            testDiv.style.padding = '20px';
            testDiv.innerHTML = `<div style="font-family: Arial, sans-serif; font-size: 18px; color:#111;">TEST PDF — If you see this in the downloaded PDF, html2canvas+jsPDF works and the issue is with the CV HTML</div>`;
            document.body.appendChild(testDiv);
            await new Promise((r) => setTimeout(r, 300));
            const testCanvas: HTMLCanvasElement = await html2canvas(testDiv, { scale: 2, useCORS: true });
            const testData = testCanvas.toDataURL('image/jpeg', 1.0);
            const testPdf: any = new (jsPDFConstructor as any)('p', 'mm', 'a4');
            const testImgHeightMm = (testCanvas.height * pdfWidthMm) / testCanvas.width;
            testPdf.addImage(testData, 'JPEG', 0, 0, pdfWidthMm, testImgHeightMm);
            const testBase64 = testPdf.output('datauristring').split(',')[1];
            localStorage.setItem('mySavedCvPdfTest', testBase64);
            localStorage.setItem('mySavedCvTimestampTest', new Date().toISOString());
            try { document.body.removeChild(testDiv); } catch {}
            console.info('[Profil] Fallback test PDF saved to localStorage.mySavedCvPdfTest');

            if (testBase64 && testBase64.length > 1500) {
              const a2 = document.createElement('a');
              a2.href = 'data:application/pdf;base64,' + testBase64;
              a2.download = 'mon_cv_test.pdf';
              document.body.appendChild(a2);
              a2.click();
              a2.remove();
              // done
            } else {
              // Try iframe fallback: write full HTML document into an iframe and attempt html2canvas on its body
              try {
                const iframe = document.createElement('iframe');
                iframe.style.position = 'fixed';
                iframe.style.left = '50%';
                iframe.style.top = '50%';
                iframe.style.width = '210mm';
                iframe.style.height = '297mm';
                iframe.style.transform = 'translate(-50%, -50%)';
                iframe.style.opacity = '0';
                iframe.style.pointerEvents = 'none';
                iframe.style.zIndex = '2147483647';
                document.body.appendChild(iframe);
                const doc = (iframe.contentDocument || (iframe as any).contentWindow?.document) as Document | null;
                if (doc) {
                  doc.open();
                  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${cvStyles}</style></head><body>${bodyHtml}</body></html>`);
                  doc.close();
                  await new Promise((r) => setTimeout(r, 600));
                  const iframeCanvas: HTMLCanvasElement = await html2canvas(doc.body, { scale: 2, useCORS: true });
                  const iframeData = iframeCanvas.toDataURL('image/jpeg', 1.0);
                  const iframePdf: any = new (jsPDFConstructor as any)('p', 'mm', 'a4');
                  const iframeImgHeightMm = (iframeCanvas.height * pdfWidthMm) / iframeCanvas.width;
                  iframePdf.addImage(iframeData, 'JPEG', 0, 0, pdfWidthMm, iframeImgHeightMm);
                  const iframeBase64 = iframePdf.output('datauristring').split(',')[1];
                  if (iframeBase64 && iframeBase64.length > 1500) {
                    localStorage.setItem('mySavedCvPdfIframe', iframeBase64);
                    localStorage.setItem('mySavedCvTimestampIframe', new Date().toISOString());
                    const a3 = document.createElement('a');
                    a3.href = 'data:application/pdf;base64,' + iframeBase64;
                    a3.download = 'mon_cv_iframe.pdf';
                    document.body.appendChild(a3);
                    a3.click();
                    a3.remove();
                    console.info('[Profil] Iframe PDF generated and saved to localStorage.mySavedCvPdfIframe');
                  } else {
                    console.warn('[Profil] Iframe PDF also empty or too small (len=' + (iframeBase64 ? iframeBase64.length : 0) + ')');
                    this.debugCvInfo = (this.debugCvInfo || '') + '\nIframe PDF empty or too small.';
                  }
                } else {
                  console.warn('[Profil] Could not access iframe document for fallback.');
                  this.debugCvInfo = (this.debugCvInfo || '') + '\nIframe document unavailable';
                }
                try { document.body.removeChild(iframe); } catch {}
              } catch (iframeErr: any) {
                console.error('[Profil] iframe fallback failed', iframeErr);
                this.debugCvInfo = (this.debugCvInfo || '') + '\nIframe fallback error: ' + (iframeErr && iframeErr.message ? iframeErr.message : String(iframeErr));
              }
            }
          } catch (fallbackErr: any) {
            console.error('[Profil] Fallback html2canvas/jsPDF failed', fallbackErr);
            this.debugCvInfo = (this.debugCvInfo || '') + '\nFallback error: ' + (fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr));
          }
        }
      } catch (err: any) {
        console.error('html2canvas/jsPDF render error', err);
        this.debugCvInfo = (this.debugCvInfo || '') + '\nhtml2canvas/jsPDF error: ' + (err && err.message ? err.message : String(err));
      } finally {
        setTimeout(() => {
          try { document.body.removeChild(overlay); } catch {}
        }, 500);
      }
    } catch (err: any) {
      console.error('generatePdfFromDb failed', err);
    }
  }

  private escapeHtml(input: string | null): string {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private loadHtml2CanvasAndJsPdfScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      const hasHtml2Canvas = !!(window as any).html2canvas;
      const hasJsPdf = !!((window as any).jspdf || (window as any).jsPDF || (window as any).jspdf?.jsPDF);
      if (hasHtml2Canvas && hasJsPdf) return resolve();

      let toLoad = 0;
      if (!hasHtml2Canvas) toLoad++;
      if (!hasJsPdf) toLoad++;
      if (toLoad === 0) return resolve();

      let done = 0;
      const onLoadOnce = () => {
        done++;
        if (done >= toLoad) resolve();
      };
      const onError = (e: any) => reject(e);

      if (!hasHtml2Canvas) {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = onLoadOnce;
        s.onerror = onError;
        document.head.appendChild(s);
      }

      if (!hasJsPdf) {
        const s2 = document.createElement('script');
        s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s2.onload = onLoadOnce;
        s2.onerror = onError;
        document.head.appendChild(s2);
      }
    });
  }

  public onProfileImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];

    this.profileImageError.set(null);

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.profileImageError.set('Veuillez selectionner une image valide.');
      input.value = '';
      return;
    }

    if (file.size > Profil.maxProfileImageSize) {
      this.profileImageError.set('L image doit etre inferieure a 5 Mo.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      this.profileImageUrl.set(typeof result === 'string' ? result : null);
      input.value = '';
    };
    reader.onerror = () => {
      this.profileImageError.set('Impossible de charger cette image.');
      input.value = '';
    };

    reader.readAsDataURL(file);
  }

}
