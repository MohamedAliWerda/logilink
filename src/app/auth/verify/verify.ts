import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthApiService, VerifyTwoFactorResponse } from '../services/auth-api.service';
import { CvSubmissionService } from '../../user/home/component/cv-ats/cv-submission.service';

type RedirectFlow = 'admin' | 'etudiant' | 'entreprise';

@Component({
  selector: 'app-verify',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './verify.html',
  styleUrls: ['./verify.css']
})
export class Verify {
  digits: string[] = ['', '', '', '', '', ''];
  email: string = '';
  errorMsg: string = '';
  resendCooldown: number = 0;
  isSubmitting = false;
  isResending = false;
  private timerInterval: number | undefined;
  private challengeId: string = '';
  private redirectFlow: RedirectFlow = 'etudiant';

  constructor(
    private readonly router: Router,
    private readonly authApi: AuthApiService,
    private readonly cvSubmissionService: CvSubmissionService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const state = history.state;
    this.email = state?.email || 'votre email';
    this.challengeId = state?.challengeId || '';
    this.redirectFlow = (state?.redirectFlow as RedirectFlow) || 'etudiant';

    if (!this.challengeId) {
      this.errorMsg = 'Session de vérification invalide. Veuillez vous reconnecter.';
    }

    this.startCooldown();
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  onInput(event: Event, index: number): void {
    // Mobile-only path (key='Unidentified' in onKeydown, so no preventDefault there).
    const input = event.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, '').slice(-1);
    if (!val) return;
    input.value = val;
    this.digits[index] = val;
    this.errorMsg = '';
    // Defer focus so keypress/input events for THIS key finish on this element first.
    if (index < 5) {
      setTimeout(() => {
        document.querySelectorAll<HTMLInputElement>('.digit-input')[index + 1]?.focus();
      }, 0);
    }
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (this.digits[index]) {
        this.digits[index] = '';
      } else if (index > 0) {
        this.digits[index - 1] = '';
        const prev = document.querySelectorAll<HTMLInputElement>('.digit-input')[index - 1];
        if (prev) { prev.value = ''; prev.focus(); }
      }
      return;
    }

    // Allow control/navigation keys (Tab, arrows, Delete, etc.)
    if (event.key.length > 1) return;

    // Mobile sends 'Unidentified' — let the input event handle it
    if (event.key === 'Unidentified') return;

    // Let browser shortcuts (Ctrl+V, Cmd+V, Ctrl+C, …) pass through untouched.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Desktop: intercept the digit, prevent browser insertion.
    event.preventDefault();

    if (/^\d$/.test(event.key)) {
      this.digits[index] = event.key;
      this.errorMsg = '';
      // Defer focus so all events for this keypress finish on this element first,
      // preventing keypress/input from firing on the next input and double-advancing.
      if (index < 5) {
        setTimeout(() => {
          document.querySelectorAll<HTMLInputElement>('.digit-input')[index + 1]?.focus();
        }, 0);
      }
    }
  }

  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) || '';
    text.split('').forEach((ch, i) => { this.digits[i] = ch; });

    const inputs = document.querySelectorAll<HTMLInputElement>('.digit-input');
    inputs.forEach((inp, i) => inp.value = this.digits[i] || '');
    inputs[Math.min(text.length, 5)]?.focus();
    this.errorMsg = '';
    event.preventDefault();
  }

  async verify(): Promise<void> {
    if (this.isSubmitting) return;

    const code = this.digits.join('');
    if (code.length < 6) {
      this.errorMsg = 'Veuillez entrer le code complet à 6 chiffres.';
      return;
    }

    if (!this.challengeId) {
      this.errorMsg = 'Session de vérification invalide. Veuillez vous reconnecter.';
      return;
    }

    this.isSubmitting = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    try {
      const response = await this.authApi.verifyTwoFactor(this.challengeId, code);
      await this.persistSessionAndNavigate(response);
    } catch (err) {
      this.errorMsg = this.extractError(err) || 'Code invalide.';
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  async resend(): Promise<void> {
    if (this.resendCooldown > 0 || this.isResending || !this.challengeId) return;

    this.isResending = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    try {
      await this.authApi.resendTwoFactor(this.challengeId);
      this.startCooldown();
    } catch (err) {
      this.errorMsg = this.extractError(err) || 'Impossible d\'envoyer un nouveau code.';
    } finally {
      this.isResending = false;
      this.cdr.detectChanges();
    }
  }

  private async persistSessionAndNavigate(response: VerifyTwoFactorResponse): Promise<void> {
    const { access_token, user, entreprise, role } = response.data;

    localStorage.setItem('token', access_token);

    if (this.redirectFlow === 'entreprise' || role === 'entreprise') {
      if (entreprise) {
        localStorage.setItem('entreprise', JSON.stringify(entreprise));
      }
      localStorage.setItem('role', 'entreprise');
      await this.router.navigate(['/entreprise/offres']);
      return;
    }

    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('role', user.role);

      if (user.role === 'admin') {
        await this.router.navigate(['/admin/dashboard']);
        return;
      }

      if (user.role === 'etudiant') {
        await this.navigateStudentAfterLogin();
        return;
      }
    }

    this.errorMsg = 'Rôle utilisateur non autorisé.';
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    this.isSubmitting = false;
    this.cdr.detectChanges();
  }

  private async navigateStudentAfterLogin(): Promise<void> {
    try {
      const cv = await this.cvSubmissionService.fetchMyCv();
      if (cv) {
        await this.router.navigate(['/home/dashboard']);
        return;
      }
    } catch {
      // Fall through to onboarding when CV status cannot be resolved.
    }

    await this.router.navigate(['/home/cv-landing']);
  }

  private extractError(error: unknown): string {
    const httpError = error as HttpErrorResponse;
    const raw = httpError?.error;

    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }
    if (raw && typeof raw === 'object' && 'message' in raw) {
      const msg = (raw as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim().length > 0) return msg;
      if (Array.isArray(msg)) return msg.filter((v) => typeof v === 'string').join(', ');
    }
    return '';
  }

  private startCooldown(): void {
    this.resendCooldown = 60;
    this.clearTimer();
    this.timerInterval = window.setInterval(() => {
      this.resendCooldown--;
      if (this.resendCooldown <= 0) {
        this.clearTimer();
      }
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timerInterval !== undefined) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }
}
