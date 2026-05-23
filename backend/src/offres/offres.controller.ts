import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OffresService } from './offres.service';
import { OffresScheduler } from './offres.scheduler';
import { getSupabase } from '../config/supabase.client';

type ApplyRequestBody = {
  id_etudiant: number | string;
  applications: Array<{
    id_post: number | string;
    id_societe?: number | string;
  }>;
};

type JwtUser = {
  sub?: string;
  id?: string;
  role?: 'admin' | 'etudiant' | 'entreprise';
  cin_passport?: string | number;
  email?: string;
};

function getReqUser(req: any): JwtUser | undefined {
  return req?.user as JwtUser | undefined;
}

async function assertEntrepriseOwnership(req: any, societeId: string | number): Promise<void> {
  const user = getReqUser(req);
  if (user?.role === 'admin') return;
  if (user?.role !== 'entreprise') {
    throw new ForbiddenException('Réservé aux comptes société.');
  }
  if (String(user.sub) === String(societeId)) return;

  // Fallback: accept the JWT email <-> Societe.email match in case the JWT
  // `sub` was derived from a different column than the row's primary key.
  if (user.email) {
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('Societe')
        .select('id, email')
        .eq('id', Number(societeId))
        .maybeSingle<{ id: number; email?: string }>();
      const rowEmail = (data?.email ?? '').toLowerCase();
      const jwtEmail = (user.email ?? '').toLowerCase();
      if (rowEmail && jwtEmail && rowEmail === jwtEmail) return;
    } catch {
      /* fall through to deny */
    }
  }

  throw new ForbiddenException(
    `Vous ne pouvez accéder qu'aux données de votre société. (sub=${user.sub}, requested=${societeId})`,
  );
}

