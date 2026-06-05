import { Component, OnInit, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../services/supabase.service';

export interface Entreprise {
  nomEntreprise: string;
  email: string;
  telephone: string;
  adresse: string;
  description?: string;
}

@Component({
  selector: 'app-fiche-signaletique',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './fiche-signalétique.html',
  styleUrls: ['./fiche-signalétique.css']
})
export class FicheSignaletique implements OnInit {
  profil: Entreprise | null = null;
  societeId: number | null = null;
  isLoading = false;
  isSaving = false;
  isEditing = false;
  successMessage = '';
  errorMessage = '';

  profilForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private readonly supabaseService: SupabaseService,
    private readonly ngZone: NgZone,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.profilForm = this.fb.group({
      nomEntreprise: ['', [Validators.required, Validators.maxLength(200)]],
      email: ['', [Validators.required, Validators.email]],
      telephone: ['', Validators.required],
      adresse: ['', Validators.required],
      description: ['']
    });
  }

  ngOnInit() {
    this.loadProfil();
  }

  loadProfil() {
    this.ngZone.run(() => {
      this.isLoading = true;
    });

    try {
      this.ngZone.run(() => {
        this.errorMessage = '';
      });
      const entrepriseRaw = localStorage.getItem('entreprise');
      const entreprise = entrepriseRaw ? JSON.parse(entrepriseRaw) : null;
      const id = Number(entreprise?.id ?? 0);

      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Compte entreprise introuvable. Veuillez vous reconnecter.');
      }

      this.societeId = id;

      this.ngZone.run(() => {
        this.applySocieteToForm(entreprise);
      });

      // Refresh from DB in background without blocking the page render.
      this.refreshSocieteData(id);
    } catch (error: any) {
      this.ngZone.run(() => {
        this.errorMessage = error?.message || 'Impossible de charger les informations entreprise.';
      });
    } finally {
      this.ngZone.run(() => {
        this.isLoading = false;
      });
    }
  }

  private async refreshSocieteData(id: number): Promise<void> {
    try {
      const societe = await this.withTimeout(
        this.supabaseService.fetchSocieteById(id),
        10000,
        'Le chargement du profil a depasse le delai. Veuillez reessayer.',
      );

      if (!societe) {
        return;
      }

      this.ngZone.run(() => {
        this.applySocieteToForm(societe);
      });

      const entrepriseRaw = localStorage.getItem('entreprise');
      const entreprise = entrepriseRaw ? JSON.parse(entrepriseRaw) : {};
      localStorage.setItem('entreprise', JSON.stringify({ ...entreprise, ...societe }));
    } catch {
      // Keep localStorage profile already shown; avoid blocking UX on refresh failure.
    }
  }

  private applySocieteToForm(societe: any): void {
    this.profil = {
      nomEntreprise: String(societe?.denomination_sociale ?? societe?.nomEntreprise ?? '').trim(),
      email: String(societe?.email ?? '').trim(),
      telephone: String(societe?.telephone ?? '').trim(),
      adresse: String(societe?.adresse ?? '').trim(),
      description: String(societe?.secteur_activite ?? societe?.description ?? '').trim(),
    };

    this.profilForm.patchValue({
      nomEntreprise: this.profil.nomEntreprise,
      email: this.profil.email,
      telephone: this.profil.telephone,
      adresse: this.profil.adresse,
      description: this.profil.description || ''
    });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  enableEdit() {
    this.isEditing = true;
    this.successMessage = '';
    this.errorMessage = '';
  }

  cancelEdit() {
    this.isEditing = false;
    if (this.profil) {
      this.profilForm.patchValue({
        nomEntreprise: this.profil.nomEntreprise,
        email: this.profil.email,
        telephone: this.profil.telephone,
        adresse: this.profil.adresse,
        description: this.profil.description || ''
      });
    }
  }

  async saveProfil() {
    if (this.profilForm.invalid) return;
    this.isSaving = true;
    this.successMessage = '';
    this.errorMessage = '';
    this.cdr.detectChanges();

    try {
      const payload = {
        nomEntreprise: String(this.profilForm.value.nomEntreprise ?? '').trim(),
        email: String(this.profilForm.value.email ?? '').trim(),
        telephone: String(this.profilForm.value.telephone ?? '').trim(),
        adresse: String(this.profilForm.value.adresse ?? '').trim(),
        description: String(this.profilForm.value.description ?? '').trim(),
      };

      if (!this.societeId) {
        throw new Error('Compte entreprise introuvable. Veuillez vous reconnecter.');
      }

      // Send update — backend has an 8s Supabase timeout so this always resolves.
      // The HTTP pipe also has a 15s rxjs timeout as a safety net.
      await this.supabaseService.updateSocieteProfile(this.societeId, payload);

      // Confirm by re-fetching the saved row directly from the backend.
      const confirmed = await this.withTimeout(
        this.supabaseService.fetchSocieteById(this.societeId),
        10000,
        'Modification enregistrée. Impossible de confirmer, veuillez rafraîchir la page.',
      ) as any;

      this.applySocieteToForm(confirmed ?? payload);

      const entrepriseRaw = localStorage.getItem('entreprise');
      const entreprise = entrepriseRaw ? JSON.parse(entrepriseRaw) : {};
      localStorage.setItem('entreprise', JSON.stringify({ ...entreprise, ...(confirmed ?? {}) }));

      this.isEditing = false;
      this.successMessage = 'Profil mis à jour avec succès !';
      this.cdr.detectChanges();

      setTimeout(() => {
        this.successMessage = '';
        this.cdr.detectChanges();
      }, 3000);
    } catch (error: any) {
      this.errorMessage = error?.message || 'Impossible de mettre à jour le profil.';
      this.cdr.detectChanges();
    } finally {
      this.isSaving = false;
      this.cdr.detectChanges();
    }
  }

  getInitials(): string {
    if (!this.profil?.nomEntreprise) return '?';
    return this.profil.nomEntreprise
      .split(' ')
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  goToFiche() {
    this.router.navigate(['/entreprise/fiche-signaletique']);
  }
}
