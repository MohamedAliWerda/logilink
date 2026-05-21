import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  animate,
  query,
  stagger,
  style,
  transition,
  trigger,
} from '@angular/animations';
import { Subscription } from 'rxjs';
import { SidebarEntrepriseService } from './sidebar_entreprise.service';

@Component({
  selector: 'app-sidebar-entreprise',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar_entreprise.html',
  styleUrl: './sidebar_entreprise.css',
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
export class SidebarEntreprise implements OnInit, OnDestroy {
  isOpen = true;
  private sub!: Subscription;

  menuItems = [
  {
    key: 'fiche-signaletique',
    label: 'Fiche signalétique',
    route: '/entreprise/fiche-signaletique',
    exact: false,
  },
  {
    key: 'offres',
    label: 'Offres d\'emploi',
    route: '/entreprise/offres',
    exact: false,
  },
  {
    key: 'candidatures',
    label: 'Candidatures',
    route: '/entreprise/candidatures',
    exact: false,
  },
  {
    key: 'feedback',
    label: 'Feedback',
    route: '/entreprise/feedback',
    exact: false,
  },
  {
    key: 'deconnexion',
    label: 'Déconnexion',
    route: '/login',
    exact: true,
  },
];

  constructor(
    private readonly sidebarService: SidebarEntrepriseService,
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
