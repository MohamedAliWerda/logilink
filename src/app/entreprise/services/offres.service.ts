import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, timeout } from 'rxjs/operators';

export interface Offre {
  id: string;
  titre_poste: string;
  societe: string;
  exigences: string;
  date_creation: string;
  candidaturesCount?: number;
  status?: string;
}

export interface CreateOffreDTO {
  titre_poste: string;
  societe: string;
  exigences: string;
  societe_id?: number;
}

@Injectable({
  providedIn: 'root',
})
export class OffresService {
  private apiUrl = 'http://localhost:3001/offres';

  private offresSubject = new BehaviorSubject<Offre[]>([]);
  public offres$ = this.offresSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private successMessageSubject = new BehaviorSubject<string>('');
  public successMessage$ = this.successMessageSubject.asObservable();

  private errorMessageSubject = new BehaviorSubject<string>('');
  public errorMessage$ = this.errorMessageSubject.asObservable();

  constructor(private http: HttpClient) {}

  setOffres(offres: Offre[]): void {
    this.offresSubject.next(offres);
  }

  fetchCompanyOffres(): Observable<Offre[]> {
    const societeId = this.getSocieteIdFromStorage();
    if (!societeId) {
      return throwError(() => new Error('Compte societe introuvable. Veuillez vous reconnecter.'));
    }

    return this.http
      .get<any>(`${this.apiUrl}/company/${societeId}`)
      .pipe(
        timeout(15000),
        map((response) => {
          const normalized = this.normalizeResponse(response);
          if (!normalized.success) {
            throw new Error(normalized.error || 'Erreur lors du chargement des offres');
          }
          return Array.isArray(normalized.data) ? normalized.data : [];
        }),
        catchError((error) => {
          const timeoutError = error?.name === 'TimeoutError';
          const errorMsg = timeoutError
            ? 'Le chargement des offres a depasse le delai. Veuillez reessayer.'
            : (error?.error?.error || error?.message || 'Erreur lors du chargement des offres');
          this.showErrorMessage(errorMsg);
          return of([]);
        }),
      );
  }

  fetchCompanyCandidaturesCount(): Observable<number> {
    const societeId = this.getSocieteIdFromStorage();
    if (!societeId) {
      return of(0);
    }

    return this.http
      .get<any>(`${this.apiUrl}/company/${societeId}/candidatures`)
      .pipe(
        timeout(15000),
        map((response) => {
          const normalized = this.normalizeResponse(response);
          if (!normalized.success) {
            return 0;
          }
          const rows = Array.isArray(normalized.data) ? normalized.data : [];
          return rows.length;
        }),
        catchError(() => of(0)),
      );
  }

  loadActiveOffres(): void {
    this.loadingSubject.next(true);
    this.fetchCompanyOffres()
      .pipe(finalize(() => {
        this.loadingSubject.next(false);
      }))
      .subscribe((offres) => {
        this.offresSubject.next(Array.isArray(offres) ? offres : []);
      });
  }

  createOffre(data: CreateOffreDTO): Observable<any> {
    const societeId = this.getSocieteIdFromStorage();
    if (!societeId) {
      this.showErrorMessage('Compte societe introuvable. Veuillez vous reconnecter.');
      return throwError(() => new Error('Compte societe introuvable'));
    }

    this.loadingSubject.next(true);
    const payload: CreateOffreDTO = {
      ...data,
      societe_id: societeId,
    };

    return this.http.post<any>(`${this.apiUrl}/create`, payload).pipe(
      timeout(15000),
      map((response) => {
        const normalized = this.normalizeResponse(response);
        if (!normalized.success) {
          throw new Error(normalized.error || 'Erreur lors de la création');
        }

        const data = normalized.data || {};

        const currentOffres = this.offresSubject.value;
        this.offresSubject.next([
          {
            ...data,
            titre_poste: data.titre_poste,
            societe: data.societe,
            exigences: data.exigences,
            date_creation: data.date_creation,
            candidaturesCount: 0,
          },
          ...currentOffres,
        ]);
        this.showSuccessMessage(normalized.message || 'Offre créée avec succès');
        return normalized;
      }),
      catchError((error) => {
        const timeoutError = error?.name === 'TimeoutError';
        const errorMsg = timeoutError
          ? 'Le serveur met trop de temps a repondre. Veuillez reessayer.'
          : (error?.error?.error || error?.message || 'Erreur réseau lors de la création');
        this.showErrorMessage(errorMsg);
        return throwError(() => new Error(errorMsg));
      }),
      finalize(() => {
        this.loadingSubject.next(false);
      }),
    );
  }

  deleteOffre(id: string): Observable<any> {
    this.loadingSubject.next(true);
    return this.http.delete<any>(`${this.apiUrl}/${id}`).pipe(
      timeout(15000),
      map((response) => {
        const normalized = this.normalizeResponse(response);
        if (!normalized.success) {
          throw new Error(normalized.error || 'Erreur lors de la suppression');
        }

        const currentOffres = this.offresSubject.value;
        this.offresSubject.next(currentOffres.filter((o) => o.id !== id));
        this.showSuccessMessage(normalized.message || 'Offre supprimée avec succès');
        return normalized;
      }),
      catchError((error) => {
        const timeoutError = error?.name === 'TimeoutError';
        const errorMsg = timeoutError
          ? 'Le serveur met trop de temps a repondre. Veuillez reessayer.'
          : (error?.error?.error || error?.message || 'Erreur réseau lors de la suppression');
        this.showErrorMessage(errorMsg);
        return throwError(() => new Error(errorMsg));
      }),
      finalize(() => {
        this.loadingSubject.next(false);
      }),
    );
  }

  private getSocieteIdFromStorage(): number | undefined {
    try {
      const entrepriseRaw = localStorage.getItem('entreprise');
      if (!entrepriseRaw) {
        return undefined;
      }

      const entreprise = JSON.parse(entrepriseRaw);
      const societeId = Number(entreprise?.id);
      if (!Number.isInteger(societeId) || societeId <= 0) {
        return undefined;
      }

      return societeId;
    } catch {
      return undefined;
    }
  }

  private normalizeResponse(response: any): {
    success: boolean;
    data: any;
    message?: string;
    error?: string;
  } {
    const message = response?.message;

    if (response && response.success === true) {
      if (response.data && typeof response.data === 'object') {
        if ('success' in response.data) {
          const nested = response.data;
          return {
            success: nested.success !== false,
            data: nested.data,
            message,
            error: nested.error,
          };
        }
        return { success: true, data: response.data, message };
      }
      return { success: true, data: response.data ?? null, message };
    }

    if (response && response.success === false) {
      return {
        success: false,
        data: null,
        message,
        error: response.error || 'Erreur API',
      };
    }

    return {
      success: false,
      data: null,
      message,
      error: 'Réponse API invalide',
    };
  }

  private showSuccessMessage(message: string): void {
    this.successMessageSubject.next(message);
    setTimeout(() => {
      this.successMessageSubject.next('');
    }, 3000);
  }

  private showErrorMessage(message: string): void {
    this.errorMessageSubject.next(message);
    setTimeout(() => {
      this.errorMessageSubject.next('');
    }, 5000);
  }
}
