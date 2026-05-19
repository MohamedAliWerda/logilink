import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../../services/supabase.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ChangeDetectorRef } from '@angular/core';

export interface Poste {
  id: number;
  titre: string;
  description: string;
  nbEtudiants: number;
  statut: 'ouvert' | 'fermé';
  dateCreation: string;
}

export interface Entreprise {
  id: number;
  initiales: string;
  couleur: string;
  nom: string;
  secteur: string;
  nbPostes: number;
  dateDepuis: string;
  statut: 'validée' | 'en_attente';
  localisation?: string;
  dateAjout?: string;
  postes?: Poste[];
}

@Component({
  selector: 'app-gestion-entreprise',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gestion_entreprise.html',
  styleUrls: ['./gestion_entreprise.css']
})
export class GestionEntrepriseComponent implements OnInit, OnDestroy {

  searchQuery = '';
  activeTab: 'en_attente' | 'validées' | 'archivées' = 'en_attente';
  isLoading = false;

  selectedEntreprise: Entreprise | null = null;
  showPostesModal = false;
  isPostesLoading = false;
  postesError = '';
  showConfirmSupp = false;
  entrepriseToSupp: Entreprise | null = null;
  showConfirmArchive = false;
  entrepriseToArchive: Entreprise | null = null;
  showConfirmDesarchive = false;
  entrepriseToDesarchive: Entreprise | null = null;

  // Start empty - load from Supabase in ngOnInit
  entreprisesEnAttente: Entreprise[] = [];
  entreprisesValidees: Entreprise[] = [];
  entreprisesArchivees: Entreprise[] = [];


  // ✅ Getters utilisés dans le HTML
  get nbEnAttente(): number {
    return this.entreprisesEnAttente.length;
  }

  get nbValidees(): number {
    return this.entreprisesValidees.length;
  }

  get totalPostes(): number {
    return this.entreprisesValidees.reduce((s, e) => s + e.nbPostes, 0);
  }

  get filteredValidees(): Entreprise[] {
    if (!this.searchQuery.trim()) return this.entreprisesValidees;
    const q = this.searchQuery.toLowerCase();
    return this.entreprisesValidees.filter(e =>
      e.nom.toLowerCase().includes(q) || e.secteur.toLowerCase().includes(q)
    );
  }

  get filteredEnAttente(): Entreprise[] {
    if (!this.searchQuery.trim()) return this.entreprisesEnAttente;
    const q = this.searchQuery.toLowerCase();
    return this.entreprisesEnAttente.filter(e =>
      e.nom.toLowerCase().includes(q) || e.secteur.toLowerCase().includes(q)
    );
  }

  get filteredArchivees(): Entreprise[] {
    if (!this.searchQuery.trim()) return this.entreprisesArchivees;
    const q = this.searchQuery.toLowerCase();
    return this.entreprisesArchivees.filter(e =>
      e.nom.toLowerCase().includes(q) || e.secteur.toLowerCase().includes(q)
    );
  }

  get nbArchivees(): number {
    return this.entreprisesArchivees.length;
  }

  // ✅ Corrigé : accepte Entreprise | null (utilisé avec selectedEntreprise! dans le HTML)
  getTotalEtudiants(entreprise: Entreprise | null): number {
    if (!entreprise) return 0;
    return entreprise.postes?.reduce((s, p) => s + p.nbEtudiants, 0) ?? 0;
  }

