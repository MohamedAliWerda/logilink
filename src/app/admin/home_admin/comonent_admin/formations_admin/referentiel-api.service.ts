import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';

export type ReferentielApiRow = {
  code: string;
  competence: string;
  categorie: string;
  domaine: string;
};

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

@Injectable({
  providedIn: 'root',
})
export class ReferentielApiService {
  private readonly apiBaseUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  getCompetences(): Promise<ReferentielApiRow[]> {
    return firstValueFrom(
      this.http.get<ApiResponse<ReferentielApiRow[]>>(
        `${this.apiBaseUrl}/ref-competance/competences`,
      ),
    ).then((response) => response.data ?? []);
  }
}
