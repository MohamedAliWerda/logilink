import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CvSubmissionService } from '../cv_submission/cv-submission.service';

type ApplyRequest = {
  id_post: number | string;
  id_societe?: number | string;
};

type StudentIdentity = {
  id: number;
  nom: string;
  prenom: string;
  cinPassport?: number;
};

type StudentProfile = {
  ville: string;
  email: string;
};

type CompanyCandidature = {
  id: string;
  id_etudiant: number;
  id_societe: number;
  id_post: number;
  poste: string;
  nom: string;
  prenom: string;
  email: string;
  ville: string;
  score_employabilite: number;
  score_ats: number | null;
  date_creation: string;
  competences: string[];
};

@Injectable()
export class OffresService {
  private supabase: SupabaseClient;

  constructor(private readonly cvSubmissionService: CvSubmissionService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
  }

  async createOffre(data: {
    titre_poste: string;
    societe: string;
    exigences: string;
    societe_id?: string;
  }) {
    try {
      if (!data.societe_id) {
        throw new Error('societe_id est obligatoire pour lier l\'offre a la societe');
      }

      const societeId = Number(data.societe_id);
      if (!Number.isInteger(societeId) || societeId <= 0) {
        throw new Error('societe_id invalide');
      }

      const societeExists = await this.checkSocieteExists(societeId);
      if (!societeExists) {
        throw new Error('societe_id introuvable dans la table Societe');
      }

      const insertedRow = await this.insertPostWithColumnFallbacks({
        societeId,
        titre_poste: data.titre_poste,
        exigences: data.exigences,
        societe: data.societe,
      });

      return {
        success: true,
        data: {
          id: String(insertedRow?.id_line ?? insertedRow?.id),
          id_line: insertedRow?.id_line,
          societe_id: insertedRow?.id,
          titre_poste: insertedRow?.['Titre du poste'] ?? insertedRow?.['titre_poste'] ?? '',
          societe:
            insertedRow?.['Sociéte']
            ?? insertedRow?.['Société']
            ?? insertedRow?.['Societe']
            ?? insertedRow?.['societe']
            ?? '',
          exigences: insertedRow?.Exigences ?? insertedRow?.['exigences'] ?? '',
          date_creation: insertedRow?.date_creation ?? new Date().toISOString(),
        },
        message: 'Offre créée avec succès',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la création',
        data: null,
      };
    }
  }

