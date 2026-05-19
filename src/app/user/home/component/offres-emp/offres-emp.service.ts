import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

export interface StudentOffre {
  id: string;
  societe_id?: number;
  titre_poste: string;
  societe: string;
  exigences: string;
  date_creation?: string;
  typeContrat?: string;
  lieu?: string;
  competences?: string[];
}

export interface ApplyToOffresPayload {
  id_etudiant: number;
  applications: Array<{
    id_post: number;
    id_societe?: number;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class OffresEmpService {
  private readonly apiUrl = 'http://localhost:3001/offres';

  constructor(private readonly http: HttpClient) {}

  fetchActiveOffres(): Observable<StudentOffre[]> {
    return this.http.get<any>(`${this.apiUrl}/active`).pipe(
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
        return throwError(() => new Error(errorMsg));
      }),
    );
  }

  applyToOffres(payload: ApplyToOffresPayload): Observable<{ inserted: number; skipped: number }> {
    return this.http.post<any>(`${this.apiUrl}/apply`, payload).pipe(
      timeout(15000),
      map((response) => {
        const normalized = this.normalizeResponse(response);
        if (!normalized.success) {
          throw new Error(normalized.error || 'Erreur lors de la candidature');
        }
        const data = normalized.data || {};
        return {
          inserted: Number(data.inserted ?? 0),
          skipped: Number(data.skipped ?? 0),
        };
      }),
      catchError((error) => {
        const timeoutError = error?.name === 'TimeoutError';
        const errorMsg = timeoutError
          ? 'La candidature a depasse le delai. Veuillez reessayer.'
          : (error?.error?.error || error?.message || 'Erreur lors de la candidature');
        return throwError(() => new Error(errorMsg));
      }),
    );
  }

  fetchStudentAppliedIds(studentId: number): Observable<number[]> {
    return this.http.get<any>(`${this.apiUrl}/student/${studentId}/applied`).pipe(
      timeout(10000),
      map((response) => {
        const normalized = this.normalizeResponse(response);
        if (!normalized.success) return [];
        return Array.isArray(normalized.data) ? normalized.data.map(Number) : [];
      }),
      catchError(() => of([])),
    );
  }

  saveSelection(payload: { id_etudiant: number | string; id_post: number | string; id_societe?: number | string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/selection`, payload).pipe(
      timeout(10000),
      map((response) => {
        const normalized = this.normalizeResponse(response);
        if (!normalized.success) {
          throw new Error(normalized.error || 'Erreur lors de l enregistrement');
        }
        return normalized.data || {};
      }),
    );
  }

  removeSelection(payload: { id_etudiant: number | string; id_post: number | string; id_societe?: number | string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/selection/remove`, payload).pipe(
      timeout(10000),
      map((response) => {
        const normalized = this.normalizeResponse(response);
        if (!normalized.success) {
          throw new Error(normalized.error || 'Erreur lors de la suppression');
        }
        return normalized.data || {};
      }),
    );
  }

  private normalizeResponse(response: any): {
    success: boolean;
    data: any;
    error?: string;
  } {
    if (response && response.success === true && response.data && typeof response.data === 'object') {
      if ('success' in response.data) {
        return {
          success: response.data.success !== false,
          data: response.data.data,
          error: response.data.error,
        };
      }

      return {
        success: true,
        data: response.data,
      };
    }

    if (response && response.success === true && Array.isArray(response.data)) {
      return {
        success: true,
        data: response.data,
      };
    }

    if (response && response.success === false) {
      return {
        success: false,
        data: null,
        error: response.error || 'Erreur API',
      };
    }

    return {
      success: false,
      data: null,
      error: 'Reponse API invalide',
    };
  }
}
