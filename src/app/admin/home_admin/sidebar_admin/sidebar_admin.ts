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
import { SidebarAdminService } from './sidebar_admin.service';

@Component({
  selector: 'app-sidebar-admin',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar_admin.html',
  styleUrl: './sidebar_admin.css',
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
export class SidebarAdmin implements OnInit, OnDestroy {
  isOpen = true;
  private sub!: Subscription;

  menuItems = [
    {
      key: 'dashboard',
      label: 'Tableau de bord',
      route: '/admin/dashboard',
      exact: true,
    },
    {
      key: 'matrice',
      label: 'Adéquation F/E',
      route: '/admin/matrice',
      exact: false,
    },
    {
      key: 'score',
      label: "Score d'employabilité",
      route: '/admin/score',
      exact: false,
    },
    {
      key: 'gaps',
      label: 'Analyse des gaps',
      route: '/admin/gaps',
      exact: false,
    },
    {
      key: 'users',
      label: 'Référentiel Compétences',
      route: '/admin/formations',
      exact: false,
    },
    {
      key: 'etud',
      label: 'Suivi des étudiants',
      route: '/admin/etud',
      exact: false,
    },
    {
      key: 'validation',
      label: 'Gestion des recommandations',
      route: '/admin/validation',
      exact: false,
    },
    {
      key: 'feedback',
      label: 'Progrès professionnels',
      route: '/admin/feedback',
      exact: false,
    },
        {
      key: 'gestion-entreprise',
      label: 'Espace des sociétés',
      route: '/admin/gestion-entreprise',
      exact: false,
    },
    {
      key: 'deconnexion',
      label: 'Deconnexion',
      route: '/login',
      exact: true,
    },
  ];

  constructor(
    private readonly sidebarService: SidebarAdminService,
    private readonly router: Router
  ) { }

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
