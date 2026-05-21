import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import {
  trigger,
  transition,
  query,
  style,
  stagger,
  animate,
} from '@angular/animations';
import { SidebarService } from './sidebar.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',

  animations: [
    trigger('listAnimation', [
      transition('* => *', [
        query(
          '.nav-item',
          [
            style({ opacity: 0, transform: 'translateX(-15px)' }),
            stagger(50, [
              animate(
                '250ms ease',
                style({ opacity: 1, transform: 'translateX(0)' })
              ),
            ]),
          ],
          { optional: true }
        ),
      ]),
    ]),
  ],
})
export class Sidebar implements OnInit, OnDestroy {
  isOpen = true;
  private sub!: Subscription;

  menuItems = [
    {
      key: 'dashboard',
      label: 'Tableau de bord',
      route: '/home/dashboard',
      exact: true,
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="3" width="8" height="8" rx="1.5"/>
        <rect x="13" y="3" width="8" height="8" rx="1.5"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5"/>
        <rect x="13" y="13" width="8" height="8" rx="1.5"/>
      </svg>`,
    },
    {
      key: 'cv-ats',
      label: 'CV ATS',
      route: '/home/cv-ats',
      exact: false,
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>`,
    },
    {
      key: 'matching',
      label: 'Matching / Gaps',
      route: '/home/matching',
      exact: false,
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>`,
    },
    {
      key: 'recommendation',
      label: 'Recommandations',
      route: '/home/recommendation',
      exact: false,
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>`,
    },
    {
    key: 'offres-emp',
    label: "Offres d'emploi",
    route: '/home/offres-emp',
    exact: false,
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 3H8L6 7h12l-2-4z"/>
    </svg>`,
  },
    {
      key: 'profil',
      label: 'Profil',
      route: '/home/profil',
      exact: false,
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>`,
    },
  ];

  constructor(
    private readonly sidebarService: SidebarService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.sidebarService.open();
    this.sub = this.sidebarService.isOpen$.subscribe((open) => {
      this.isOpen = open;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }
}