  // ✅ Ouvre la modale postes
  async ouvrirPostes(entreprise: Entreprise): Promise<void> {
    this.selectedEntreprise = entreprise;
    this.showPostesModal = true;
    this.postesError = '';
    this.isPostesLoading = true;

    try {
      const rows = await this.supabase.fetchCompanyPosts(entreprise.id);
      const postes: Poste[] = (rows || []).map((row: any) => {
        const rawStatus = String(row?.status ?? 'active').toLowerCase();
        return {
          id: Number(row?.id_line ?? row?.id ?? 0),
          titre: String(row?.titre_poste ?? row?.titre ?? '').trim() || 'Poste',
          description: String(row?.exigences ?? row?.description ?? '').trim() || 'Description indisponible',
          nbEtudiants: Number(row?.candidaturesCount ?? 0) || 0,
          statut: rawStatus === 'closed' || rawStatus === 'fermé' || rawStatus === 'ferme' ? 'fermé' : 'ouvert',
          dateCreation: String(row?.date_creation ?? new Date().toISOString()),
        };
      });

      entreprise.postes = postes;
      entreprise.nbPostes = postes.length;
      this.selectedEntreprise = { ...entreprise };
      this.cdr.detectChanges();
    } catch (error: any) {
      this.postesError = error?.message || 'Impossible de charger les postes de cette entreprise.';
      entreprise.postes = [];
      this.selectedEntreprise = { ...entreprise };
      this.cdr.detectChanges();
    } finally {
      this.isPostesLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ✅ Ferme la modale postes
  fermerModal(): void {
    this.showPostesModal = false;
    this.selectedEntreprise = null;
    this.isPostesLoading = false;
    this.postesError = '';
  }

  // ✅ Déclenche la confirmation de suppression
  confirmerSuppAcces(entreprise: Entreprise): void {
    this.entrepriseToSupp = entreprise;
    this.showConfirmSupp = true;
  }

  // ✅ Confirme la suppression
  supprimerAcces(): void {
    if (this.entrepriseToSupp) {
      this.entreprisesValidees = this.entreprisesValidees.filter(
        e => e.id !== this.entrepriseToSupp!.id
      );
      this.showConfirmSupp = false;
      this.showPostesModal = false;
      this.entrepriseToSupp = null;
      this.selectedEntreprise = null;
    }
  }

  // ✅ Annule la suppression
  annulerSupp(): void {
    this.showConfirmSupp = false;
    this.entrepriseToSupp = null;
  }

  // ✅ Déclenche la confirmation d'archivage
  confirmerArchivage(entreprise: Entreprise): void {
    this.entrepriseToArchive = entreprise;
    this.showConfirmArchive = true;
  }

  // ✅ Annule l'archivage
  annulerArchive(): void {
    this.showConfirmArchive = false;
    this.entrepriseToArchive = null;
  }

  // ✅ Déclenche la confirmation de désarchivage
  confirmerDesarchivage(entreprise: Entreprise): void {
    this.entrepriseToDesarchive = entreprise;
    this.showConfirmDesarchive = true;
  }

  // ✅ Annule le désarchivage
  annulerDesarchivage(): void {
    this.showConfirmDesarchive = false;
    this.entrepriseToDesarchive = null;
  }

  // ✅ Désarchive une entreprise → la remet dans les validées
  async desarchiverEntreprise(): Promise<void> {
    if (!this.entrepriseToDesarchive) return;
    const entreprise = this.entrepriseToDesarchive;
    this.showConfirmDesarchive = false;
    this.entrepriseToDesarchive = null;
    this.cdr.detectChanges();
    try {
      this.entreprisesArchivees = this.entreprisesArchivees.filter(e => e.id !== entreprise.id);
      await this.supabase.updateSocieteSituation(entreprise.id, 'Validée');
      this.entreprisesValidees = [{ ...entreprise, couleur: '#0ea5e9' }, ...this.entreprisesValidees];
      this.cdr.detectChanges();
    } catch (err) {
      console.error('❌ Failed to unarchive entreprise:', err);
      await this.refreshData();
    }
  }

  // ✅ Archive une entreprise validée
  async archiverEntreprise(): Promise<void> {
    if (!this.entrepriseToArchive) return;
    const entreprise = this.entrepriseToArchive;
    this.showConfirmArchive = false;
    this.entrepriseToArchive = null;
    this.cdr.detectChanges();
    try {
      this.entreprisesValidees = this.entreprisesValidees.filter(e => e.id !== entreprise.id);
      await this.supabase.updateSocieteSituation(entreprise.id, 'Archiver');
      this.entreprisesArchivees = [{ ...entreprise, statut: 'validée' }, ...this.entreprisesArchivees];
      this.cdr.detectChanges();
    } catch (err) {
      console.error('❌ Failed to archive entreprise:', err);
      await this.refreshData();
    }
  }

  // ✅ Load companies pending validation from Supabase
  private async loadEnAttente(): Promise<void> {
    try {
      console.log('🔄 Fetching entreprises en attente from Supabase...');
      const rows: any[] = await this.supabase.fetchSocietesBySituation('En attente');
      const postCounts = await this.resolvePostCounts(rows);
      console.log('📥 Raw response for en attente:', rows);
      console.log('📥 Loaded entreprises en attente:', rows.length, 'rows');
      
      if (!rows || rows.length === 0) {
        console.warn('⚠️ No rows returned for "En attente"');
        this.entreprisesEnAttente = [];
        return;
      }
      
      this.entreprisesEnAttente = rows.map(r => {
        console.log('📦 Mapping row:', { id: r.id, nom: r.denomination_sociale, date: r.date_creation });
        const societeId = Number(r.id);
        const autoCount = postCounts.get(societeId);
        return {
          id: societeId,
          initiales: (r.denomination_sociale || '').split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase() || '??',
          couleur: '#a855f7',
          nom: r.denomination_sociale ?? r.raison_sociale ?? 'Entreprise',
          secteur: r.secteur_activite ?? r.secteur ?? '',
          nbPostes: typeof autoCount === 'number' ? autoCount : Number(r.nb_postes ?? 0),
          dateDepuis: r.date_creation ? new Date(r.date_creation).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '',
          statut: 'en_attente',
          localisation: r.adresse ?? '',
          dateAjout: r.date_creation ? new Date(r.date_creation).toLocaleString('fr-FR') : ''
        };
      });
      console.log('✅ Mapped', this.entreprisesEnAttente.length, 'entreprises en attente');
      this.cdr.detectChanges();
    } catch (err) {
      console.error('❌ Failed to load entreprises en attente:', err);
      this.entreprisesEnAttente = [];
    }
  }

  // ✅ Load validated companies from Supabase
  private async loadValidees(): Promise<void> {
    try {
      console.log('🔄 Fetching entreprises validées from Supabase...');
      const validRows: any[] = await this.supabase.fetchSocietesBySituations(['Validée', 'validée', 'VALIDÉE']);
      const postCounts = await this.resolvePostCounts(validRows);
      console.log('📥 Raw response for validées:', validRows);
      console.log('📥 Loaded entreprises validées:', validRows.length, 'rows');
      
      if (!validRows || validRows.length === 0) {
        console.warn('⚠️ No rows returned for validées');
        this.entreprisesValidees = [];
        return;
      }
      
      this.entreprisesValidees = validRows.map(r => {
        console.log('📦 Mapping row:', { id: r.id, nom: r.denomination_sociale, date: r.date_creation });
        const societeId = Number(r.id);
        const autoCount = postCounts.get(societeId);
        return {
          id: societeId,
          initiales: (r.denomination_sociale || '').split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase() || '??',
          couleur: '#0ea5e9',
          nom: r.denomination_sociale ?? r.raison_sociale ?? 'Entreprise',
          secteur: r.secteur_activite ?? r.secteur ?? '',
          nbPostes: typeof autoCount === 'number' ? autoCount : Number(r.nb_postes ?? 0),
          dateDepuis: r.date_creation ? new Date(r.date_creation).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '',
          statut: 'validée',
          localisation: r.adresse ?? '',
          dateAjout: r.date_creation ? new Date(r.date_creation).toLocaleString('fr-FR') : '',
          postes: []
        };
      });
      console.log('✅ Mapped', this.entreprisesValidees.length, 'entreprises validées');
      this.cdr.detectChanges();
    } catch (err) {
      console.error('❌ Failed to load entreprises validées:', err);
      this.entreprisesValidees = [];
    }
  }

  // ✅ Verify Supabase connection and show all data in the table
  async verifySupabaseConnection(): Promise<void> {
    try {
      console.log('🔗 Verifying Supabase connection...');
      const allRows: any[] = await this.supabase.fetchAllSocietes();
      
      if (allRows.length === 0) {
        console.warn('⚠️ IMPORTANT: Supabase "Societe" table is EMPTY!');
        console.log('Please register a company first through the registration form.');
        return;
      }
      
      console.log('✅ Supabase connection OK');
      console.log('📊 Total companies in table:', allRows.length);
      
      // Log each record with all details
      allRows.forEach((r, idx) => {
        console.log(`Record ${idx + 1}:`, {
          id: r.id,
          denomination_sociale: r.denomination_sociale,
          situation: r.situation,
          date_creation: r.date_creation,
          email: r.email,
          secteur_activite: r.secteur_activite,
          adresse: r.adresse
        });
      });
      
      // Show breakdown by situation
      const bySituation: { [key: string]: number } = {};
      allRows.forEach(r => {
        const sit = r.situation || 'NULL';
        bySituation[sit] = (bySituation[sit] || 0) + 1;
      });
      console.log('📊 Breakdown by situation:', bySituation);
    } catch (err) {
      console.error('❌ Supabase connection error:', err);
    }
  }

  // ✅ Load archived companies from Supabase
  private async loadArchivees(): Promise<void> {
    try {
      const rows: any[] = await this.supabase.fetchSocietesBySituations(['Archiver', 'archiver', 'ARCHIVER']);
      const postCounts = await this.resolvePostCounts(rows);
      if (!rows || rows.length === 0) {
        this.entreprisesArchivees = [];
        return;
      }
      this.entreprisesArchivees = rows.map(r => ({
        id: Number(r.id),
        initiales: (r.denomination_sociale || '').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '??',
        couleur: '#94a3b8',
        nom: r.denomination_sociale ?? r.raison_sociale ?? 'Entreprise',
        secteur: r.secteur_activite ?? r.secteur ?? '',
        nbPostes: typeof postCounts.get(Number(r.id)) === 'number'
          ? (postCounts.get(Number(r.id)) as number)
          : Number(r.nb_postes ?? 0),
        dateDepuis: r.date_creation ? new Date(r.date_creation).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '',
        statut: 'validée' as const,
        localisation: r.adresse ?? '',
        dateAjout: r.date_creation ? new Date(r.date_creation).toLocaleString('fr-FR') : '',
        postes: []
      }));
      this.cdr.detectChanges();
    } catch (err) {
      console.error('❌ Failed to load entreprises archivées:', err);
      this.entreprisesArchivees = [];
    }
  }

  private async resolvePostCounts(rows: any[]): Promise<Map<number, number>> {
    const ids = (rows || [])
      .map((row) => Number(row?.id ?? 0))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!ids.length) {
      return new Map<number, number>();
    }

    try {
      return await this.supabase.fetchCompanyPostCounts(ids);
    } catch (err) {
      console.warn('⚠️ Unable to fetch automatic post counts, falling back to nb_postes column.', err);
      return new Map<number, number>();
    }
  }

  // ✅ Refresh data from Supabase (called on init and manually)
  async refreshData(): Promise<void> {
    console.log('🔄 Refreshing all data from Supabase...');
    this.isLoading = true;
    try {
      await this.loadEnAttente();
      await this.loadValidees();
      await this.loadArchivees();
      console.log('✅ Data refresh complete');
      console.log('📊 Summary - En Attente:', this.entreprisesEnAttente.length, '| Validées:', this.entreprisesValidees.length, '| Archivées:', this.entreprisesArchivees.length);
      this.cdr.detectChanges();
    } catch (err) {
      console.error('❌ Error during data refresh:', err);
    } finally {
      this.isLoading = false;
    }
  }

  // ✅ Valide une entreprise en attente → met à jour la DB et rafraîchit les listes
  async validerEntreprise(entreprise: Entreprise): Promise<void> {
    try {
      // Optimistically remove from en_attente list (instant UI feedback)
      this.entreprisesEnAttente = this.entreprisesEnAttente.filter(e => e.id !== entreprise.id);

      // Update DB — returns full row including email
      const updated = await this.supabase.updateSocieteSituation(entreprise.id, 'Validée');

      // Send approval email (fire-and-forget, don't block the UI)
      this.supabase.sendSocieteApprovalEmail(entreprise.id).catch((err: unknown) => {
        console.error('Approval email failed (non-blocking):', err);
      });

      // Reload validées list to show the newly validated company
      await this.loadValidees();
    } catch (err) {
      console.error('❌ Failed to validate entreprise:', err);
      // Reload both lists to restore correct state on error
      await this.refreshData();
    }
  }

  // ✅ Rejette une entreprise en attente → met à jour la DB
  async rejeterEntreprise(entreprise: Entreprise): Promise<void> {
    try {
      // Optimistically remove from en_attente list
      this.entreprisesEnAttente = this.entreprisesEnAttente.filter(e => e.id !== entreprise.id);

      // Update DB — returns full row including email
      const updated = await this.supabase.updateSocieteSituation(entreprise.id, 'Rejetée');

      // Send rejection email (fire-and-forget)
      this.supabase.sendSocieteRejectionEmail(entreprise.id).catch((err: unknown) => {
        console.error('Rejection email failed (non-blocking):', err);
      });
    } catch (err) {
      console.error('❌ Failed to reject entreprise:', err);
      await this.refreshData();
    }
  }

  private routerSub: Subscription | null = null;

  constructor(private readonly supabase: SupabaseService, private readonly router: Router, private readonly cdr: ChangeDetectorRef) {
    // Refresh when returning to this route (covers navigation back / route reuse)
    this.routerSub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe((e: any) => {
      const url = e.urlAfterRedirects || e.url;
      if (url && url.includes('/admin/gestion-entreprise')) {
        // small delay to ensure component is active
        setTimeout(() => this.refreshData(), 0);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    console.log('🚀 Component initializing, fetching latest data from Supabase...');
    await this.verifySupabaseConnection();
    await this.refreshData();
  }

  ngOnDestroy(): void {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
      this.routerSub = null;
    }
  }
}