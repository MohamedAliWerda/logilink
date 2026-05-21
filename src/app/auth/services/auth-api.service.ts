import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

type UserRole = 'admin' | 'etudiant' | 'entreprise';

type UserProfilePayload = {
  id: string;
  cin_passport: string;
  email: string;
  role: UserRole;
  nom?: string;
  prenom?: string;
  nationalite?: string;
  ville?: string;
  sexe?: string;
  ville_naissance?: string;
  adresse?: string;
  code_postal?: string | number;
  telephone?: string | number;
  groupe?: string;
  niveau?: string | number;
  filiere?: string;
  departement?: string;
};

export type TwoFactorChallengeResponse = {
  message: string;
  data: {
    challengeId: string;
    email: string;
    type: UserRole;
  };
};

export type VerifyTwoFactorResponse = {
  message: string;
  data: {
    access_token: string;
    role?: UserRole;
    user?: UserProfilePayload;
    entreprise?: Record<string, any>;
  };
};

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly apiBaseUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  signIn(cinPassport: string, motDePasse: string): Promise<TwoFactorChallengeResponse> {
    return firstValueFrom(
      this.http.post<TwoFactorChallengeResponse>(`${this.apiBaseUrl}/auth/signin`, {
        cin_passport: cinPassport,
        mot_de_passe: motDePasse,
      }),
    );
  }

  signInEntreprise(email: string, motDePasse: string): Promise<TwoFactorChallengeResponse> {
    return firstValueFrom(
      this.http.post<TwoFactorChallengeResponse>(`${this.apiBaseUrl}/auth/signin-entreprise`, {
        email,
        mot_de_passe: motDePasse,
      }),
    );
  }

  verifyTwoFactor(challengeId: string, code: string): Promise<VerifyTwoFactorResponse> {
    return firstValueFrom(
      this.http.post<VerifyTwoFactorResponse>(`${this.apiBaseUrl}/auth/verify-2fa`, {
        challengeId,
        code,
      }),
    );
  }

  resendTwoFactor(challengeId: string): Promise<{ message: string; data: { email: string } }> {
    return firstValueFrom(
      this.http.post<{ message: string; data: { email: string } }>(
        `${this.apiBaseUrl}/auth/resend-2fa`,
        { challengeId },
      ),
    );
  }

  forgotPasswordEntreprise(email: string): Promise<{ message: string }> {
    return firstValueFrom(
      this.http.post<{ message: string }>(`${this.apiBaseUrl}/auth/forgot-password-entreprise`, { email }),
    );
  }

  verifyResetCodeEntreprise(email: string, code: string): Promise<{ message: string }> {
    return firstValueFrom(
      this.http.post<{ message: string }>(`${this.apiBaseUrl}/auth/verify-reset-code-entreprise`, { email, code }),
    );
  }

  resetPasswordEntreprise(email: string, code: string, password: string): Promise<{ message: string }> {
    return firstValueFrom(
      this.http.post<{ message: string }>(`${this.apiBaseUrl}/auth/reset-password-entreprise`, { email, code, password }),
    );
  }
}
