import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardStatsService } from './dashboard-stats.service';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly stats: DashboardStatsService,
  ) {}

  @Get('top-gaps')
  async getTopGaps() {
    return this.dashboardService.getTopGaps();
  }

  @Get('students')
  async getRecentStudents(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(500, Math.floor(parsed)) : 5;
    return this.dashboardService.getRecentStudents(safeLimit);
  }

  @Get('stats')
  async getStats() {
    return this.stats.getAggregateStats();
  }

  @Get('feedback-societe')
  async getFeedbackSocieteRows() {
    return this.dashboardService.getFeedbackSocieteRows();
  }
}