@SkipThrottle()
@Controller('offres')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OffresController {
  constructor(
    private offresService: OffresService,
    private offresScheduler: OffresScheduler,
  ) {}

  @Public()
  @Get('admin/trigger-feedback-reminders')
  async triggerFeedbackReminders(
    @Headers('x-admin-secret') headerSecret: string,
    @Query('secret') querySecret: string,
  ) {
    const provided = headerSecret || querySecret;
    const expected = process.env.ADMIN_TRIGGER_SECRET;
    if (!expected || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing admin secret.');
    }
    const stats = await this.offresScheduler.sendFeedbackReminders();
    return { success: true, ...stats };
  }

  @Public()
  @Post('admin/unlock-feedback/:postId')
  async adminUnlockFeedback(
    @Param('postId') postId: string,
    @Headers('x-admin-secret') headerSecret: string,
    @Query('secret') querySecret: string,
  ) {
    const provided = headerSecret || querySecret;
    const expected = process.env.ADMIN_TRIGGER_SECRET;
    if (!expected || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing admin secret.');
    }
    return await this.offresService.adminUnlockFeedback(postId);
  }

  @Post('create')
  @Roles('entreprise')
  async createOffre(
    @Req() req: any,
    @Body()
    data: {
      titre_poste: string;
      societe: string;
      exigences: string;
      societe_id: string;
    },
  ) {
    await assertEntrepriseOwnership(req, data.societe_id);
    return await this.offresService.createOffre(data);
  }

  @Get('active')
  @Roles('etudiant', 'admin', 'entreprise')
  async getActiveOffres() {
    return await this.offresService.getActiveOffres();
  }

  @Get('company/:societeId')
  @Roles('entreprise', 'admin')
  async getOffresByCompany(@Req() req: any, @Param('societeId') societeId: string) {
    await assertEntrepriseOwnership(req, societeId);
    return await this.offresService.getOffresByCompany(societeId);
  }

  @Get('company/:societeId/candidatures')
  @Roles('entreprise', 'admin')
  async getCompanyCandidatures(@Req() req: any, @Param('societeId') societeId: string) {
    await assertEntrepriseOwnership(req, societeId);
    return await this.offresService.getCompanyCandidatures(societeId);
  }

  @Get('company/:societeId/feedback-eligible')
  @Roles('entreprise', 'admin')
  async getFeedbackEligiblePosts(@Req() req: any, @Param('societeId') societeId: string) {
    await assertEntrepriseOwnership(req, societeId);
    return await this.offresService.getFeedbackEligiblePosts(societeId);
  }

  @Post('company/:societeId/feedback')
  @Roles('entreprise', 'admin')
  async submitFeedback(
    @Req() req: any,
    @Param('societeId') societeId: string,
    @Body() payload: Record<string, unknown>,
  ) {
    await assertEntrepriseOwnership(req, societeId);
    return await this.offresService.submitFeedback(societeId, payload);
  }

  @Post('company/:societeId/feedback/decline')
  @Roles('entreprise', 'admin')
  async declineFeedback(
    @Req() req: any,
    @Param('societeId') societeId: string,
    @Body() body: { id_post: number | string },
  ) {
    await assertEntrepriseOwnership(req, societeId);
    return await this.offresService.declineFeedback(societeId, body?.id_post);
  }

  @Get('company/:societeId/candidatures/:studentId/cv')
  @Roles('entreprise', 'admin')
  async getCompanyCandidateCv(
    @Req() req: any,
    @Param('societeId') societeId: string,
    @Param('studentId') studentId: string,
    @Query('metierId') metierId?: string,
  ) {
    await assertEntrepriseOwnership(req, societeId);
    return await this.offresService.getCompanyCandidateCv(societeId, studentId, metierId);
  }

  @Get('student/:studentId/applied')
  @Roles('etudiant', 'admin')
  async getStudentAppliedPostIds(@Req() req: any, @Param('studentId') studentId: string) {
    const id = Number(studentId);
    if (!Number.isInteger(id) || id <= 0) {
      return { success: false, error: 'studentId invalide', data: [] };
    }
    const user = getReqUser(req);
    if (user?.role === 'etudiant' && String(user.sub) !== String(studentId) && String(user.cin_passport ?? '') !== String(studentId) && String(user.id ?? '') !== String(studentId)) {
      throw new ForbiddenException('Vous ne pouvez consulter que vos propres candidatures.');
    }
    try {
      const ids = await this.offresService.getStudentAppliedPostIds(id);
      return { success: true, data: ids };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erreur', data: [] };
    }
  }

  @Post('apply')
  @Roles('etudiant')
  async applyToOffres(@Req() req: any, @Body() data: ApplyRequestBody) {
    const user = getReqUser(req);
    if (user?.role === 'etudiant' && String(user.sub) !== String(data.id_etudiant) && String(user.cin_passport ?? '') !== String(data.id_etudiant) && String(user.id ?? '') !== String(data.id_etudiant)) {
      throw new ForbiddenException('Vous ne pouvez postuler que pour vous-même.');
    }
    return await this.offresService.applyToOffres(data);
  }

  @Post('selection')
  @Roles('etudiant')
  async saveSelection(
    @Req() req: any,
    @Body() data: { id_etudiant: number | string; id_post: number | string; id_societe?: number | string },
  ) {
    const user = getReqUser(req);
    if (user?.role === 'etudiant' && String(user.sub) !== String(data.id_etudiant) && String(user.cin_passport ?? '') !== String(data.id_etudiant) && String(user.id ?? '') !== String(data.id_etudiant)) {
      throw new ForbiddenException('Vous ne pouvez gérer que vos propres sélections.');
    }
    return await this.offresService.saveSelection(data);
  }

  @Post('selection/remove')
  @Roles('etudiant')
  async removeSelection(
    @Req() req: any,
    @Body() data: { id_etudiant: number | string; id_post: number | string; id_societe?: number | string },
  ) {
    const user = getReqUser(req);
    if (user?.role === 'etudiant' && String(user.sub) !== String(data.id_etudiant) && String(user.cin_passport ?? '') !== String(data.id_etudiant) && String(user.id ?? '') !== String(data.id_etudiant)) {
      throw new ForbiddenException('Vous ne pouvez gérer que vos propres sélections.');
    }
    return await this.offresService.removeSelection(data);
  }

  @Put(':id')
  @Roles('entreprise', 'admin')
  async updateOffre(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    const owningSocieteId = await this.offresService.getOffreOwningSocieteId(id);
    if (owningSocieteId !== null) {
      await assertEntrepriseOwnership(req, owningSocieteId);
    }
    return await this.offresService.updateOffre(id, data);
  }

  @Delete(':id')
  @Roles('entreprise', 'admin')
  async deleteOffre(@Req() req: any, @Param('id') id: string) {
    const owningSocieteId = await this.offresService.getOffreOwningSocieteId(id);
    if (owningSocieteId !== null) {
      await assertEntrepriseOwnership(req, owningSocieteId);
    }
    return await this.offresService.deleteOffre(id);
  }
}
