import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { RefCompetanceModule } from './ref_competance/ref_competance.module';
import { CvSubmissionModule } from './cv_submission/cv-submission.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { AdminModule } from './admin/admin.module';
import { OffresModule } from './offres/offres.module';
import { EntrepriseModule } from './entreprise/entreprise.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60_000,
        limit: 60,
      },
      {
        name: 'long',
        ttl: 60 * 60 * 1000,
        limit: 1000,
      },
    ]),
    AuthModule,
    ProfileModule,
    RefCompetanceModule,
    CvSubmissionModule,
    RecommendationsModule,
    AdminModule,
    OffresModule,
    EntrepriseModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
