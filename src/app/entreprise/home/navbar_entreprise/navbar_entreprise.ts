import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { SidebarEntrepriseService } from '../sidebar_entreprise/sidebar_entreprise.service';

@Component({
  selector: 'app-navbar-entreprise',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar_entreprise.html',
  styleUrl: './navbar_entreprise.css',
})
export class NavbarEntreprise implements OnInit {
  entrepriseName = '';

  constructor(
    private readonly router: Router,
    private readonly sidebarService: SidebarEntrepriseService
  ) {}

  ngOnInit(): void {
    if (typeof window === 'undefined' || window.innerWidth > 600) {
      this.sidebarService.open();
    }
    try {
      const stored = localStorage.getItem('entreprise');
      if (stored) {
        this.entrepriseName = JSON.parse(stored)?.nomEntreprise ?? '';
      }
    } catch {
      // ignore
    }
  }

  toggleSidebar(): void {
    this.sidebarService.toggle();
  }

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('entreprise');
    localStorage.removeItem('role');
    this.router.navigate(['/login']);
  }
}
