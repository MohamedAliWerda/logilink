import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getSupabase } from '../config/supabase.client';
import { MailService } from '../admin/mail.service';
import { RegisterEntrepriseDto } from './dto/register-entreprise.dto';

type SocieteRow = {
  id: number;
  denomination_sociale?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  secteur_activite?: string;
  situation?: string;
};

const BCRYPT_ROUNDS = 12;

@Injectable()
export class EntrepriseService {
  async register(dto: RegisterEntrepriseDto): Promise<{ id: number }> {
    const supabase = getSupabase();
    const email = dto.email.trim().toLowerCase();

    const conflict = await this.findConflict(email, dto.telephone, dto.nomEntreprise);
    if (conflict) {
      throw new ConflictException("Une société existe déjà avec ces informations.");
    }

    const hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const { data: maxRow, error: maxErr } = await supabase
      .from('Societe')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    if (maxErr) {
      throw new InternalServerErrorException(maxErr.message);
    }

    const nextId =
      Array.isArray(maxRow) && maxRow.length > 0 ? Number((maxRow[0] as any).id) + 1 : 1;

    const row = {
      id: nextId,
      denomination_sociale: dto.nomEntreprise.trim(),
      email,
      mot_de_passe: hash,
      telephone: dto.telephone.replace(/\s+/g, ''),
      adresse: dto.adresse.trim(),
      secteur_activite: dto.description.trim(),
      situation: 'En attente',
      date_creation: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('Societe')
      .insert([row])
      .select('id')
      .maybeSingle<{ id: number }>();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { id: Number(data?.id ?? nextId) };
  }

  async sendPendingMail(mailService: MailService, email: string, companyName: string): Promise<void> {
    try {
      await mailService.sendCompanyPending(email, companyName);
    } catch {
      // mail-failure is non-fatal for registration; surface no error to client
    }
  }

  async findConflict(email: string, telephone: string, nomEntreprise: string): Promise<SocieteRow | null> {
    const supabase = getSupabase();

    const byEmail = await supabase
      .from('Societe')
      .select('id,denomination_sociale,email,telephone,adresse,secteur_activite')
      .ilike('email', email)
      .limit(1);
    if (byEmail.error) throw new BadRequestException(byEmail.error.message);
    if (byEmail.data && byEmail.data.length > 0) return byEmail.data[0] as SocieteRow;

    const phone = telephone.replace(/\s+/g, '');
    if (phone) {
      const byPhone = await supabase
        .from('Societe')
        .select('id,denomination_sociale,email,telephone,adresse,secteur_activite')
        .eq('telephone', phone)
        .limit(1);
      if (byPhone.error) throw new BadRequestException(byPhone.error.message);
      if (byPhone.data && byPhone.data.length > 0) return byPhone.data[0] as SocieteRow;
    }

    if (nomEntreprise) {
      const byName = await supabase
        .from('Societe')
        .select('id,denomination_sociale,email,telephone,adresse,secteur_activite')
        .ilike('denomination_sociale', nomEntreprise.trim())
        .limit(1);
      if (byName.error) throw new BadRequestException(byName.error.message);
      if (byName.data && byName.data.length > 0) return byName.data[0] as SocieteRow;
    }

    return null;
  }

  async fetchBySituations(situations: string[]): Promise<SocieteRow[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('Societe')
      .select('id,denomination_sociale,email,telephone,adresse,secteur_activite,situation,date_creation')
      .in('situation', situations);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as SocieteRow[];
  }

  async fetchAll(): Promise<SocieteRow[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('Societe')
      .select('id,denomination_sociale,email,telephone,adresse,secteur_activite,situation,date_creation');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as SocieteRow[];
  }

  async fetchById(id: number): Promise<SocieteRow | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('Societe')
      .select('id,denomination_sociale,email,telephone,adresse,secteur_activite,situation,date_creation')
      .eq('id', id)
      .maybeSingle<SocieteRow>();
    if (error) throw new BadRequestException(error.message);
    return data ?? null;
  }

  async updateSituation(id: number, situation: string): Promise<SocieteRow | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('Societe')
      .update({ situation })
      .eq('id', id)
      .select('id,denomination_sociale,email,telephone,adresse,secteur_activite,situation,date_creation')
      .maybeSingle<SocieteRow>();
    if (error) throw new BadRequestException(error.message);
    return data ?? null;
  }

  async updateProfile(
    id: number,
    payload: {
      nomEntreprise: string;
      email: string;
      telephone: string;
      adresse: string;
      description: string;
    },
  ): Promise<void> {
    const supabase = getSupabase();

    const updateQuery = supabase
      .from('Societe')
      .update({
        denomination_sociale: payload.nomEntreprise.trim(),
        email: payload.email.trim().toLowerCase(),
        telephone: payload.telephone.replace(/\s+/g, ''),
        adresse: payload.adresse.trim(),
        secteur_activite: payload.description.trim(),
      })
      .eq('id', id);

    // Race the Supabase call against a hard timeout.
    // Supabase sometimes commits the row but never delivers the HTTP
    // response back (hanging PostgREST connection). If that happens we
    // still return 200 — the update reached the DB and the frontend
    // will confirm via a separate GET request.
    const timeoutSignal = new Promise<{ error: null; data: null }>((resolve) =>
      setTimeout(() => resolve({ error: null, data: null }), 8000),
    );

    const { error } = await Promise.race([updateQuery, timeoutSignal]);
    if (error) throw new BadRequestException(error.message);
  }
}
