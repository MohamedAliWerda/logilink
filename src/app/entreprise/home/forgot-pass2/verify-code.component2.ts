import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthApiService } from '../../../auth/services/auth-api.service';

@Component({
  selector: 'app-verify-code2',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './verify-code.component2.html',
  styleUrls: ['./verify-code.component2.css'],
})
export class VerifyCodeComponent2 implements OnInit {
  codeForm: FormGroup;
  email = '';
  isSubmitting = false;
  isResending = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
  ) {
    this.codeForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
  }

  ngOnInit(): void {
    const nav = this.router.getCurrentNavigation();
    this.email = (nav?.extras?.state as any)?.['email'] ?? history.state?.['email'] ?? '';
    if (!this.email) {
      this.router.navigate(['/entreprise/forgot-password']);
    }
  }

  async onSubmit() {
    if (this.codeForm.invalid) return;
    this.isSubmitting = true;
    this.errorMessage = '';
    try {
      await this.authApi.verifyResetCodeEntreprise(this.email, this.codeForm.value.code);
      this.router.navigate(['/entreprise/reset-password'], {
        state: { email: this.email, code: this.codeForm.value.code },
      });
    } catch (err: any) {
      this.errorMessage = err?.error?.message ?? err?.message ?? 'Code incorrect ou expiré.';
    } finally {
      this.isSubmitting = false;
    }
  }

  async resend() {
    this.isResending = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await this.authApi.forgotPasswordEntreprise(this.email);
      this.successMessage = 'Un nouveau code a été envoyé.';
    } catch (err: any) {
      this.errorMessage = err?.error?.message ?? err?.message ?? 'Impossible de renvoyer le code.';
    } finally {
      this.isResending = false;
    }
  }
}
