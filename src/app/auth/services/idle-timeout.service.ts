import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

const IDLE_DURATION_MS = 60 * 60 * 1000; // 1 hour

@Injectable({ providedIn: 'root' })
export class IdleTimeoutService implements OnDestroy {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly handler = () => this.reset();

  constructor(private readonly router: Router, private readonly zone: NgZone) {}

  start(): void {
    if (this.timer !== null) return;
    this.zone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.handler, { passive: true });
      this.scheduleExpiry();
    });
  }

  stop(): void {
    document.removeEventListener('mousemove', this.handler);
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private reset(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.scheduleExpiry();
  }

  private scheduleExpiry(): void {
    this.timer = setTimeout(() => this.expire(), IDLE_DURATION_MS);
  }

  private expire(): void {
    this.stop();
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('entreprise');
      localStorage.removeItem('role');
    } catch {
      /* ignore */
    }
    this.zone.run(() => this.router.navigate(['/login']));
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
