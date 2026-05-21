import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthApiService } from '../../../auth/services/auth-api.service';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

@Component({
  selector: 'app-reset-password2',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './reset-password.component2.html',
  styleUrls: ['./reset-password.component2.css'],
})
export class ResetPasswordComponent2 implements OnInit {
  resetForm: FormGroup;
  hidePassword = true;
  hideConfirm = true;
  isSubmitting = false;
  errorMessage = '';

  private email = '';
  private code = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
  ) {
    this.resetForm = this.fb.group(
      {
        password: ['', [Validators.required, Validators.minLength(6)]],
        confirm: ['', Validators.required],
      },
      { validators: passwordsMatch },
    );
  }

  ngOnInit(): void {
    const state = history.state;
    this.email = state?.['email'] ?? '';
    this.code = state?.['code'] ?? '';
    if (!this.email || !this.code) {
      this.router.navigate(['/entreprise/forgot-password']);
    }
  }

  async onSubmit() {
    if (this.resetForm.invalid) return;
    this.isSubmitting = true;
    this.errorMessage = '';
    try {
      await this.authApi.resetPasswordEntreprise(this.email, this.code, this.resetForm.value.password);
      this.router.navigate(['/entreprise/loginen']);
    } catch (err: any) {
      this.errorMessage = err?.error?.message ?? err?.message ?? 'Erreur lors de la réinitialisation.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
