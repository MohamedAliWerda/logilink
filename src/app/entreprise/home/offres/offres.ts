import { Component, OnInit, OnDestroy, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { OffresService } from '../../services/offres.service';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';

export interface Offre {
  id: string;
  titre_poste?: string;
  titre?: string;
  societe?: string;
  entreprise?: string;
  lieu?: string;
  typeContrat?: string;
  source?: string;
  exigences?: string;
  description?: string;
  competences?: string[];
  candidaturesCount?: number;
  salaireMin?: number;
  salaireMax?: number;
  date_creation?: string;
  createdAt?: string;
  status?: string;
}

@Component({
  selector: 'app-offres',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './offres.html',
  styleUrls: ['./offres.css'],
  providers: [OffresService],
})
export class Offres implements OnInit, OnDestroy {
  offres: Offre[] = [];
  filteredOffres: Offre[] = [];
  totalCandidaturesCount = 0;
  searchQuery = '';
  isLoading = false;
  isSaving = false;

  showCreateModal = false;
  showEditModal = false;
  editingOffre: Offre | null = null;

  showDeleteConfirm = false;
  pendingDeleteOffre: Offre | null = null;

  offreForm: FormGroup;

  successMessage = '';
  errorMessage = '';

  private destroy$ = new Subject<void>();
  private loadWatchdog: number | null = null;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private offresService: OffresService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {
    this.offreForm = this.fb.group({
      titre_poste: ['', [Validators.required, Validators.minLength(3)]],
      societe: ['', [Validators.required, Validators.minLength(2)]],
      exigences: ['', [Validators.required, Validators.minLength(10)]],
    });
  }

  ngOnInit(): void {
    this.subscribeToService();
    this.loadCandidaturesCount();
    this.loadOffres();
  }

  ngOnDestroy(): void {
    this.clearLoadWatchdog();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private subscribeToService(): void {
    this.offresService.offres$
      .pipe(takeUntil(this.destroy$))
      .subscribe((offres) => {
        this.ngZone.run(() => {
          this.offres = offres.map(o => ({
            ...o,
            titre: o.titre_poste,
            description: o.exigences,
            entreprise: o.societe,
            createdAt: o.date_creation,
          }));
          this.filterOffres();
          this.cdr.detectChanges();
        });
      });

    this.offresService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => {
        this.ngZone.run(() => {
          this.isLoading = loading;
        });
      });

    this.offresService.successMessage$
      .pipe(takeUntil(this.destroy$))
      .subscribe((message) => {
        this.ngZone.run(() => {
          this.successMessage = message;
        });
      });

    this.offresService.errorMessage$
      .pipe(takeUntil(this.destroy$))
      .subscribe((message) => {
        this.ngZone.run(() => {
          this.errorMessage = message;
        });
      });
  }

  get totalCandidatures(): number {
    return this.totalCandidaturesCount;
  }

  private loadCandidaturesCount(): void {
    this.offresService.fetchCompanyCandidaturesCount()
      .pipe(takeUntil(this.destroy$))
      .subscribe((count) => {
        this.ngZone.run(() => {
          this.totalCandidaturesCount = Number.isFinite(count) ? count : 0;
          this.cdr.detectChanges();
        });
      });
  }

  loadOffres(): void {
    this.ngZone.run(() => {
      this.isLoading = true;
    });

    this.clearLoadWatchdog();
    this.loadWatchdog = window.setTimeout(() => {
      this.ngZone.run(() => {
        this.isLoading = false;
        if (!this.errorMessage) {
          this.errorMessage = 'Le chargement des offres prend trop de temps. Veuillez reessayer.';
        }
      });
    }, 12000);

    this.offresService.fetchCompanyOffres()
      .pipe(finalize(() => {
        this.clearLoadWatchdog();
        this.ngZone.run(() => {
          this.isLoading = false;
        });
      }))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (offres) => {
          this.ngZone.run(() => {
            this.offres = (offres || []).map(o => ({
              ...o,
              titre: o.titre_poste,
              description: o.exigences,
              entreprise: o.societe,
              createdAt: o.date_creation,
            }));
            this.offresService.setOffres(this.offres as any);
            this.filterOffres();
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.clearLoadWatchdog();
          this.ngZone.run(() => {
            this.offres = [];
            this.filteredOffres = [];
            this.cdr.detectChanges();
          });
        },
      });
  }

  private clearLoadWatchdog(): void {
    if (this.loadWatchdog !== null) {
      window.clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }

  filterOffres(): void {
    if (!this.searchQuery.trim()) {
      this.filteredOffres = [...this.offres];
    } else {
      const query = this.searchQuery.toLowerCase();
      this.filteredOffres = this.offres.filter(offre =>
        (offre.titre || '').toLowerCase().includes(query) ||
        (offre.entreprise || '').toLowerCase().includes(query) ||
        (offre.description || '').toLowerCase().includes(query)
      );
    }
  }

  openCreateModal(): void {
    this.showCreateModal = true;
    this.offreForm.reset();
    this.successMessage = '';
    this.errorMessage = '';

    try {
      const raw = localStorage.getItem('entreprise');
      if (raw) {
        const societe = JSON.parse(raw) as Record<string, unknown>;
        const name = (societe['denomination_sociale'] ?? societe['nom'] ?? '') as string;
        if (name) {
          this.offreForm.patchValue({ societe: name });
          this.offreForm.get('societe')?.disable();
        }
      }
    } catch { /* keep empty */ }
  }

  openEditModal(offre: Offre): void {
    this.showEditModal = true;
    this.editingOffre = offre;
    this.offreForm.patchValue({
      titre_poste: offre.titre_poste || offre.titre,
      societe: offre.societe || offre.entreprise,
      exigences: offre.exigences || offre.description,
    });
  }

  closeModals(): void {
    this.showCreateModal = false;
    this.showEditModal = false;
    this.editingOffre = null;
    this.offreForm.get('societe')?.enable();
    this.offreForm.reset();
  }

  submitOffre(): void {
    if (this.offreForm.valid || (this.offreForm.get('societe')?.disabled && this.offreForm.get('titre_poste')?.valid && this.offreForm.get('exigences')?.valid)) {
      this.isSaving = true;
      const raw = this.offreForm.getRawValue();
      const formData = {
        titre_poste: raw.titre_poste,
        societe: raw.societe,
        exigences: raw.exigences,
      };

      this.offresService.createOffre(formData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.isSaving = false;
            this.closeModals();
          },
          error: () => {
            this.isSaving = false;
            // Error message is handled by service
          },
        });
    }
  }

  submitEditOffre(): void {
    if (this.offreForm.valid && this.editingOffre) {
      // Edit functionality can be added later if needed
      console.log('Edit functionality not yet implemented');
    }
  }

  deleteOffre(offre: Offre): void {
    this.pendingDeleteOffre = offre;
    this.showDeleteConfirm = true;
  }

  confirmDelete(): void {
    if (!this.pendingDeleteOffre) return;
    const offre = this.pendingDeleteOffre;
    this.showDeleteConfirm = false;
    this.pendingDeleteOffre = null;
    this.offresService.deleteOffre(offre.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {},
        error: () => {},
      });
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.pendingDeleteOffre = null;
  }

  viewCandidatures(offre: Offre): void {
    this.router.navigate(['/entreprise/candidatures', offre.id]);
  }

  isFeedbackAvailable(offre: Offre): boolean {
    const raw = offre.date_creation ?? offre.createdAt;
    if (!raw) return false;
    const created = new Date(raw);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return created <= sixMonthsAgo;
  }

  openFeedback(offre: Offre): void {
    this.router.navigate(['/entreprise/feedback'], { queryParams: { postId: offre.id } });
  }

  getTimeAgo(date: string | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diff === 0) return "Aujourd'hui";
    if (diff === 1) return 'Il y a 1 jour';
    if (diff < 7) return `Il y a ${diff} jours`;
    if (diff < 14) return 'Il y a 1 semaine';
    return `Il y a ${Math.floor(diff / 7)} semaines`;
  }
}