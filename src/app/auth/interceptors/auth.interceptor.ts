import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isApi = req.url.startsWith(environment.apiUrl);
  if (!isApi) {
    return next(req);
  }

  let token: string | null = null;
  try {
    token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  } catch {
    token = null;
  }

  if (!token) {
    return next(req);
  }

  const cloned = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
  return next(cloned);
};