  async getActiveOffres() {
    try {
      const { data: offres, error } = await this.supabase
        .from('post')
        .select('*')
        .eq('is_archived', false)
        .order('id_line', { ascending: false });

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      const postIds = (offres || [])
        .map((row: any) => Number(row?.id_line ?? row?.id_post ?? 0))
        .filter((id: number) => Number.isInteger(id) && id > 0);
      const candidaturesByPost = await this.getCandidatureCountsByPostIds(postIds);

      return {
        message: 'Offres récupérées avec succès',
        data: (offres || []).map((row: any) => ({
          id: String(row.id_line ?? row.id),
          id_line: row.id_line,
          societe_id: row.id,
          titre_poste: row['Titre du poste'] ?? row['titre_poste'] ?? '',
          societe: row['Sociéte'] ?? row['Société'] ?? row['Societe'] ?? row['societe'] ?? '',
          exigences: row.Exigences ?? row.exigences ?? '',
          date_creation: row.date_creation ?? new Date().toISOString(),
          candidaturesCount: candidaturesByPost.get(Number(row?.id_line ?? row?.id_post ?? 0)) ?? 0,
          status: 'active',
        })),
      };
    } catch (error) {
      return {
        message: 'Erreur lors de la récupération des offres',
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur lors de la récupération',
          data: [],
        },
      };
    }
  }

  async getOffresByCompany(societeId: string) {
    try {
      const parsedSocieteId = Number(societeId);
      if (!Number.isInteger(parsedSocieteId) || parsedSocieteId <= 0) {
        throw new Error('societeId invalide');
      }

      const { data: offres, error } = await this.supabase
        .from('post')
        .select('*')
        .eq('id', parsedSocieteId)
        .eq('is_archived', false)
        .order('id_line', { ascending: false });

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      const postIds = (offres || [])
        .map((row: any) => Number(row?.id_line ?? row?.id_post ?? 0))
        .filter((id: number) => Number.isInteger(id) && id > 0);
      const candidaturesByPost = await this.getCandidatureCountsByPostIds(postIds, parsedSocieteId);

      return {
        message: 'Offres société récupérées avec succès',
        data: (offres || []).map((row: any) => ({
          id: String(row.id_line ?? row.id),
          id_line: row.id_line,
          societe_id: row.id,
          titre_poste: row['Titre du poste'] ?? row['titre_poste'] ?? '',
          societe: row['Sociéte'] ?? row['Société'] ?? row['Societe'] ?? row['societe'] ?? '',
          exigences: row.Exigences ?? row.exigences ?? '',
          date_creation: row.date_creation ?? new Date().toISOString(),
          feedback_email_sent_at: row.feedback_email_sent_at ?? null,
          candidaturesCount: candidaturesByPost.get(Number(row?.id_line ?? row?.id_post ?? 0)) ?? 0,
          status: 'active',
        })),
      };
    } catch (error) {
      return {
        message: 'Erreur lors de la récupération des offres société',
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur lors de la récupération',
          data: [],
        },
      };
    }
  }

  async declineFeedback(societeId: string, postId: number | string | undefined) {
    try {
      const parsedSocieteId = Number(societeId);
      if (!Number.isInteger(parsedSocieteId) || parsedSocieteId <= 0) {
        throw new Error('societeId invalide');
      }
      const parsedPostId = Number(postId);
      if (!Number.isInteger(parsedPostId) || parsedPostId <= 0) {
        throw new Error('id_post invalide');
      }

      // Resolve the post's current email_round so the decline is tagged to the
      // right feedback cycle. Rows from round N do not block round N+1.
      let emailRound = 1;
      try {
        const { data: postRow } = await this.supabase
          .from('post')
          .select('email_round')
          .eq('id_line', parsedPostId)
          .maybeSingle();
        const parsed = Number(postRow?.email_round ?? 1);
        emailRound = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      } catch {
        // email_round column not yet present — default to 1.
      }

      // PK is now (id_soc, id_post, email_round) so each round's decline is a
      // separate row. Historical rows are never deleted.
      const { error } = await this.supabase
        .from('feedback_declined')
        .upsert(
          [{ id_soc: parsedSocieteId, id_post: parsedPostId, email_round: emailRound }],
          { onConflict: 'id_soc,id_post,email_round' },
        );

      if (error) {
        // Graceful fallback: if email_round column / new PK don't exist yet,
        // fall back to the original two-column upsert.
        if (/email_round/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
          const { error: fallbackError } = await this.supabase
            .from('feedback_declined')
            .upsert(
              [{ id_soc: parsedSocieteId, id_post: parsedPostId }],
              { onConflict: 'id_soc,id_post' },
            );
          if (fallbackError) {
            throw new Error(`Supabase error: ${fallbackError.message}`);
          }
        } else {
          throw new Error(`Supabase error: ${error.message}`);
        }
      }

      return { success: true, message: 'Réponse enregistrée' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de l enregistrement',
      };
    }
  }

  async submitFeedback(societeId: string, payload: Record<string, unknown>) {
    try {
      const parsedSocieteId = Number(societeId);
      if (!Number.isInteger(parsedSocieteId) || parsedSocieteId <= 0) {
        throw new Error('societeId invalide');
      }

      const body: Record<string, unknown> = { ...payload, id_soc: parsedSocieteId };

      // ── Resolve the current email_round for this post and tag the feedback ──
      // This lets getFeedbackEligiblePosts distinguish round-1 submissions from
      // round-2 submissions, so old feedback does not block a new feedback cycle.
      const postIdNum = Number(body['id_post']);
      if (Number.isInteger(postIdNum) && postIdNum > 0) {
        try {
          const { data: postRow } = await this.supabase
            .from('post')
            .select('email_round')
            .eq('id_line', postIdNum)
            .maybeSingle();
          const round = Number(postRow?.email_round ?? 1);
          body['email_round'] = Number.isFinite(round) && round >= 1 ? round : 1;
        } catch {
          // email_round column not yet present — default to 1.
          body['email_round'] = 1;
        }
      }

      const tryInsert = async (row: Record<string, unknown>) => {
        return await this.supabase.from('feedback_societe').insert([row]);
      };

      let { error } = await tryInsert(body);

      // If id_post column doesn't exist yet on this deployment, drop it and retry.
      if (error && /id_post/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
        const { id_post: _drop, ...rest } = body;
        ({ error } = await tryInsert(rest));
      }

      // If email_round column doesn't exist yet, drop it and retry.
      if (error && /email_round/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
        const { email_round: _dropRound, ...rest } = body;
        ({ error } = await tryInsert(rest));
      }

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      if (Number.isInteger(postIdNum) && postIdNum > 0) {
        try {
          await this.supabase
            .from('post')
            .update({ feedback_submitted: true })
            .eq('id_line', postIdNum);
        } catch {
          // feedback_submitted column might be missing — ignore.
        }
      }

      return { success: true, message: 'Feedback enregistré avec succès' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la soumission du feedback',
      };
    }
  }

  async getFeedbackEligiblePosts(societeId: string) {
    try {
      const parsedSocieteId = Number(societeId);
      if (!Number.isInteger(parsedSocieteId) || parsedSocieteId <= 0) {
        throw new Error('societeId invalide');
      }

      const { data: posts, error: postsError } = await this.supabase
        .from('post')
        .select('*')
        .eq('id', parsedSocieteId)
        .eq('is_archived', false)
        .not('feedback_email_sent_at', 'is', null)
        .order('id_line', { ascending: false });

      if (postsError) {
        throw new Error(`Supabase error (post): ${postsError.message}`);
      }

      const eligiblePostIds = (posts || [])
        .map((row: any) => Number(row?.id_line ?? 0))
        .filter((id: number) => Number.isInteger(id) && id > 0);

      // ── Build a map: postId → current email_round ────────────────────────
      // When the scheduler sends a renewal email it increments email_round.
      // We use this to ignore feedback/declines from previous rounds so they
      // do not lock the form for the new round.
      const postRoundMap = new Map<number, number>();
      for (const row of posts ?? []) {
        const idLine = Number(row?.id_line ?? 0);
        if (Number.isInteger(idLine) && idLine > 0) {
          postRoundMap.set(idLine, Number(row?.email_round ?? 1) || 1);
        }
      }

      let submittedIds = new Set<number>();
      if (eligiblePostIds.length > 0) {
        // ── Check feedback_societe, filtering by email_round ────────────────
        // Only feedback rows whose email_round matches (or exceeds) the post's
        // current round count as "already submitted" for this round.
        const { data: feedbackRows, error: feedbackError } = await this.supabase
          .from('feedback_societe')
          .select('id_post, email_round')
          .eq('id_soc', parsedSocieteId)
          .in('id_post', eligiblePostIds);

        if (feedbackError) {
          // id_post / email_round column might not exist yet — treat as no
          // submissions so the form opens; localStorage is client-side fallback.
          // eslint-disable-next-line no-console
          console.warn('[OffresService] feedback_societe lookup skipped:', feedbackError.message);
        } else {
          submittedIds = new Set(
            (feedbackRows || [])
              .filter((row: any) => {
                const postId = Number(row?.id_post);
                if (!Number.isInteger(postId) || postId <= 0) return false;
                // Get the post's current round. Default to 1 if the column
                // does not exist yet (both sides fall back to 1 → equal → counts).
                const postRound = postRoundMap.get(postId) ?? 1;
                const fbRound = Number(row?.email_round ?? 1) || 1;
                // A feedback counts as "done for this round" only if it was
                // submitted in the current round or a later one.
                return fbRound >= postRound;
              })
              .map((row: any) => Number(row?.id_post))
              .filter((id: number) => Number.isInteger(id) && id > 0),
          );
        }

        // ── Check feedback_declined (same round filter as feedback_societe) ───
        // Each decline is now tagged with email_round. Only a decline from the
        // current round (or later) counts as "done". Old round-N declines do not
        // block the round-N+1 feedback window.
        const { data: declinedRows, error: declinedError } = await this.supabase
          .from('feedback_declined')
          .select('id_post, email_round')
          .eq('id_soc', parsedSocieteId)
          .in('id_post', eligiblePostIds);

        if (declinedError) {
          // eslint-disable-next-line no-console
          console.warn('[OffresService] feedback_declined lookup skipped:', declinedError.message);
        } else {
          for (const row of declinedRows || []) {
            const id = Number((row as any)?.id_post);
            if (!Number.isInteger(id) || id <= 0) continue;
            const postRound = postRoundMap.get(id) ?? 1;
            const declineRound = Number((row as any)?.email_round ?? 1) || 1;
            if (declineRound >= postRound) submittedIds.add(id);
          }
        }
      }

      const data = (posts || []).map((row: any) => {
        const idLine = Number(row?.id_line ?? 0);
        return {
          id: String(idLine),
          id_line: idLine,
          titre_poste: row?.['Titre du poste'] ?? row?.['titre_poste'] ?? 'Offre sans titre',
          date_creation: row?.date_creation ?? null,
          feedback_email_sent_at: row?.feedback_email_sent_at ?? null,
          email_round: Number(row?.email_round ?? 1) || 1,
          submitted: submittedIds.has(idLine),
        };
      });

      return {
        message: 'Offres éligibles au feedback récupérées',
        data,
      };
    } catch (error) {
      return {
        message: 'Erreur lors de la récupération des offres éligibles',
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur lors de la récupération',
          data: [],
        },
      };
    }
  }

  async adminUnlockFeedback(postId: string) {
    const idLine = Number(postId);
    if (!Number.isInteger(idLine) || idLine <= 0) {
      return { success: false, error: 'postId invalide' };
    }
    const { error } = await this.supabase
      .from('post')
      .update({ feedback_email_sent_at: new Date().toISOString() })
      .eq('id_line', idLine);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, message: `feedback_email_sent_at set for post id_line=${idLine}` };
  }

  async updateOffre(id: string, data: Partial<any>) {
    try {
      const idLine = Number(id);
      if (!Number.isInteger(idLine) || idLine <= 0) {
        throw new Error('id invalide');
      }

      const updatePayload: Record<string, unknown> = {};
      if (typeof data.titre_poste === 'string') {
        updatePayload['Titre du poste'] = data.titre_poste;
      }
      if (typeof data.exigences === 'string') {
        updatePayload.Exigences = data.exigences;
      }
      if (typeof data.societe === 'string') {
        updatePayload['Sociéte'] = data.societe;
        updatePayload['Société'] = data.societe;
      }

      const { data: offre, error } = await this.supabase
        .from('post')
        .update(updatePayload)
        .eq('id_line', idLine)
        .select();

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      return {
        success: true,
        data: offre?.[0]
          ? {
              id: String(offre[0].id_line ?? offre[0].id),
              id_line: offre[0].id_line,
              societe_id: offre[0].id,
              titre_poste: offre[0]['Titre du poste'] ?? offre[0]['titre_poste'] ?? '',
              societe: offre[0]['Sociéte'] ?? offre[0]['Société'] ?? offre[0]['Societe'] ?? offre[0]['societe'] ?? '',
              exigences: offre[0].Exigences ?? offre[0]['exigences'] ?? '',
              date_creation: offre[0].date_creation ?? new Date().toISOString(),
            }
          : null,
        message: 'Offre mise à jour avec succès',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la mise à jour',
        data: null,
      };
    }
  }

  async getOffreOwningSocieteId(id: string): Promise<number | null> {
    const idLine = Number(id);
    if (!Number.isInteger(idLine) || idLine <= 0) return null;
    const { data, error } = await this.supabase
      .from('post')
      .select('id')
      .eq('id_line', idLine)
      .maybeSingle();
    if (error || !data) return null;
    const owner = Number((data as any).id);
    return Number.isFinite(owner) ? owner : null;
  }

  async deleteOffre(id: string) {
    try {
      const idLine = Number(id);
      if (!Number.isInteger(idLine) || idLine <= 0) {
        throw new Error('id invalide');
      }

      const { error } = await this.supabase
        .from('post')
        .update({ is_archived: true })
        .eq('id_line', idLine);

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      return { success: true, message: 'Offre supprimée avec succès' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la suppression',
      };
    }
  }

  async applyToOffres(data: {
    id_etudiant: number | string;
    applications: ApplyRequest[];
  }) {
    try {
      const studentId = Number(data?.id_etudiant);
      if (!Number.isInteger(studentId) || studentId <= 0) {
        throw new Error('id_etudiant invalide');
      }

      const applications = Array.isArray(data?.applications) ? data.applications : [];
      if (applications.length === 0) {
        throw new Error('Aucune offre sélectionnée');
      }

      const studentIdentity = await this.getStudentIdentity(studentId).catch(() => ({
        id: studentId,
        nom: '',
        prenom: '',
        cinPassport: undefined,
      }));
      const studentProfile = await this
        .getStudentProfile(studentId, studentIdentity.cinPassport)
        .catch(() => ({ ville: '', email: '' }));
      const scoreReference = await this.getScoreReference(studentId).catch(() => ({
        idScore: undefined,
        scoreFinal: 0,
      }));

      let insertedCount = 0;
      let skippedCount = 0;

      for (const application of applications) {
        const post = await this.getPostForApplication(application);
        if (!post) {
          skippedCount += 1;
          continue;
        }

        const idSociete = Number(post.id_societe ?? application.id_societe);
        const idPost = Number(post.id_post);

        if (!Number.isInteger(idSociete) || idSociete <= 0 || !Number.isInteger(idPost) || idPost <= 0) {
          skippedCount += 1;
          continue;
        }

        const exists = await this.applicationExists(idSociete, idPost, studentId);
        if (exists) {
          skippedCount += 1;
          continue;
        }

        const payload: Record<string, unknown> = {
          id_societe: idSociete,
          id_post: idPost,
          id_etudiant: studentId,
          date_creation: new Date().toISOString(),
          nom: studentIdentity.nom,
          prenom: studentIdentity.prenom,
          id_score: scoreReference.idScore,
          score_employabilite: scoreReference.scoreFinal,
          score_ats: null,
          'score ats': null,
          ville: studentProfile.ville,
          email: studentProfile.email,
        };

        await this.insertEtudiantPost(payload);
        insertedCount += 1;
      }

      return {
        success: true,
        data: {
          inserted: insertedCount,
          skipped: skippedCount,
        },
        message: 'Candidature(s) enregistrée(s) avec succès',
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erreur lors de la candidature';
      if (errMsg.toLowerCase().includes('duplicate') || errMsg.toLowerCase().includes('unique constraint') || errMsg.toLowerCase().includes('unique violation')) {
        return { success: true, data: { inserted: 0, skipped: 1 }, message: 'Déjà enregistré' };
      }
      return {
        success: false,
        error: errMsg,
        data: null,
      };
    }
  }

  async getStudentAppliedPostIds(studentId: number): Promise<number[]> {
    const tableCandidates = ['etudiant_post', 'Etudiant_post'];

    for (const tableName of tableCandidates) {
      const { data, error } = await this.supabase
        .from(tableName)
        .select('id_post')
        .eq('id_etudiant', studentId);

      if (error) {
        if (this.isMissingTableError(error.message)) continue;
        throw new Error(`Supabase error: ${error.message}`);
      }

      return (Array.isArray(data) ? data : [])
        .map((row: any) => Number(row?.id_post ?? 0))
        .filter((id: number) => Number.isInteger(id) && id > 0);
    }

    return [];
  }

  async saveSelection(data: { id_etudiant: number | string; id_post: number | string; id_societe?: number | string }) {
    try {
      const studentId = Number(data?.id_etudiant);
      const postId = Number(data?.id_post);
      const societeId = Number(data?.id_societe ?? 0) || undefined;

      if (!Number.isInteger(studentId) || studentId <= 0) {
        throw new Error('id_etudiant invalide');
      }

      if (!Number.isInteger(postId) || postId <= 0) {
        throw new Error('id_post invalide');
      }

      const application = { id_post: postId, id_societe: societeId } as ApplyRequest;
      const post = await this.getPostForApplication(application);
      if (!post) {
        throw new Error('Post introuvable');
      }

      const idSociete = Number(post.id_societe ?? societeId ?? 0);
      const idPost = Number(post.id_post);

      if (!Number.isInteger(idSociete) || idSociete <= 0 || !Number.isInteger(idPost) || idPost <= 0) {
        throw new Error('Informations de post invalides');
      }

      const exists = await this.applicationExists(idSociete, idPost, studentId);
      if (exists) {
        return { success: true, data: { inserted: 0, skipped: 1 }, message: 'Déjà enregistré' };
      }

      const studentIdentity = await this.getStudentIdentity(studentId).catch(() => ({ id: studentId, nom: '', prenom: '', cinPassport: undefined }));
      const studentProfile = await this.getStudentProfile(studentId, studentIdentity.cinPassport).catch(() => ({ ville: '', email: '' }));
      const scoreReference = await this.getScoreReference(studentId).catch(() => ({ idScore: undefined, scoreFinal: 0 }));

      const payload: Record<string, unknown> = {
        id_societe: idSociete,
        id_post: idPost,
        id_etudiant: studentId,
        date_creation: new Date().toISOString(),
        nom: studentIdentity.nom,
        prenom: studentIdentity.prenom,
        id_score: scoreReference.idScore,
        score_employabilite: scoreReference.scoreFinal,
        score_ats: null,
        'score ats': null,
        ville: studentProfile.ville,
        email: studentProfile.email,
      };

      await this.insertEtudiantPost(payload);

      return { success: true, data: { inserted: 1, skipped: 0 }, message: 'Enregistré avec succès' };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erreur lors de l enregistrement';
      // Handle duplicate constraint gracefully
      if (errMsg.includes('duplicate') || errMsg.includes('unique') || errMsg.includes('constraint')) {
        return { success: true, data: { inserted: 0, skipped: 1 }, message: 'Déjà enregistré' };
      }
      return { success: false, error: errMsg, data: null };
    }
  }

  async removeSelection(data: { id_etudiant: number | string; id_post: number | string; id_societe?: number | string }) {
    try {
      const studentId = Number(data?.id_etudiant);
      const postId = Number(data?.id_post);
      const societeId = data?.id_societe !== undefined ? Number(data.id_societe) : undefined;

      if (!Number.isInteger(studentId) || studentId <= 0) {
        throw new Error('id_etudiant invalide');
      }

      if (!Number.isInteger(postId) || postId <= 0) {
        throw new Error('id_post invalide');
      }

      const tableCandidates = ['etudiant_post', 'Etudiant_post'];
      let deleted = false;
      for (const tableName of tableCandidates) {
        let query = this.supabase
          .from(tableName)
          .delete()
          .eq('id_post', postId)
          .eq('id_etudiant', studentId);

        if (Number.isInteger(societeId) && (societeId as number) > 0) {
          query = (query as any).eq('id_societe', societeId as number);
        }

        const { error } = await query;
        if (error) {
          if (this.isMissingTableError(error.message)) {
            continue;
          }
          throw new Error(`Supabase error: ${error.message}`);
        }

        // deletion succeeded (even if 0 rows matched)
        deleted = true;
        break;
      }

      // success regardless of whether record existed
      return { success: true, message: 'Suppression OK' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erreur suppression', data: null };
    }
  }

  async getCompanyCandidatures(societeId: string) {
    try {
      const parsedSocieteId = Number(societeId);
      if (!Number.isInteger(parsedSocieteId) || parsedSocieteId <= 0) {
        throw new Error('societeId invalide');
      }

      const postsById = await this.getCompanyPostsMap(parsedSocieteId);

      const { data: rows, error } = await this.supabase
        .from('etudiant_post')
        .select('*')
        .eq('id_societe', parsedSocieteId)
        .order('date_creation', { ascending: false });

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      const candidatures: CompanyCandidature[] = [];
      const list = Array.isArray(rows) ? rows : [];

      for (const row of list) {
        const idEtudiant = Number(row?.id_etudiant ?? 0);
        const idPost = Number(row?.id_post ?? 0);
        const idSocieteRow = Number(row?.id_societe ?? parsedSocieteId);
        if (!Number.isInteger(idEtudiant) || idEtudiant <= 0 || !Number.isInteger(idPost) || idPost <= 0) {
          continue;
        }

        const studentIdentity = await this.getStudentIdentity(idEtudiant).catch(() => ({
          id: idEtudiant,
          nom: String(row?.nom ?? '').trim(),
          prenom: String(row?.prenom ?? '').trim(),
          cinPassport: undefined,
        }));
        const studentProfile = await this
          .getStudentProfile(idEtudiant, studentIdentity.cinPassport)
          .catch(() => ({ ville: String(row?.ville ?? '').trim(), email: String(row?.email ?? '').trim() }));

        const scoreRaw = row?.score_employabilite ?? row?.score_final;
        const scoreNumber = Number(scoreRaw);
        const idScore = Number(row?.id_score ?? 0);
        const scoreEmployabilite = Number.isFinite(scoreNumber)
          ? Number(scoreNumber.toFixed(2))
          : Number.isFinite(idScore) && idScore > 0
            ? await this.getScoreEmployabiliteByIdScore(idScore)
            : await this.getScoreEmployabilite(idEtudiant);

        const post = postsById.get(idPost);
        if (!post) continue;
        const poste = post.titre_poste || String(row?.poste ?? row?.titre_poste ?? 'Poste').trim();

        candidatures.push({
          id: String(row?.id_line ?? `${idEtudiant}-${idPost}`),
          id_etudiant: idEtudiant,
          id_societe: Number.isInteger(idSocieteRow) && idSocieteRow > 0 ? idSocieteRow : parsedSocieteId,
          id_post: idPost,
          poste,
          nom: String(row?.nom ?? studentIdentity.nom ?? '').trim(),
          prenom: String(row?.prenom ?? studentIdentity.prenom ?? '').trim(),
          email: String(row?.email ?? studentProfile.email ?? '').trim(),
          ville: String(row?.ville ?? studentProfile.ville ?? '').trim(),
          score_employabilite: scoreEmployabilite,
          score_ats: null,
          date_creation: String(row?.date_creation ?? new Date().toISOString()),
          competences: [],
        });
      }

      return {
        message: 'Candidatures récupérées avec succès',
        data: candidatures,
      };
    } catch (error) {
      return {
        message: 'Erreur lors de la récupération des candidatures',
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur lors de la récupération',
          data: [],
        },
      };
    }
  }

  async getCompanyCandidateCv(societeId: string, studentId: string, metierId?: string) {
    try {
      const parsedSocieteId = Number(societeId);
      const parsedStudentId = Number(studentId);

      if (!Number.isInteger(parsedSocieteId) || parsedSocieteId <= 0) {
        throw new Error('societeId invalide');
      }

      if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0) {
        throw new Error('studentId invalide');
      }

      const candidatureExists = await this.companyStudentCandidatureExists(parsedSocieteId, parsedStudentId);
      if (!candidatureExists) {
        throw new Error('Candidature introuvable pour cette société et cet étudiant');
      }

      const authId = await this.resolveStudentAuthId(parsedStudentId);
      if (!authId) {
        return {
          success: true,
          found: false,
          cv: null,
          message: 'Aucun CV généré pour cet étudiant',
        };
      }

      const cv = await this.cvSubmissionService.getCvByAuthId(authId, String(metierId ?? '').trim());
      if (!cv) {
        return {
          success: true,
          found: false,
          cv: null,
          message: 'Aucun CV généré pour cet étudiant',
        };
      }

      return {
        success: true,
        found: true,
        cv,
        message: 'CV récupéré avec succès',
      };
    } catch (error) {
      return {
        success: false,
        found: false,
        cv: null,
        error: error instanceof Error ? error.message : 'Erreur lors de la récupération du CV',
      };
    }
  }

  private async companyStudentCandidatureExists(societeId: number, studentId: number): Promise<boolean> {
    const tableCandidates = ['etudiant_post', 'Etudiant_post'];

    for (const tableName of tableCandidates) {
      const { data, error } = await this.supabase
        .from(tableName)
        .select('id_line')
        .eq('id_societe', societeId)
        .eq('id_etudiant', studentId)
        .limit(1);

      if (error) {
        if (this.isMissingTableError(error.message)) {
          continue;
        }
        throw new Error(`Supabase error: ${error.message}`);
      }

      if (Array.isArray(data) && data.length > 0) {
        return true;
      }
    }

    return false;
  }

  private async resolveStudentAuthId(studentId: number): Promise<string | null> {
    const byId = await this.supabase
      .from('user')
      .select('auth_id, cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    if (byId.error) {
      throw new Error(`Supabase error: ${byId.error.message}`);
    }

    const authIdById = String(byId.data?.auth_id ?? '').trim();
    if (authIdById) {
      return authIdById;
    }

    const cinPassport = Number(byId.data?.cin_passport ?? 0);
    if (!Number.isFinite(cinPassport) || cinPassport <= 0) {
      return null;
    }

    const byCin = await this.supabase
      .from('user')
      .select('auth_id')
      .eq('cin_passport', cinPassport)
      .maybeSingle();

    if (byCin.error) {
      throw new Error(`Supabase error: ${byCin.error.message}`);
    }

    const authIdByCin = String(byCin.data?.auth_id ?? '').trim();
    return authIdByCin || null;
  }

  private async getCompanyPostsMap(societeId: number): Promise<Map<number, { titre_poste: string }>> {
    const map = new Map<number, { titre_poste: string }>();

    const { data: posts, error } = await this.supabase
      .from('post')
      .select('*')
      .eq('id', societeId)
      .eq('is_archived', false);

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    const list = Array.isArray(posts) ? posts : [];
    for (const row of list) {
      const idLine = Number(row?.id_line ?? row?.id_post ?? 0);
      if (!Number.isInteger(idLine) || idLine <= 0) {
        continue;
      }
      const titre = String(row?.['Titre du poste'] ?? row?.titre_poste ?? '').trim();
      map.set(idLine, { titre_poste: titre || 'Poste' });
    }

    return map;
  }

  private async getCandidatureCountsByPostIds(
    postIds: number[],
    societeId?: number,
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (!postIds.length) {
      return counts;
    }

    const tableCandidates = ['etudiant_post', 'Etudiant_post'];

    for (const tableName of tableCandidates) {
      let query = this.supabase
        .from(tableName)
        .select('id_post, id_societe')
        .in('id_post', postIds);

      if (Number.isInteger(societeId) && (societeId as number) > 0) {
        query = query.eq('id_societe', societeId as number);
      }

      const { data, error } = await query;

      if (error) {
        if (this.isMissingTableError(error.message)) {
          continue;
        }
        throw new Error(`Supabase error: ${error.message}`);
      }

      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const idPost = Number((row as any)?.id_post ?? 0);
        if (!Number.isInteger(idPost) || idPost <= 0) {
          continue;
        }
        counts.set(idPost, (counts.get(idPost) ?? 0) + 1);
      }

      return counts;
    }

    return counts;
  }

  private async getPostForApplication(application: ApplyRequest): Promise<{ id_societe: number; id_post: number } | null> {
    const requestedPostId = Number(application?.id_post);
    if (!Number.isInteger(requestedPostId) || requestedPostId <= 0) {
      return null;
    }

    const { data, error } = await this.supabase
      .from('post')
      .select('*')
      .eq('id_line', requestedPostId)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    const idSociete = Number(data?.id ?? application?.id_societe);
    const idPost = Number(data?.id_line ?? requestedPostId);

    if (!Number.isInteger(idSociete) || idSociete <= 0 || !Number.isInteger(idPost) || idPost <= 0) {
      return null;
    }

    return {
      id_societe: idSociete,
      id_post: idPost,
    };
  }

  private async applicationExists(idSociete: number, idPost: number, idEtudiant: number): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('etudiant_post')
      .select('id_line')
      .eq('id_societe', idSociete)
      .eq('id_post', idPost)
      .eq('id_etudiant', idEtudiant)
      .maybeSingle();

    if (error) {
      return false;
    }

    return !!data;
  }

  private async insertEtudiantPost(payload: Record<string, unknown>): Promise<void> {
    const tableCandidates = ['etudiant_post', 'Etudiant_post'];
    let lastError: Error | null = null;

    for (const tableName of tableCandidates) {
      let workingPayload: Record<string, unknown> = { ...payload };

      for (let retry = 0; retry < 12; retry += 1) {
        const { error } = await this.supabase
          .from(tableName)
          .insert([workingPayload]);

        if (!error) {
          return;
        }

        const msg = String(error.message ?? '').toLowerCase();
        const tableMissing = msg.includes('relation') && msg.includes('does not exist');
        if (tableMissing) {
          lastError = new Error(`Supabase error: ${error.message}`);
          break;
        }

        const isDuplicate = msg.includes('duplicate') || msg.includes('unique constraint') || msg.includes('unique violation');
        if (isDuplicate) {
          return;
        }

        const missingColumn = this.extractMissingColumn(error.message);
        if (!missingColumn) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        if (!(missingColumn in workingPayload)) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        delete workingPayload[missingColumn];
      }
    }

    throw lastError ?? new Error('Table etudiant_post introuvable');
  }

  private extractMissingColumn(message: string): string | null {
    const match = message.match(/column\s+"([^"]+)"\s+does not exist/i);
    if (match?.[1]) {
      return match[1];
    }

    const simple = message.match(/column\s+([a-zA-Z0-9_\s]+)\s+does not exist/i);
    if (simple?.[1]) {
      return simple[1].trim();
    }

    const schemaCacheSingleQuoted = message.match(/could not find the\s+'([^']+)'\s+column\s+of\s+'[^']+'\s+in the schema cache/i);
    if (schemaCacheSingleQuoted?.[1]) {
      return schemaCacheSingleQuoted[1].trim();
    }

    const schemaCacheDoubleQuoted = message.match(/could not find the\s+"([^"]+)"\s+column\s+of\s+"[^"]+"\s+in the schema cache/i);
    if (schemaCacheDoubleQuoted?.[1]) {
      return schemaCacheDoubleQuoted[1].trim();
    }

    return null;
  }

  private async getStudentIdentity(studentId: number): Promise<StudentIdentity> {
    const tableCandidates = ['etudiant', 'Etudiant'];

    for (const tableName of tableCandidates) {
      const { data, error } = await this.supabase
        .from(tableName)
        .select('*')
        .eq('id', studentId)
        .maybeSingle();

      if (error) {
        const tableMissing = this.isMissingTableError(error.message);
        if (tableMissing) {
          continue;
        }
        throw new Error(`Supabase error: ${error.message}`);
      }

      if (data) {
        return {
          id: studentId,
          nom: String(data?.nom ?? '').trim(),
          prenom: String(data?.prenom ?? '').trim(),
          cinPassport: Number(data?.cin_passport ?? data?.cinPassport ?? 0) || undefined,
        };
      }
    }

    const profileById = await this.supabase
      .from('profils_etudiant')
      .select('nom, prenom, cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    if (!profileById.error && profileById.data) {
      return {
        id: studentId,
        nom: String(profileById.data?.nom ?? '').trim(),
        prenom: String(profileById.data?.prenom ?? '').trim(),
        cinPassport: Number(profileById.data?.cin_passport ?? 0) || undefined,
      };
    }

    const userById = await this.supabase
      .from('user')
      .select('cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    const cinPassport = Number(userById.data?.cin_passport ?? 0) || undefined;
    if (cinPassport) {
      const profileByCin = await this.supabase
        .from('profils_etudiant')
        .select('nom, prenom, cin_passport')
        .eq('cin_passport', cinPassport)
        .maybeSingle();

      if (!profileByCin.error && profileByCin.data) {
        return {
          id: studentId,
          nom: String(profileByCin.data?.nom ?? '').trim(),
          prenom: String(profileByCin.data?.prenom ?? '').trim(),
          cinPassport,
        };
      }
    }

    throw new Error('Etudiant introuvable');
  }

  private async getStudentProfile(studentId: number, cinPassport?: number): Promise<StudentProfile> {
    const queryById = await this.supabase
      .from('profils_etudiant')
      .select('ville, email')
      .eq('id', studentId)
      .maybeSingle();

    if (!queryById.error && queryById.data) {
      return {
        ville: String(queryById.data?.ville ?? '').trim(),
        email: String(queryById.data?.email ?? '').trim(),
      };
    }

    if (cinPassport) {
      const queryByCin = await this.supabase
        .from('profils_etudiant')
        .select('ville, email')
        .eq('cin_passport', cinPassport)
        .maybeSingle();

      if (!queryByCin.error && queryByCin.data) {
        return {
          ville: String(queryByCin.data?.ville ?? '').trim(),
          email: String(queryByCin.data?.email ?? '').trim(),
        };
      }
    }

    return { ville: '', email: '' };
  }

  private async getScoreEmployabilite(studentId: number): Promise<number> {
    const scoreReference = await this.getScoreReference(studentId);
    return scoreReference.scoreFinal;
  }

  private async getScoreReference(studentId: number): Promise<{ idScore?: number; scoreFinal: number }> {
    const linkedIdScore = await this.resolveLinkedIdScore(studentId);
    if (linkedIdScore) {
      const linkedScore = await this.getScoreReferenceByIdScore(linkedIdScore);
      if (linkedScore) {
        return linkedScore;
      }
    }

    const tableCandidates = ['score_employabilité', 'score_employabilite'];
    const columnCandidates = ['etudiant', 'id_etudiant', 'cin_passport'];
    const lookupKeys = await this.resolveStudentLookupKeys(studentId);

    for (const tableName of tableCandidates) {
      for (const columnName of columnCandidates) {
        for (const lookupKey of lookupKeys) {
          const result = await this.fetchScoreReferenceByLookup(tableName, columnName, lookupKey);
          if (result.kind === 'schema-mismatch') {
            continue;
          }
          if (result.kind === 'found') {
            return {
              idScore: result.idScore,
              scoreFinal: Number(result.value.toFixed(2)),
            };
          }
        }
      }
    }

    return { scoreFinal: 0 };
  }

  private async resolveLinkedIdScore(studentId: number): Promise<number | undefined> {
    const profile = await this.supabase
      .from('profils_etudiant')
      .select('id_score')
      .eq('id', studentId)
      .maybeSingle();

    const fromProfileById = Number(profile.data?.id_score ?? 0);
    if (Number.isFinite(fromProfileById) && fromProfileById > 0) {
      return fromProfileById;
    }

    const userById = await this.supabase
      .from('user')
      .select('cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    const cinPassport = Number(userById.data?.cin_passport ?? 0);
    if (!Number.isFinite(cinPassport) || cinPassport <= 0) {
      return undefined;
    }

    const profileByCin = await this.supabase
      .from('profils_etudiant')
      .select('id_score')
      .eq('cin_passport', cinPassport)
      .maybeSingle();

    const fromProfileByCin = Number(profileByCin.data?.id_score ?? 0);
    if (Number.isFinite(fromProfileByCin) && fromProfileByCin > 0) {
      return fromProfileByCin;
    }

    return undefined;
  }

  private async getScoreReferenceByIdScore(idScore: number): Promise<{ idScore?: number; scoreFinal: number } | null> {
    const tableCandidates = ['score_employabilité', 'score_employabilite'];
    const idColumns = ['id_score', 'id_line', 'id'];

    for (const tableName of tableCandidates) {
      for (const idColumn of idColumns) {
        const result = await this.fetchScoreReferenceByLookup(tableName, idColumn, idScore);
        if (result.kind === 'schema-mismatch') {
          continue;
        }
        if (result.kind === 'found') {
          return {
            idScore: result.idScore,
            scoreFinal: Number(result.value.toFixed(2)),
          };
        }
      }
    }

    return null;
  }

  private async getScoreEmployabiliteByIdScore(idScore: number): Promise<number> {
    const tableCandidates = ['score_employabilité', 'score_employabilite'];
    const idColumns = ['id_score', 'id_line', 'id'];

    for (const tableName of tableCandidates) {
      for (const idColumn of idColumns) {
        const result = await this.fetchScoreReferenceByLookup(tableName, idColumn, idScore);
        if (result.kind === 'schema-mismatch') {
          continue;
        }
        if (result.kind === 'found') {
          return Number(result.value.toFixed(2));
        }
      }
    }

    return 0;
  }

  private async resolveStudentLookupKeys(studentId: number): Promise<Array<number | string>> {
    const keys: Array<number | string> = [studentId, String(studentId)];

    const profileById = await this.supabase
      .from('profils_etudiant')
      .select('id, cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    const profileIdById = Number(profileById.data?.id ?? 0);
    if (Number.isFinite(profileIdById) && profileIdById > 0) {
      keys.push(profileIdById, String(profileIdById));
    }

    const profileCinById = Number(profileById.data?.cin_passport ?? 0);
    if (Number.isFinite(profileCinById) && profileCinById > 0) {
      keys.push(profileCinById, String(profileCinById));
    }

    const { data: userRow } = await this.supabase
      .from('user')
      .select('cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    const cinFromUser = Number(userRow?.cin_passport ?? 0);
    if (Number.isFinite(cinFromUser) && cinFromUser > 0) {
      keys.push(cinFromUser, String(cinFromUser));

      const profileByCin = await this.supabase
        .from('profils_etudiant')
        .select('id, cin_passport')
        .eq('cin_passport', cinFromUser)
        .maybeSingle();

      const profileIdByCin = Number(profileByCin.data?.id ?? 0);
      if (Number.isFinite(profileIdByCin) && profileIdByCin > 0) {
        keys.push(profileIdByCin, String(profileIdByCin));
      }

      const profileCinByCin = Number(profileByCin.data?.cin_passport ?? 0);
      if (Number.isFinite(profileCinByCin) && profileCinByCin > 0) {
        keys.push(profileCinByCin, String(profileCinByCin));
      }
    }

    const { data: profileRow } = await this.supabase
      .from('profils_etudiant')
      .select('id, cin_passport')
      .eq('id', studentId)
      .maybeSingle();

    const profileId = Number(profileRow?.id ?? 0);
    if (Number.isFinite(profileId) && profileId > 0) {
      keys.push(profileId, String(profileId));
    }

    const cinFromProfile = Number(profileRow?.cin_passport ?? 0);
    if (Number.isFinite(cinFromProfile) && cinFromProfile > 0) {
      keys.push(cinFromProfile, String(cinFromProfile));
    }

    return [...new Set(keys.filter((value) => String(value).trim().length > 0))];
  }

  private async fetchScoreReferenceByLookup(
    tableName: string,
    columnName: string,
    lookupKey: number | string,
  ): Promise<
    | { kind: 'found'; value: number; idScore?: number }
    | { kind: 'not-found' }
    | { kind: 'schema-mismatch' }
  > {
    const withDateOrder = await this.supabase
      .from(tableName)
      .select('*')
      .eq(columnName, lookupKey)
      .order('date_creation', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!withDateOrder.error) {
      const value = Number(withDateOrder.data?.score_final);
      if (Number.isFinite(value)) {
        return {
          kind: 'found',
          value,
          idScore: this.extractScoreRowId(withDateOrder.data),
        };
      }
      return { kind: 'not-found' };
    }

    const firstErrorMessage = String(withDateOrder.error.message ?? '');
    const missingTable = this.isMissingTableError(firstErrorMessage);
    if (missingTable) {
      return { kind: 'schema-mismatch' };
    }

    const withoutDateOrder = await this.supabase
      .from(tableName)
      .select('*')
      .eq(columnName, lookupKey)
      .limit(1)
      .maybeSingle();

    if (withoutDateOrder.error) {
      const fallbackMessage = String(withoutDateOrder.error.message ?? '');
      const fallbackMissingTable = this.isMissingTableError(fallbackMessage);
      const fallbackMissingColumn = this.isMissingColumnError(fallbackMessage);
      if (fallbackMissingTable || fallbackMissingColumn) {
        return { kind: 'schema-mismatch' };
      }
      throw new Error(`Supabase error: ${withoutDateOrder.error.message}`);
    }

    const fallbackValue = Number(withoutDateOrder.data?.score_final);
    if (Number.isFinite(fallbackValue)) {
      return {
        kind: 'found',
        value: fallbackValue,
        idScore: this.extractScoreRowId(withoutDateOrder.data),
      };
    }

    return { kind: 'not-found' };
  }

  private extractScoreRowId(row: any): number | undefined {
    const raw = row?.id_score ?? row?.id_line ?? row?.id;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return undefined;
  }

  private async checkSocieteExists(societeId: number): Promise<boolean> {
    const tableCandidates = ['Societe', 'societe'];

    for (const tableName of tableCandidates) {
      const { data, error } = await this.supabase
        .from(tableName)
        .select('id')
        .eq('id', societeId)
        .maybeSingle();

      if (error) {
        const tableMissing = this.isMissingTableError(error.message);
        if (tableMissing) {
          continue;
        }
        throw new Error(`Supabase error: ${error.message}`);
      }

      if (data?.id !== undefined && data?.id !== null) {
        return true;
      }
    }

    return false;
  }

  private async insertPostWithColumnFallbacks(input: {
    societeId: number;
    titre_poste: string;
    exigences: string;
    societe: string;
  }): Promise<any> {
    const titleColumns = ['Titre du poste', 'titre_poste'];
    const exigencesColumns = ['Exigences', 'exigences'];
    const societeColumns = ['Sociéte', 'Société', 'Societe', 'societe'];
    let lastError: Error | null = null;

    for (const titleCol of titleColumns) {
      for (const exigCol of exigencesColumns) {
        for (const socCol of societeColumns) {
          const payload: Record<string, unknown> = {
            id: input.societeId,
            [titleCol]: input.titre_poste,
            [exigCol]: input.exigences,
            [socCol]: input.societe,
            date_creation: new Date().toISOString(),
          };

          const { data, error } = await this.supabase
            .from('post')
            .insert([payload])
            .select('*')
            .single();

          if (!error) {
            return data;
          }

          lastError = new Error(`Supabase error: ${error.message}`);
          const msg = error.message.toLowerCase();
          const columnError = msg.includes('column') || msg.includes('schema cache') || msg.includes('does not exist');
          if (!columnError) {
            throw lastError;
          }
        }
      }
    }

    throw lastError ?? new Error('Supabase error: insert impossible sur la table post');
  }

  private isMissingTableError(message: string): boolean {
    const normalized = String(message ?? '').toLowerCase();
    return (
      (normalized.includes('relation') && normalized.includes('does not exist'))
      || (normalized.includes('could not find the table') && normalized.includes('schema cache'))
    );
  }

  private isMissingColumnError(message: string): boolean {
    const normalized = String(message ?? '').toLowerCase();
    return normalized.includes('column') && normalized.includes('does not exist');
  }
}
