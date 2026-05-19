import { Component, OnDestroy, OnInit, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { OffresEmpService, StudentOffre } from './offres-emp.service';

interface Job {
  id: string;
  societeId?: number;
  title: string;
  type: string;
  selected: boolean;
  company: string;
  location: string;
  source: string;
  salaryMin: string;
  salaryMax: string;
  description: string;
  skills: string[];
  createdAt?: string;
}

interface CompanyJobs {
  company: string;
  location: string;
  jobs: Job[];
}

@Component({
  selector: 'app-offres-emp',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './offres-emp.html',
  styleUrls: ['./offres-emp.css']
})
export class OffresEmpComponent implements OnInit, OnDestroy {
  searchQuery = '';
  isLoading = false;
  isPostuling = false;
  errorMessage = '';
  submitMessage = '';
  submitMessageType: 'success' | 'error' = 'success';
  jobs: Job[] = [];
  selectedJob: Job | null = null;
  appliedJobIds: Set<string> = new Set();
  private readonly offresEmpService = inject(OffresEmpService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  private destroy$ = new Subject<void>();
  private submitMessageTimer: number | null = null;
  private loadWatchdog: number | null = null;

  ngOnInit(): void {
    this.loadOffres();
  }

  ngOnDestroy(): void {
    this.clearLoadWatchdog();
    this.clearSubmitMessageTimer();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadOffres(): void {
    this.ngZone.run(() => {
      this.isLoading = true;
      this.errorMessage = '';
    });

    this.clearLoadWatchdog();
    this.loadWatchdog = window.setTimeout(() => {
      this.ngZone.run(() => {
        this.isLoading = false;
        if (!this.errorMessage) {
          this.errorMessage = 'Le chargement des offres prend trop de temps. Veuillez reessayer.';
        }
        this.cdr.detectChanges();
      });
    }, 12000);

    this.offresEmpService
      .fetchActiveOffres()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (offres) => {
          this.clearLoadWatchdog();
          this.ngZone.run(() => {
            this.jobs = (offres || []).map((offre) => this.toJob(offre));
            // Apply localStorage cache immediately for fast paint, then override from server
            const persisted = this.loadPersistedSelections();
            this.appliedJobIds = this.loadAppliedIds();
            this.jobs.forEach((j) => {
              j.selected = persisted.has(String(j.id)) && !this.appliedJobIds.has(String(j.id));
            });
            this.isLoading = false;
            this.cdr.detectChanges();
            // Override with authoritative state from Supabase
            this.syncAppliedFromServer();
          });
        },
        error: (error) => {
          this.clearLoadWatchdog();
          this.ngZone.run(() => {
            this.jobs = [];
            this.errorMessage = error?.message || 'Impossible de charger les offres pour le moment.';
            this.isLoading = false;
            this.cdr.detectChanges();
          });
        },
      });
  }

  private syncAppliedFromServer(): void {
    const userRaw = localStorage.getItem('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const studentId = Number(user?.id);
    if (!Number.isInteger(studentId) || studentId <= 0) return;

    this.offresEmpService
      .fetchStudentAppliedIds(studentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((serverIds) => {
        this.ngZone.run(() => {
          const serverSet = new Set(serverIds.map(String));
          // Sync localStorage cache to match server
          this.appliedJobIds = serverSet;
          this.saveAppliedIds(serverSet);
          const persisted = this.loadPersistedSelections();
          this.jobs.forEach((j) => {
            if (serverSet.has(String(j.id))) {
              j.selected = false;
              persisted.delete(String(j.id));
            }
          });
          this.savePersistedSelections(persisted);
          this.cdr.detectChanges();
        });
      });
  }

  private toJob(offre: StudentOffre): Job {
    return {
      id: String(offre.id),
      societeId: Number(offre.societe_id || 0) || undefined,
      title: (offre.titre_poste || '').trim() || 'Poste sans titre',
      type: (offre.typeContrat || '').trim() || 'Offre',
      selected: false,
      company: (offre.societe || '').trim() || 'Entreprise',
      location: (offre.lieu || '').trim() || 'Tunisie',
      source: 'Entreprise',
      salaryMin: '',
      salaryMax: '',
      description: (offre.exigences || '').trim() || 'Aucune description fournie.',
      skills: Array.isArray(offre.competences) ? offre.competences : [],
      createdAt: offre.date_creation,
    };
  }

  get selectedJobs(): Job[] {
    return this.jobs.filter((j) => j.selected);
  }

  get filteredJobs(): Job[] {
    if (!this.searchQuery.trim()) return this.jobs;
    const q = this.searchQuery.toLowerCase();
    return this.jobs.filter((j) =>
      j.title.toLowerCase().includes(q) ||
      j.type.toLowerCase().includes(q) ||
      j.company.toLowerCase().includes(q) ||
      j.description.toLowerCase().includes(q)
    );
  }

  get groupedJobs(): CompanyJobs[] {
    const groups = new Map<string, CompanyJobs>();

    this.filteredJobs.forEach((job) => {
      const key = job.company.trim().toLowerCase() || 'entreprise';

      if (!groups.has(key)) {
        groups.set(key, {
          company: job.company,
          location: job.location,
          jobs: [],
        });
      }

      groups.get(key)!.jobs.push(job);
    });

    return Array.from(groups.values());
  }

  // Persistence helpers: store selected job ids per-user in localStorage
  private storageKey(): string {
    try {
      const userRaw = localStorage.getItem('user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      const uid = user?.id ? `user_${user.id}` : 'anon';
      return `logilink_selected_offres_${uid}`;
    } catch {
      return 'logilink_selected_offres_anon';
    }
  }

  private loadPersistedSelections(): Set<string> {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.map((v) => String(v)) : []);
    } catch {
      return new Set<string>();
    }
  }

  private savePersistedSelections(set: Set<string>): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(Array.from(set)));
    } catch {
      // ignore storage errors
    }
  }

  private appliedStorageKey(): string {
    try {
      const userRaw = localStorage.getItem('user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      const uid = user?.id ? `user_${user.id}` : 'anon';
      return `logilink_applied_offres_${uid}`;
    } catch {
      return 'logilink_applied_offres_anon';
    }
  }

  private loadAppliedIds(): Set<string> {
    try {
      const raw = localStorage.getItem(this.appliedStorageKey());
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.map((v) => String(v)) : []);
    } catch {
      return new Set<string>();
    }
  }

  private saveAppliedIds(set: Set<string>): void {
    try {
      localStorage.setItem(this.appliedStorageKey(), JSON.stringify(Array.from(set)));
    } catch {
      // ignore storage errors
    }
  }

  private extractPostId(jobId: string): number {
    // Extract numeric ID from potentially composite ID (e.g., "123_456" -> "123")
    const match = String(jobId).match(/^(\d+)/);
    return Number(match?.[1] ?? jobId);
  }

  toggleJob(job: Job): void {
    if (this.appliedJobIds.has(String(job.id))) return;
    const newState = !job.selected;
    // optimistic UI change
    job.selected = newState;
    const persisted = this.loadPersistedSelections();
    if (newState) persisted.add(String(job.id)); else persisted.delete(String(job.id));
    this.savePersistedSelections(persisted);

    // sync to server: save or remove selection
    const userRaw = localStorage.getItem('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const studentId = Number(user?.id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      // cannot sync, leave persisted locally
      return;
    }

    const postId = this.extractPostId(job.id);
    if (newState) {
      this.offresEmpService.saveSelection({ id_etudiant: studentId, id_post: postId, id_societe: job.societeId })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            // ok
          },
          error: (err) => {
            this.ngZone.run(() => {
              job.selected = false;
              const p = this.loadPersistedSelections();
              p.delete(String(job.id));
              this.savePersistedSelections(p);
              this.showSubmitMessage('error', err?.message || 'Impossible d enregister l offre');
              this.cdr.detectChanges();
            });
          }
        });
    } else {
      this.offresEmpService.removeSelection({ id_etudiant: studentId, id_post: postId, id_societe: job.societeId })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            // ok
          },
          error: (err) => {
            this.ngZone.run(() => {
              job.selected = true;
              const p = this.loadPersistedSelections();
              p.add(String(job.id));
              this.savePersistedSelections(p);
              this.showSubmitMessage('error', err?.message || 'Impossible de supprimer l enregistrement');
              this.cdr.detectChanges();
            });
          }
        });
    }
  }

  removeJob(job: Job, event?: Event): void {
    if (event) event.stopPropagation();
    if (!job.selected) return;
    // optimistic
    job.selected = false;
    const persisted = this.loadPersistedSelections();
    persisted.delete(String(job.id));
    this.savePersistedSelections(persisted);

    const userRaw = localStorage.getItem('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const studentId = Number(user?.id);
    if (!Number.isInteger(studentId) || studentId <= 0) return;

    const postId = this.extractPostId(job.id);
    this.offresEmpService.removeSelection({ id_etudiant: studentId, id_post: postId, id_societe: job.societeId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {},
        error: (err) => {
          job.selected = true;
          const p2 = this.loadPersistedSelections();
          p2.add(String(job.id));
          this.savePersistedSelections(p2);
          this.showSubmitMessage('error', err?.message || 'Erreur lors de la suppression');
        }
      });
  }

  unsubmit(job: Job, event: Event): void {
    event.stopPropagation();

    const userRaw = localStorage.getItem('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const studentId = Number(user?.id);
    if (!Number.isInteger(studentId) || studentId <= 0) return;

    const postId = this.extractPostId(job.id);

    // Optimistic: remove applied badge immediately
    const newApplied = new Set(this.appliedJobIds);
    newApplied.delete(String(job.id));
    this.appliedJobIds = newApplied;
    this.saveAppliedIds(newApplied);
    this.cdr.detectChanges();

    this.offresEmpService
      .removeSelection({ id_etudiant: studentId, id_post: postId, id_societe: job.societeId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.showSubmitMessage('success', 'Candidature retirée avec succès.');
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            // Revert on error
            const reverted = new Set(this.appliedJobIds);
            reverted.add(String(job.id));
            this.appliedJobIds = reverted;
            this.saveAppliedIds(reverted);
            this.showSubmitMessage('error', err?.message || 'Impossible de retirer la candidature.');
            this.cdr.detectChanges();
          });
        },
      });
  }

  postuler(): void {
    const selected = this.selectedJobs;
    if (selected.length === 0) {
      return;
    }

    const userRaw = localStorage.getItem('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const studentId = Number(user?.id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      this.showSubmitMessage('error', 'Impossible d\'identifier votre compte étudiant. Veuillez vous reconnecter.');
      return;
    }

    const applications = selected
      .map((job) => ({
        id_post: Number(job.id),
        id_societe: job.societeId,
      }))
      .filter((item) => Number.isInteger(item.id_post) && item.id_post > 0);

    if (applications.length === 0) {
      this.showSubmitMessage('error', 'Aucune offre valide sélectionnée.');
      return;
    }

    this.isPostuling = true;
    this.cdr.detectChanges();
    this.offresEmpService
      .applyToOffres({
        id_etudiant: studentId,
        applications,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.ngZone.run(() => {
            const persisted = this.loadPersistedSelections();
            const newApplied = new Set(this.appliedJobIds);
            selected.forEach((job) => {
              job.selected = false;
              persisted.delete(String(job.id));
              newApplied.add(String(job.id));
            });
            this.savePersistedSelections(persisted);
            this.saveAppliedIds(newApplied);
            this.appliedJobIds = newApplied;
            this.isPostuling = false;
            this.showSubmitMessage('success', 'Candidature(s) envoyée(s) avec succès !');
            this.cdr.detectChanges();
          });
        },
        error: (error) => {
          this.ngZone.run(() => {
            this.isPostuling = false;
            this.showSubmitMessage('error', error?.message || 'Erreur lors de la candidature.');
            this.cdr.detectChanges();
          });
        },
      });
  }

  closeSubmitMessage(): void {
    this.submitMessage = '';
    this.clearSubmitMessageTimer();
  }

  private showSubmitMessage(type: 'success' | 'error', message: string): void {
    this.submitMessageType = type;
    this.submitMessage = message;
    this.clearSubmitMessageTimer();
    this.submitMessageTimer = window.setTimeout(() => {
      this.submitMessage = '';
      this.submitMessageTimer = null;
    }, 5000);
  }

  private clearSubmitMessageTimer(): void {
    if (this.submitMessageTimer !== null) {
      window.clearTimeout(this.submitMessageTimer);
      this.submitMessageTimer = null;
    }
  }

  private clearLoadWatchdog(): void {
    if (this.loadWatchdog !== null) {
      window.clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }

  openDetails(job: Job): void {
    this.selectedJob = job;
  }

  closeDetails(): void {
    this.selectedJob = null;
  }

  getCompanyInitials(company: string): string {
    const words = (company || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return 'E';
    }
    if (words.length === 1) {
      return words[0].slice(0, 1).toUpperCase();
    }
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
}
