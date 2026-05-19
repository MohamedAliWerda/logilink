import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { IdleTimeoutService } from './auth/services/idle-timeout.service';

const PUBLIC_PATHS = [
  '/login', '/login-etudiant', '/verify', '/forgot-password', '/verify-code',
  '/reset-password', '/register-entreprise', '/entreprise/loginen',
  '/entreprise/forgot-password', '/entreprise/verify-code', '/entreprise/reset-password',
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('logilink');

  private readonly idle = inject(IdleTimeoutService);
  private readonly router = inject(Router);
  private routerSub: Subscription | null = null;

  ngOnInit(): void {
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        const isPublic = PUBLIC_PATHS.some(p => e.urlAfterRedirects.startsWith(p));
        const hasToken = !!localStorage.getItem('token');

        if (!isPublic && hasToken) {
          this.idle.start();
        } else {
          this.idle.stop();
        }
      });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.idle.stop();
  }
}
