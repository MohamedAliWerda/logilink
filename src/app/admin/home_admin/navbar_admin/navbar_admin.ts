import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { SidebarAdminService } from '../sidebar_admin/sidebar_admin.service';

@Component({
  selector: 'app-navbar-admin',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar_admin.html',
  styleUrl: './navbar_admin.css',
})
export class NavbarAdmin implements OnInit {
  user: { name: string; avatarUrl: string | null } = {
    name: 'Admin',
    avatarUrl: null,
  };

  constructor(
    private readonly router: Router,
    private readonly sidebarService: SidebarAdminService
  ) {}

  ngOnInit(): void {
    if (typeof window === 'undefined' || window.innerWidth > 600) {
      this.sidebarService.open();
    }
  }

  toggleSidebar(): void {
    this.sidebarService.toggle();
  }

  goToDashboard(): void {
    this.router.navigate(['/admin/dashboard']);
  }

  logout(): void {
    localStorage.removeItem('token');
    sessionStorage.clear();
    this.router.navigate(['/login']);
  }
}
