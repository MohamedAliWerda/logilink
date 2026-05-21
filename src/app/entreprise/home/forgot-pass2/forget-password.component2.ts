import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthApiService } from '../../../auth/services/auth-api.service';

@Component({
  selector: 'app-forget-password2',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './forget-password.component2.html',
  styleUrls: ['./forget-password.component2.css'],
})
export class ForgetPasswordComponent2 {
  emailForm: FormGroup;
  isSubmitting = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
  ) {
    this.emailForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  async onSubmit() {
    if (this.emailForm.invalid) return;
    this.isSubmitting = true;
    this.errorMessage = '';
    try {
      await this.authApi.forgotPasswordEntreprise(this.emailForm.value.email);
      this.router.navigate(['/entreprise/verify-code'], {
        state: { email: this.emailForm.value.email },
      });
    } catch (err: any) {
      this.errorMessage =
        err?.error?.message ?? err?.message ?? 'Erreur lors de l\'envoi du code.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
