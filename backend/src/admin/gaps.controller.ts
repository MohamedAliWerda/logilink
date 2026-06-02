import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GapsService } from './gaps.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class GapsController {
  constructor(private readonly gapsService: GapsService) {}

  @Get('gaps')
  async getGaps() {
    return this.gapsService.getDashboard();
  }

  @Get('student-cv/:cvSubmissionId')
  async getStudentCv(
    @Param('cvSubmissionId') cvSubmissionId: string,
    @Query('authId') authId: string,
  ) {
    return this.gapsService.getStudentCv(cvSubmissionId, authId);
  }
}
