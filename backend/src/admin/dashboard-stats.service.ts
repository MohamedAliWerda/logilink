import { Injectable } from '@nestjs/common';
import { getSupabase } from '../config/supabase.client';

type ScoreRow = {
  score_final?: number | null;
  parcours_type?: string | null;
  filiere_licence?: string | null;
  filiere_master?: string | null;
};

type AtsRow = { ats_score?: number | null };

type SocieteRow = {
  region?: string | null;
  gouvernorat?: string | null;
  ville?: string | null;
  adresse?: string | null;
  situation?: string | null;
  statut?: string | null;
};

const FILIERE_BUCKETS = {
  Licence_Sciences_de_Transport: 'l_t',
  Licence_Génie_Logistique: 'l_l',
  Master_Recherche_STL: 'm_s',
  Master_Pro_Génie_Industriel_et_Logistique: 'm_i',
} as const;

function bucketize(scores: number[], edges: [number, number][]): number[] {
  return edges.map(([min, max]) => scores.filter((s) => s >= min && s < max).length);
}

@Injectable()
export class DashboardStatsService {
  async getEmployabilityScores(): Promise<number[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('score_employabilité')
      .select('score_final');
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r: any) => Number(r?.score_final))
      .filter((n: number) => Number.isFinite(n));
  }

  async getEmployabilityRows(): Promise<ScoreRow[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('score_employabilité')
      .select('score_final,parcours_type,filiere_licence,filiere_master');
    if (error) throw new Error(error.message);
    return (data ?? []) as ScoreRow[];
  }

  async getAtsScores(): Promise<number[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cv_submissions')
      .select('ats_score');
    if (error) throw new Error(error.message);
    return ((data ?? []) as AtsRow[])
      .map((r) => Number(r.ats_score))
      .filter((n) => Number.isFinite(n));
  }

  async count(table: string): Promise<number> {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countWhereGte(table: string, column: string, value: number): Promise<number> {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .gte(column, value);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async getSocieteRegionDistribution(): Promise<Array<{ label: string; count: number }>> {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('Societe').select('*');
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as SocieteRow[]) {
      if (!this.isValidated(row)) continue;
      const region = this.extractRegion(row);
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getAggregateStats() {
    const [scores, atsScores, studentsCount, matiereCount, scoredCount, regions] = await Promise.all([
      this.getEmployabilityRows(),
      this.getAtsScores(),
      this.count('profils_etudiant').catch(() => 0),
      this.count('matiere').catch(() => 0),
      this.count('score_employabilité').catch(() => 0),
      this.getSocieteRegionDistribution().catch(() => []),
    ]);

    const finals = scores
      .map((r) => Number(r.score_final))
      .filter((n) => Number.isFinite(n));

    const employabilityAverage =
      finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;

    const employabilityDistribution = bucketize(finals, [
      [50, 60],
      [60, 70],
      [70, 80],
      [80, 90],
      [90, 100.0001],
    ]);

    const atsDistribution = bucketize(atsScores, [
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100.0001],
    ]);

    const filiereAverages = this.computeFiliereAverages(scores);
    const parcoursAverages = this.computeParcoursAverages(scores);

    const bestProfilesCount = finals.filter((s) => s >= 75).length;

    return {
      employability: {
        average: Number(employabilityAverage.toFixed(2)),
        totalScored: finals.length,
        distribution: employabilityDistribution,
        filiereAverages,
        parcoursAverages,
        bestProfilesCount,
      },
      ats: {
        distribution: atsDistribution,
        total: atsScores.length,
      },
      counts: {
        students: studentsCount,
        matieres: matiereCount,
        scoredProfiles: scoredCount,
      },
      societeRegions: regions,
    };
  }

  private computeFiliereAverages(scores: ScoreRow[]) {
    const accum: Record<'l_t' | 'l_l' | 'm_s' | 'm_i', { sum: number; count: number }> = {
      l_t: { sum: 0, count: 0 },
      l_l: { sum: 0, count: 0 },
      m_s: { sum: 0, count: 0 },
      m_i: { sum: 0, count: 0 },
    };
    for (const row of scores) {
      const type = row.parcours_type ?? '';
      const filiere =
        type === 'L'
          ? row.filiere_licence ?? ''
          : type === 'M' || type === 'LM'
            ? row.filiere_master ?? ''
            : '';
      const bucket = (FILIERE_BUCKETS as Record<string, 'l_t' | 'l_l' | 'm_s' | 'm_i'>)[filiere];
      if (!bucket) continue;
      const score = Number(row.score_final) || 0;
      accum[bucket].sum += score;
      accum[bucket].count += 1;
    }
    const avg = (b: { sum: number; count: number }) => (b.count > 0 ? Number((b.sum / b.count).toFixed(2)) : 0);
    return {
      licence_logistique: avg(accum.l_l),
      licence_transport: avg(accum.l_t),
      master_pro_industriel: avg(accum.m_i),
      master_recherche_stl: avg(accum.m_s),
    };
  }

  private computeParcoursAverages(scores: ScoreRow[]) {
    const accum = { L: { sum: 0, count: 0 }, M: { sum: 0, count: 0 }, LM: { sum: 0, count: 0 } };
    for (const row of scores) {
      const type = (row.parcours_type ?? '') as keyof typeof accum;
      if (!(type in accum)) continue;
      const score = Number(row.score_final) || 0;
      accum[type].sum += score;
      accum[type].count += 1;
    }
    const avg = (b: { sum: number; count: number }) => (b.count > 0 ? Number((b.sum / b.count).toFixed(2)) : 0);
    return { L: avg(accum.L), M: avg(accum.M), LM: avg(accum.LM) };
  }

  private isValidated(row: SocieteRow): boolean {
    const statusRaw = (row.situation ?? row.statut ?? '').toString().trim();
    if (!statusRaw) return false;
    const normalized = statusRaw
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    return (
      normalized === 'validee' ||
      normalized === 'valide' ||
      normalized === 'approved' ||
      normalized === 'active'
    );
  }

  private extractRegion(row: SocieteRow): string {
    const candidates = [row.region, row.gouvernorat, row.ville]
      .map((v) => (v ?? '').toString().trim())
      .find((v) => v.length > 0);
    if (candidates) return candidates;
    const adresse = (row.adresse ?? '').toString().trim();
    if (adresse) {
      const parts = adresse
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
    return 'Non renseignée';
  }
}
