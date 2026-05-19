import { Routes } from '@angular/router';
import { Login } from './auth/login/login';
import { LoginAccess } from './auth/login-access/login-access';
import { Verify } from './auth/verify/verify';
import { ForgetPasswordComponent } from './auth/forgot-pass/forget-password.component';
import { VerifyCodeComponent } from './auth/forgot-pass/verify-code.component';
import { ResetPasswordComponent } from './auth/forgot-pass/reset-password.component';
import { HomeComponent } from './user/home/home/home';
import { Dashboard } from './user/home/component/dashboard/dashboard';
import { Matching } from './user/home/component/matching/matching';
import { CvAts } from './user/home/component/cv-ats/cv-ats';
import { CvLanding } from './user/home/component/cv-landing/cv-landing';
import { Profil } from './user/home/component/profil/profil';
import { Recommendation } from './user/home/component/recommendation/recommendation';
import { HomeAdmin } from './admin/home_admin/home_admin/home_admin';
import { DashboardAdmin } from './admin/home_admin/comonent_admin/dashboard_admin/dashboard_admin';
import { FormationsAdmin } from './admin/home_admin/comonent_admin/formations_admin/formations_admin';
import { cvCreatedGuard } from './user/home/guards/cv-created.guard';
import { authGuard, roleGuard } from './auth/guards/auth.guard';
import { RegisterEntreprise } from './entreprise/register/register-entreprise';
import { HomeEntreprise } from './entreprise/home/layout/home-entreprise';
import { Offres } from './entreprise/home/offres/offres';
import { Candidatures as CandidaturesComponent } from './entreprise/home/candidatures/candidatures';
import { FicheSignaletique } from './entreprise/home/fiche-signalétique/Fiche-signalétique';
import { LoginEntrepriseComponent } from './entreprise/home/loginen/loginen';
import { ForgetPasswordComponent2 } from './entreprise/home/forgot-pass2/forget-password.component2';
import { VerifyCodeComponent2 } from './entreprise/home/forgot-pass2/verify-code.component2';
import { ResetPasswordComponent2 } from './entreprise/home/forgot-pass2/reset-password.component2';
import { OffresEmpComponent } from './user/home/component/offres-emp/offres-emp';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginAccess },
  { path: 'login-etudiant', component: Login },
  { path: 'register-entreprise', component: RegisterEntreprise },
  { path: 'verify', component: Verify },
  { path: 'forgot-password', component: ForgetPasswordComponent },
  { path: 'verify-code', component: VerifyCodeComponent },
  { path: 'reset-password', component: ResetPasswordComponent },

  {
    path: 'home',
    component: HomeComponent,
    canActivate: [authGuard, roleGuard('etudiant')],
    children: [
      { path: '', redirectTo: 'cv-landing', pathMatch: 'full' },
      { path: 'cv-landing', component: CvLanding },
      { path: 'dashboard', component: Dashboard, canActivate: [cvCreatedGuard] },
      { path: 'matching', component: Matching, canActivate: [cvCreatedGuard] },
      { path: 'cv-ats', component: CvAts },
      { path: 'profil', component: Profil, canActivate: [cvCreatedGuard] },
      { path: 'recommendation', component: Recommendation, canActivate: [cvCreatedGuard] },
      { path: 'candidatures/:id', component: CandidaturesComponent },
      { path: 'offres-emp', component: OffresEmpComponent },
    ],
  },

  {
    path: 'admin',
    component: HomeAdmin,
    canActivate: [authGuard, roleGuard('admin')],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardAdmin },
      { path: 'formations', component: FormationsAdmin },
      {
        path: 'matrice',
        loadComponent: () =>
          import('./admin/home_admin/comonent_admin/matrice_admin').then(m => m.MatriceAdmin),
      },
      {
        path: 'score',
        loadComponent: () =>
          import('./admin/home_admin/comonent_admin/score_admin/score_admin').then(m => m.ScoreAdmin),
      },
      {
        path: 'gaps',
        loadComponent: () =>
          import('./admin/home_admin/comonent_admin/gaps_admin/gaps_admin').then(m => m.GapsAdmin),
      },
      {
        path: 'etud',
        loadComponent: () =>
          import('./admin/home_admin/comonent_admin/etud_admin/etud_admin').then(m => m.EtudAdmin),
      },
      {
        path: 'validation',
        loadComponent: () =>
          import('./admin/home_admin/comonent_admin/validation_admin/validation_admin').then(m => m.ValidationAdmin),
      },
      {
        path: 'feedback',
        loadComponent: () =>
          import('./admin/home_admin/feedback_admin/feedback_admin').then(m => m.FeedbackAdmin),
      },
      {
        path: 'gestion-entreprise',
        loadComponent: () =>
          import('./admin/home_admin/comonent_admin/gestion_entreprise/gestion_entreprise').then(m => m.GestionEntrepriseComponent),
      },
    ],
  },

  { path: 'entreprise/register', component: RegisterEntreprise },
  { path: 'entreprise/loginen', component: LoginEntrepriseComponent },
  { path: 'entreprise/forgot-password', component: ForgetPasswordComponent2 },
  { path: 'entreprise/verify-code', component: VerifyCodeComponent2 },
  { path: 'entreprise/reset-password', component: ResetPasswordComponent2 },
  {
    path: 'entreprise',
    component: HomeEntreprise,
    canActivate: [authGuard, roleGuard('entreprise')],
    children: [
      { path: '', redirectTo: 'offres', pathMatch: 'full' },
      { path: 'offres', component: Offres },
      { path: 'candidatures', component: CandidaturesComponent },
      { path: 'candidatures/:id', component: CandidaturesComponent },
      { path: 'fiche-signaletique', component: FicheSignaletique },
      {
        path: 'feedback',
        loadComponent: () =>
          import('./entreprise/home/feedback/feedback-entreprise').then(m => m.FeedbackEntreprise),
      },
    ],
  },
];