import { Component, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-register-entreprise',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, CommonModule],
  templateUrl: './register-entreprise.html',
  styleUrls: ['./register-entreprise.css']
})
export class RegisterEntreprise {
  registerForm: FormGroup;
  hidePassword = true;
  isSubmitting = false;
  formError: string | null = null;
  registrationSuccess = false;
  successMessage: string | null = null;
  redirectCountdown = 30;

  constructor(
    private readonly fb: FormBuilder,
    private readonly router: Router,
    private readonly supabaseService: SupabaseService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.registerForm = this.fb.group({
      nomEntreprise: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      telephone: ['', [Validators.required, this.telephoneValidator.bind(this)]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      adresse: ['', Validators.required],
      description: ['', Validators.required],
    });
  }

  private telephoneValidator(control: any) {
    const raw = (control.value || '').toString();
    const digits = raw.replace(/\D/g, '');
    return digits.length === 8 ? null : { invalidTelephone: true };
  }

  formatTelephoneDisplayFromDigits(digits: string): string {
    const d = (digits || '').replace(/\D/g, '').slice(0, 8);
    if (!d) return '';
    let formatted = '';
    if (d.length <= 2) formatted = d;
    else if (d.length <= 5) formatted = d.slice(0, 2) + ' ' + d.slice(2);
    else formatted = d.slice(0, 2) + ' ' + d.slice(2, 5) + ' ' + d.slice(5);
    return formatted;
  }

  formatTelephoneDisplay(value: string): string {
    return this.formatTelephoneDisplayFromDigits(value);
  }

  onTelephoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const prevSelection = input.selectionStart ?? input.value.length;
    const prevRaw = input.value || '';
    // count how many digits are to the left of the caret
    const leftDigits = (prevRaw.slice(0, prevSelection).match(/\d/g) || []).length;

    const digits = (input.value || '').replace(/\D/g, '').slice(0, 8);
    const formatted = this.formatTelephoneDisplayFromDigits(digits);

    // Set the input value directly to avoid Angular re-render issues,
    // then update the form control silently.
    input.value = formatted;
    this.registerForm.get('telephone')?.setValue(formatted, { emitEvent: false });

    // Place caret after the same number of digits
    if (leftDigits >= 0) {
      // find index of the nth digit in the formatted string
      let count = 0;
      let newPos = formatted.length;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) {
          count++;
          if (count === leftDigits) { newPos = i + 1; break; }
        }
      }
      try { input.setSelectionRange(newPos, newPos); } catch (e) { /* ignore */ }
    }

    this.cdr.detectChanges();
  }

  isFieldInvalid(field: string): boolean {
    const control = this.registerForm.get(field);
    return !!(control && control.invalid && control.touched);
  }

  async onSubmit(): Promise<void> {
    console.log('📋 onSubmit called');
    if (this.registerForm.invalid) {
      console.log('📋 Form invalid');
      this.registerForm.markAllAsTouched();
      this.formError = 'Veuillez remplir tous les champs obligatoires.';
      this.cdr.detectChanges();
      return;
    }

    this.formError = null;
    this.isSubmitting = true;
    this.cdr.detectChanges();

    const timeoutHandle = window.setTimeout(() => {
      console.error('❌ Submit timed out after 15 seconds');
      this.isSubmitting = false;
      this.formError = 'Délai d\'attente dépassé. Vérifiez votre connexion et réessayez.';
    }, 15000);

    try {
      const raw = this.registerForm.getRawValue();
      // Normalize inputs to improve matching and storage
      const payload = {
        ...raw,
        email: (raw.email || '').toString().trim().toLowerCase(),
        nomEntreprise: (raw.nomEntreprise || '').toString().trim(),
        adresse: (raw.adresse || '').toString().trim(),
        description: (raw.description || '').toString().trim(),
          // telephone: store with +216 prefix and formatted as "XX XXX XXX"
          telephone: (function(r: any, self: any){
            const v = (r || '').toString();
            const digits = v.replace(/\D/g, '').slice(0,8);
            const formatted = self.formatTelephoneDisplayFromDigits(digits);
            return formatted ? formatted : '';
          })(raw.telephone, this),
      };
      const conflict: any = await this.supabaseService.findConflictingSociete({
        nomEntreprise: payload.nomEntreprise,
        email: payload.email,
        telephone: payload.telephone,
      });

      if (conflict) {
        clearTimeout(timeoutHandle);
        const conflicts: string[] = [];
        const norm = (s: any) => (s || '').toString().trim().toLowerCase();
        if (conflict.email && norm(conflict.email) === norm(payload.email)) conflicts.push('adresse e-mail');
        const onlyDigits = (s: any) => (s || '').toString().replace(/\D/g, '');
        if (conflict.telephone && onlyDigits(conflict.telephone) === onlyDigits(payload.telephone)) conflicts.push('téléphone');
        if (conflict.denomination_sociale && norm(conflict.denomination_sociale) === norm(payload.nomEntreprise)) conflicts.push('dénomination sociale');
        if (conflict.adresse && norm(conflict.adresse) === norm(payload.adresse)) conflicts.push('adresse');
        if (conflict.secteur_activite && norm(conflict.secteur_activite) === norm(payload.description)) conflicts.push("secteur d'activité");

        const fieldList = conflicts.length ? conflicts.join(', ') : 'informations fournies';
        this.formError = `ce compte existe déjà `;
        this.isSubmitting = false;
        this.cdr.detectChanges();
        return;
      }
      
      await this.supabaseService.createSociete(payload);
      clearTimeout(timeoutHandle);

      this.isSubmitting = false;
      this.registrationSuccess = true;
      this.redirectCountdown = 30;
      try { this.registerForm.disable(); } catch (e) { /* noop */ }
      this.cdr.detectChanges();

      // Countdown then redirect
      const tick = window.setInterval(() => {
        this.redirectCountdown -= 1;
        this.cdr.detectChanges();
        if (this.redirectCountdown <= 0) {
          window.clearInterval(tick);
          void this.router.navigate(['/entreprise/loginen']);
        }
      }, 1000);

    } catch (error: any) {
      clearTimeout(timeoutHandle);
      console.error('❌ Error in onSubmit:', error);
      const msg = error?.message ?? error?.error?.message ?? String(error);
      const details = error?.details;
      const hint = error?.hint;
      const fullError = [msg, details, hint].filter(Boolean).join(' | ');
      this.formError = fullError || 'Impossible d\'enregistrer la societe pour le moment. Verifiez la connexion et reessayez.';
      console.log('❌ Form error set:', this.formError);
      this.isSubmitting = false;
      this.cdr.detectChanges();
    } finally {
      this.cdr.detectChanges();
    }
  }

  togglePasswordVisibility(): void {
    this.hidePassword = !this.hidePassword;
  }
}