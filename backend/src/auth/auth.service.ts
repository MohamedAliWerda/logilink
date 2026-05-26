import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { getSupabase } from '../config/supabase.client';
import { SignInDto } from './dto/signin.dto';
import { SignInEntrepriseDto } from './dto/signin-entreprise.dto';
import { ChallengeAccount, TwoFactorService } from './two-factor.service';
import { MailService } from '../admin/mail.service';

type UserRecord = {
  id: string;
  cin_passport: string;
  email: string;
  mot_de_passe: string;
  role: 'admin' | 'etudiant';
  auth_id?: string;
};

type ProfileEtudiantRecord = {
  nom?: string;
  prenom?: string;
  cin_passport?: number | string;
  nationalite?: string;
  ville?: string;
  sexe?: string;
  ville_naissance?: string;
  adresse?: string;
  code_postal?: number | string;
  telephone?: number | string;
  groupe?: string;
  niveau?: number | string;
  filiere?: string;
  departement?: string;
};

type SocieteRecord = {
  id: number | string;
  email: string;
  mot_de_passe: string;
  denomination_sociale?: string;
  situation?: string;
  [key: string]: unknown;
};

function looksLikeBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

type ResetEntry = { code: string; expiresAt: number };

@Injectable()
export class AuthService {
  private readonly resetCodes = new Map<string, ResetEntry>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly twoFactor: TwoFactorService,
    private readonly mailService: MailService,
  ) {}

  async signIn(signInDto: SignInDto) {
    const cinPassportValue = Number(signInDto.cin_passport.trim());
    if (!Number.isFinite(cinPassportValue)) {
      throw new UnauthorizedException('Ce compte n\'existe pas.');
    }

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('user')
      .select('id, cin_passport, email, mot_de_passe, role, auth_id')
      .eq('cin_passport', cinPassportValue)
      .maybeSingle<UserRecord>();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!user) {
      throw new UnauthorizedException('Ce compte n\'existe pas.');
    }

    const passwordMatches = looksLikeBcryptHash(user.mot_de_passe)
      ? await bcrypt.compare(signInDto.mot_de_passe, user.mot_de_passe)
      : signInDto.mot_de_passe === user.mot_de_passe;

    if (!passwordMatches) {
      throw new UnauthorizedException('Mot de passe incorrect.');
    }

    if (!user.email) {
      throw new InternalServerErrorException(
        'Aucune adresse email enregistrée pour ce compte. Contactez un administrateur.',
      );
    }

    const account: ChallengeAccount = {
      kind: 'user',
      id: user.id,
      auth_id: user.auth_id,
      cin_passport: user.cin_passport,
      email: user.email,
      role: user.role,
    };

    const { challengeId, maskedEmail } = await this.twoFactor.createChallenge(account);

    return {
      message: 'Un code de vérification vous a été envoyé par email.',
      data: {
        challengeId,
        email: maskedEmail,
        type: user.role,
      },
    };
  }

  async signInEntreprise(dto: SignInEntrepriseDto) {
    const supabase = getSupabase();
    const email = dto.email.trim().toLowerCase();

    const { data: societe, error } = await supabase
      .from('Societe')
      .select('*')
      .ilike('email', email)
      .maybeSingle<SocieteRecord>();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!societe) {
      throw new UnauthorizedException('Cet email n\'existe pas.');
    }

    const passwordMatches = looksLikeBcryptHash(societe.mot_de_passe)
      ? await bcrypt.compare(dto.mot_de_passe, societe.mot_de_passe)
      : dto.mot_de_passe === societe.mot_de_passe;

    if (!passwordMatches) {
      throw new UnauthorizedException('Le mot de passe est incorrect.');
    }

    const situation = (societe.situation ?? '').toString().toLowerCase();
    if (situation.includes('en attente') || situation.includes('en_attente')) {
      throw new ForbiddenException(
        "Votre compte est en attente de validation par un administrateur. L'accès est bloqué jusqu'à la validation.",
      );
    }

    if (!(situation.includes('valid'))) {
      throw new ForbiddenException(
        "Votre compte n'est pas autorisé à accéder pour le moment.",
      );
    }

    if (!societe.email) {
      throw new InternalServerErrorException('Aucune adresse email enregistrée pour cette société.');
    }

    const account: ChallengeAccount = {
      kind: 'entreprise',
      id: societe.id,
      email: societe.email,
      societe,
    };

    const { challengeId, maskedEmail } = await this.twoFactor.createChallenge(account);

    return {
      message: 'Un code de vérification a été envoyé à votre adresse email.',
      data: {
        challengeId,
        email: maskedEmail,
        type: 'entreprise',
      },
    };
  }

  async verifyTwoFactor(challengeId: string, code: string) {
    let account: ChallengeAccount;
    try {
      account = this.twoFactor.consume(challengeId, code);
    } catch (err) {
      const reason = (err as Error)?.message;
      if (reason === 'CODE_EXPIRED') {
        throw new UnauthorizedException('Le code a expiré. Veuillez recommencer la connexion.');
      }
      if (reason === 'TOO_MANY_ATTEMPTS') {
        throw new UnauthorizedException('Trop de tentatives. Veuillez recommencer la connexion.');
      }
      if (reason === 'CODE_INVALID') {
        throw new UnauthorizedException('Code invalide.');
      }
      throw new BadRequestException('Vérification impossible.');
    }

    if (account.kind === 'user') {
      return this.buildUserSession(account);
    }

    return this.buildEntrepriseSession(account);
  }

  async resendTwoFactor(challengeId: string) {
    try {
      const { maskedEmail } = await this.twoFactor.resend(challengeId);
      return {
        message: 'Un nouveau code a été envoyé.',
        data: { email: maskedEmail },
      };
    } catch (err) {
      const reason = (err as Error)?.message;
      if (reason === 'CODE_EXPIRED') {
        throw new UnauthorizedException('La session de vérification a expiré.');
      }
      if (reason === 'RESEND_COOLDOWN') {
        throw new BadRequestException('Veuillez patienter avant de demander un nouveau code.');
      }
      throw new InternalServerErrorException('Impossible d\'envoyer le code.');
    }
  }

  private async buildUserSession(
    account: Extract<ChallengeAccount, { kind: 'user' }>,
  ) {
    const supabase = getSupabase();
    const cinPassportValue = Number(account.cin_passport);

    const payload = {
      sub: account.auth_id ?? String(account.id),
      id: String(account.id),
      cin_passport: account.cin_passport,
      role: account.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    const { data: profile, error: profileError } = await supabase
      .from('profils_etudiant')
      .select('*')
      .eq('cin_passport', cinPassportValue)
      .maybeSingle<ProfileEtudiantRecord>();

    if (profileError) {
      throw new InternalServerErrorException(profileError.message);
    }

    return {
      message: 'Login successful',
      data: {
        access_token: accessToken,
        user: {
          id: account.id,
          auth_id: account.auth_id,
          email: account.email,
          role: account.role,
          cin_passport: account.cin_passport,
          ...(profile ?? {}),
        },
      },
    };
  }

  private async buildEntrepriseSession(
    account: Extract<ChallengeAccount, { kind: 'entreprise' }>,
  ) {
    const payload = {
      sub: String(account.id),
      email: account.email,
      role: 'entreprise' as const,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      message: 'Login successful',
      data: {
        access_token: accessToken,
        role: 'entreprise',
        entreprise: account.societe,
      },
    };
  }

  async forgotPasswordEntreprise(email: string) {
    const supabase = getSupabase();
    const normalized = email.trim().toLowerCase();

    const { data: societe, error } = await supabase
      .from('Societe')
      .select('id, email, denomination_sociale')
      .ilike('email', normalized)
      .maybeSingle<{ id: number; email: string; denomination_sociale?: string }>();

    if (error) throw new InternalServerErrorException(error.message);
    if (!societe) throw new NotFoundException('Aucun compte trouvé avec cet email.');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.resetCodes.set(normalized, { code, expiresAt: Date.now() + 10 * 60 * 1000 });

    const companyName = societe.denomination_sociale || normalized;
    await this.mailService.sendResetCode(societe.email, companyName, code);

    return { message: 'Un code de vérification a été envoyé à votre adresse email.' };
  }

  async verifyResetCodeEntreprise(email: string, code: string) {
    const normalized = email.trim().toLowerCase();
    const entry = this.resetCodes.get(normalized);

    if (!entry) throw new BadRequestException('Aucune demande de réinitialisation en cours.');
    if (Date.now() > entry.expiresAt) {
      this.resetCodes.delete(normalized);
      throw new BadRequestException('Le code a expiré. Veuillez recommencer.');
    }
    if (entry.code !== code.trim()) throw new UnauthorizedException('Code incorrect.');

    return { message: 'Code valide.' };
  }

  async resetPasswordEntreprise(email: string, code: string, newPassword: string) {
    const normalized = email.trim().toLowerCase();
    const entry = this.resetCodes.get(normalized);

    if (!entry) throw new BadRequestException('Aucune demande de réinitialisation en cours.');
    if (Date.now() > entry.expiresAt) {
      this.resetCodes.delete(normalized);
      throw new BadRequestException('Le code a expiré. Veuillez recommencer.');
    }
    if (entry.code !== code.trim()) throw new UnauthorizedException('Code incorrect.');

    const supabase = getSupabase();
    const hashed = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from('Societe')
      .update({ mot_de_passe: hashed })
      .ilike('email', normalized);

    if (error) throw new InternalServerErrorException(error.message);

    this.resetCodes.delete(normalized);
    return { message: 'Mot de passe réinitialisé avec succès.' };
  }
}
