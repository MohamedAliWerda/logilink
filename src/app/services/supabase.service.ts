import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor(private http: HttpClient) {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  public get client() {
    return this.supabase;
  }

  /**
   * Deprecated: kept as alias for the anon client so existing consumers compile.
   * RLS must allow each operation; sensitive operations must go through the
   * backend API.
   */
  public get adminClient() {
    return this.supabase;
  }

  private unwrap<T>(response: any): T {
    if (response && typeof response === 'object' && 'data' in response) {
      return response.data as T;
    }
    return response as T;
  }

  async fetchFeedback(table = 'feedback') {
    if (table === 'ancien_etudiant' || table === 'feedback') {
      const route = table === 'feedback' ? 'feedback' : 'ancien-etudiants';
      const apiUrl = `${environment.apiUrl}/admin/${route}`;
      const response = await firstValueFrom(this.http.get<any>(apiUrl));
      const rows = Array.isArray(response) ? response : this.unwrap<any[]>(response);
      return Array.isArray(rows) ? rows : [];
    }

    const { data, error } = await this.supabase.from(table).select('*');
    if (error) {
      throw error;
    }
    return data;
  }

  async createAncienEtudiant(payload: Record<string, unknown>) {
    const apiUrl = `${environment.apiUrl}/admin/ancien-etudiants`;
    const response = await firstValueFrom(this.http.post<any>(apiUrl, payload));
    return this.unwrap(response);
  }

  async createFeedback(payload: Record<string, unknown>) {
    const apiUrl = `${environment.apiUrl}/admin/feedback`;
    const response = await firstValueFrom(this.http.post<any>(apiUrl, payload));
    return this.unwrap(response);
  }

  async deleteAncienEtudiant(id: string | number, email?: string): Promise<void> {
    let apiUrl = `${environment.apiUrl}/admin/ancien-etudiants/${encodeURIComponent(id)}`;
    if (email) apiUrl += `?email=${encodeURIComponent(email)}`;
    await firstValueFrom(this.http.delete<any>(apiUrl));
  }

  async sendSingleAncienEtudiantInvitation(id: string, payload?: { subject?: string; message?: string }): Promise<{ sent: boolean }> {
    const apiUrl = `${environment.apiUrl}/admin/ancien-etudiants/${id}/send-invitation`;
    const response = await firstValueFrom(this.http.post<any>(apiUrl, payload ?? {}));
    return this.unwrap(response);
  }

  async sendAncienEtudiantInvitations(payload: { subject: string; message: string }): Promise<{ attempted: number; sent: number; failed: number; errors: { email: string; reason: string }[] }> {
    const apiUrl = `${environment.apiUrl}/admin/ancien-etudiants/send-invitations`;
    const response = await firstValueFrom(this.http.post<any>(apiUrl, payload));
    return this.unwrap(response);
  }

  async findConflictingSociete(payload: { nomEntreprise?: string; email?: string; telephone?: string }): Promise<{ id: number } | null> {
    if (!payload?.email) return null;
    try {
      const apiUrl = `${environment.apiUrl}/entreprise/conflict`;
      const response = await firstValueFrom(
        this.http.post<any>(apiUrl, {
          email: payload.email,
          telephone: payload.telephone ?? '',
          nomEntreprise: payload.nomEntreprise ?? '',
        }),
      );
      return this.unwrap(response);
    } catch {
      return null;
    }
  }

  async fetchSocietesBySituation(situation: string) {
    const apiUrl = `${environment.apiUrl}/entreprise/by-situations?values=${encodeURIComponent(situation)}`;
    const response = await firstValueFrom(this.http.get<any>(apiUrl));
    return this.unwrap<any[]>(response) ?? [];
  }

  async fetchSocietesBySituations(situations: string[]) {
    const apiUrl = `${environment.apiUrl}/entreprise/by-situations?values=${encodeURIComponent(situations.join(','))}`;
    const response = await firstValueFrom(this.http.get<any>(apiUrl));
    return this.unwrap<any[]>(response) ?? [];
  }

  async fetchAllSocietes() {
    const apiUrl = `${environment.apiUrl}/entreprise`;
    const response = await firstValueFrom(this.http.get<any>(apiUrl));
    return this.unwrap<any[]>(response) ?? [];
  }

  async fetchSocieteById(id: number) {
    const apiUrl = `${environment.apiUrl}/entreprise/${id}`;
    const response = await firstValueFrom(this.http.get<any>(apiUrl));
    return this.unwrap(response);
  }

  async updateSocieteProfile(
    id: number,
    payload: {
      nomEntreprise: string;
      email: string;
      telephone: string;
      adresse: string;
      description: string;
    },
  ) {
    const apiUrl = `${environment.apiUrl}/entreprise/${id}/profile`;
    const response = await firstValueFrom(this.http.put<any>(apiUrl, payload));
    return this.unwrap(response);
  }

  async fetchCompanyPosts(societeId: number) {
    const apiUrl = `${environment.apiUrl}/offres/company/${societeId}`;
    const response = await firstValueFrom(this.http.get<any>(apiUrl));

    if (Array.isArray(response)) {
      return response;
    }

    if (Array.isArray(response?.data)) {
      return response.data;
    }

    if (Array.isArray(response?.data?.data)) {
      return response.data.data;
    }

    return [];
  }

  async fetchCompanyPostCounts(societeIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    const validIds = [...new Set((societeIds || []).filter((id) => Number.isInteger(id) && id > 0))];
    for (const id of validIds) {
      counts.set(id, 0);
    }
    if (!validIds.length) {
      return counts;
    }

    await Promise.all(
      validIds.map(async (id) => {
        try {
          const posts = await this.fetchCompanyPosts(id);
          counts.set(id, Array.isArray(posts) ? posts.length : 0);
        } catch {
          counts.set(id, 0);
        }
      }),
    );

    return counts;
  }

  async updateSocieteSituation(id: number, situation: string) {
    const apiUrl = `${environment.apiUrl}/entreprise/${id}/situation`;
    const response = await firstValueFrom(this.http.put<any>(apiUrl, { situation }));
    return this.unwrap(response);
  }

  async sendSocieteApprovalEmail(societeId: number): Promise<void> {
    const apiUrl = `${environment.apiUrl}/admin/societe/send-approval-email`;
    await firstValueFrom(this.http.post<any>(apiUrl, { societeId }));
  }

  async sendSocieteRejectionEmail(societeId: number): Promise<void> {
    const apiUrl = `${environment.apiUrl}/admin/societe/send-rejection-email`;
    await firstValueFrom(this.http.post<any>(apiUrl, { societeId }));
  }

  async sendSocietePendingEmail(societeId: number): Promise<void> {
    const apiUrl = `${environment.apiUrl}/admin/societe/send-pending-email`;
    await firstValueFrom(this.http.post<any>(apiUrl, { societeId }));
  }

  async createSociete(payload: {
    nomEntreprise: string;
    email: string;
    telephone: string;
    adresse: string;
    description: string;
    password: string;
  }) {
    const apiUrl = `${environment.apiUrl}/entreprise/register`;
    const response = await firstValueFrom(this.http.post<any>(apiUrl, payload));
    return this.unwrap(response);
  }
}
