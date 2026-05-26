// ✅ login_entreprise.ts - imports corrects
import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthApiService } from '../../../auth/services/auth-api.service';

@Component({
  selector: 'app-login-entreprise',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './loginen.html',
  styleUrls: ['./loginen.css'],
})
export class LoginEntrepriseComponent {
  loginForm: FormGroup;
  hidePassword = true;
  isSubmitting = false;
  authError = '';
  emailError = '';
  passwordError = '';
  pendingNotice: string | null = null;
  private pendingNoticeTimer: number | null = null;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private readonly authApiService: AuthApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
  }

  togglePasswordVisibility(): void {
    this.hidePassword = !this.hidePassword;
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      this.authError = '';
      const emailCtrl    = this.loginForm.get('email');
      const passwordCtrl = this.loginForm.get('password');

      if (!emailCtrl?.value?.toString().trim()) {
        this.emailError = 'Veuillez saisir votre adresse email.';
      } else if (emailCtrl.hasError('email')) {
        this.emailError = 'Adresse email invalide.';
      } else {
        this.emailError = '';
      }

      this.passwordError = !passwordCtrl?.value
        ? 'Veuillez saisir votre mot de passe.'
        : '';

      this.loginForm.markAllAsTouched();
      this.cdr.detectChanges();
      return;
    }

    this.isSubmitting = true;
    this.cdr.detectChanges();
    this.authError = '';
    this.emailError = '';
    this.passwordError = '';
    this.clearPendingNotice();

    const { email, password } = this.loginForm.value;

    try {
      const response = await this.authApiService.signInEntreprise(email, password);
      const { challengeId, email: maskedEmail, type } = response.data;

      await this.router.navigate(['/verify'], {
        state: {
          challengeId,
          email: maskedEmail,
          type,
          redirectFlow: 'entreprise',
        },
      });
    } catch (err: any) {
      const httpError = err as HttpErrorResponse;
      const serverMessage = this.extractErrorMessage(err);

      if (httpError.status === 401) {
        const message = (serverMessage || '').toLowerCase();
        if (message.includes('email') || message.includes('existe')) {
          this.emailError = serverMessage || "Cet email n'existe pas.";
        } else if (message.includes('mot de passe') || message.includes('password')) {
          this.passwordError = serverMessage || 'Le mot de passe est incorrect.';
        } else {
          this.authError = serverMessage || 'Identifiant ou mot de passe incorrect.';
        }
      } else if (httpError.status === 403) {
        this.pendingNotice = serverMessage || "Votre compte est en attente de validation par un administrateur.";
        this.schedulePendingNoticeClear();
      } else if (httpError.status === 0) {
        this.authError = 'Connexion impossible. Veuillez réessayer.';
      } else {
        this.authError = serverMessage || 'Erreur lors de la connexion. Veuillez réessayer.';
      }
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  private extractErrorMessage(error: unknown): string {
    const httpError = error as HttpErrorResponse;
    const raw = httpError?.error;

    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }

    if (raw && typeof raw === 'object' && 'message' in raw) {
      const msg = (raw as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim().length > 0) {
        return msg;
      }
      if (Array.isArray(msg)) {
        return msg.filter((v) => typeof v === 'string').join(', ');
      }
    }

    return '';
  }

  private clearPendingNotice(): void {
    this.pendingNotice = null;
    if (this.pendingNoticeTimer !== null) {
      window.clearTimeout(this.pendingNoticeTimer);
      this.pendingNoticeTimer = null;
    }
  }

  private schedulePendingNoticeClear(): void {
    if (this.pendingNoticeTimer !== null) {
      window.clearTimeout(this.pendingNoticeTimer);
    }

    this.pendingNoticeTimer = window.setTimeout(() => {
      this.clearPendingNotice();
    }, 5000);
  }
}
