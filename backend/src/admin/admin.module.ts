import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AncienEtudiantsController } from './ancien-etudiants.controller';
import { AncienEtudiantsService } from './ancien-etudiants.service';
import { GoogleFormController } from './google-form.controller';
import { MailService } from './mail.service';
import { GapsController } from './gaps.controller';
import { GapsService } from './gaps.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardStatsService } from './dashboard-stats.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AncienEtudiantsController,
    GoogleFormController,
    GapsController,
    DashboardController,
  ],
  providers: [AncienEtudiantsService, MailService, GapsService, DashboardService, DashboardStatsService],
  exports: [AncienEtudiantsService, MailService, GapsService, DashboardService, DashboardStatsService],
})
export class AdminModule {}
