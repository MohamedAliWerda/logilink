import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type Entreprise = {
  id: string;
  nomEntreprise: string;
  email: string;
  telephone: string;
  adresse: string;
  description?: string;
};

export type Offre = {
  id: string;
  titre: string;
  entreprise: string;
  lieu: string;
  typeContrat: string;
  description: string;
  competences: string[];
  candidaturesCount?: number;
  createdAt?: string;
   source?: string;
  salaireMin?: number | null;
  salaireMax?: number | null;
};

export type Candidature = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  ecole: string;
  ville: string;
  competences: string[];
  scoreAts: number;
  scoreEmployabilite: number;
  createdAt?: string;
};

@Injectable({ providedIn: 'root' })
export class EntrepriseApiService {
  private readonly apiBaseUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  register(payload: {
    nomEntreprise: string;
    email: string;
    telephone: string;
    adresse: string;
    description?: string;
    password: string;
  }): Promise<{ data: { access_token: string; entreprise: Entreprise } }> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiBaseUrl}/entreprise/register`, payload)
    );
  }

  getOffres(): Promise<Offre[]> {
    return firstValueFrom(
      this.http.get<Offre[]>(`${this.apiBaseUrl}/entreprise/offres`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }

  createOffre(offre: Omit<Offre, 'id' | 'candidaturesCount' | 'createdAt'>): Promise<Offre> {
    return firstValueFrom(
      this.http.post<Offre>(`${this.apiBaseUrl}/entreprise/offres`, offre, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }

  updateOffre(id: string, offre: Partial<Offre>): Promise<Offre> {
    return firstValueFrom(
      this.http.patch<Offre>(`${this.apiBaseUrl}/entreprise/offres/${id}`, offre, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }

  deleteOffre(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.apiBaseUrl}/entreprise/offres/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }

  getCandidatures(offreId: string): Promise<Candidature[]> {
    return firstValueFrom(
      this.http.get<Candidature[]>(`${this.apiBaseUrl}/entreprise/offres/${offreId}/candidatures`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }

  getProfil(): Promise<Entreprise> {
    return firstValueFrom(
      this.http.get<Entreprise>(`${this.apiBaseUrl}/entreprise/profil`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }

  updateProfil(profil: Partial<Entreprise>): Promise<Entreprise> {
    return firstValueFrom(
      this.http.patch<Entreprise>(`${this.apiBaseUrl}/entreprise/profil`, profil, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
    );
  }
}
