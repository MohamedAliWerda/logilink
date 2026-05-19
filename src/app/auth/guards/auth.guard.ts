import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

type AppRole = 'admin' | 'etudiant' | 'entreprise';

function decodeJwt(token: string): { role?: AppRole; exp?: number; sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
    const json = atob(payload + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getActiveToken(): { token: string; payload: { role?: AppRole; exp?: number; sub?: string } } | null {
  let token: string | null = null;
  try {
    token = localStorage.getItem('token');
  } catch {
    return null;
  }
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < nowSec) {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('entreprise');
      localStorage.removeItem('role');
    } catch {
      /* ignore */
    }
    return null;
  }
  return { token, payload };
}

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const active = getActiveToken();
  if (!active) {
    return router.createUrlTree(['/login']);
  }
  return true;
};

export const roleGuard = (...allowed: AppRole[]): CanActivateFn => () => {
  const router = inject(Router);
  const active = getActiveToken();
  if (!active) {
    return router.createUrlTree(['/login']);
  }
  if (!active.payload.role || !allowed.includes(active.payload.role)) {
    return router.createUrlTree(['/login']);
  }
  return true;
};
