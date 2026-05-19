import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { OffresService } from './offres.service';
import { OffresController } from './offres.controller';
import { OffresScheduler } from './offres.scheduler';
import { OffresMigrationService } from './offres-migration.service';
import { CvSubmissionModule } from '../cv_submission/cv-submission.module';

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule, AdminModule, CvSubmissionModule],
  controllers: [OffresController],
  providers: [OffresService, OffresScheduler, OffresMigrationService],
  exports: [OffresService],
})
export class OffresModule {}
