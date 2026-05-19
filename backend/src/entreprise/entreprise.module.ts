import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { EntrepriseController } from './entreprise.controller';
import { EntrepriseService } from './entreprise.service';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [EntrepriseController],
  providers: [EntrepriseService],
  exports: [EntrepriseService],
})
export class EntrepriseModule {}
