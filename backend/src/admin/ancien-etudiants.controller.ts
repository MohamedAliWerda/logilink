import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AncienEtudiantsService } from './ancien-etudiants.service';
import { MailService } from './mail.service';
import { getSupabase } from '../config/supabase.client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AncienEtudiantsController {
  constructor(
    private readonly service: AncienEtudiantsService,
    private readonly mailService: MailService,
  ) {}

  private async resolveSocieteEmail(societeId: number | string): Promise<{ email: string; nom: string }> {
    const id = Number(societeId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('societeId invalide');
    }
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('Societe')
      .select('id, email, denomination_sociale')
      .eq('id', id)
      .maybeSingle<{ email?: string; denomination_sociale?: string }>();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data?.email) {
      throw new NotFoundException('Société introuvable ou sans email enregistré');
    }
    return { email: data.email, nom: data.denomination_sociale ?? 'Société' };
  }

  @Get()
  async findAll() {
    return this.service.fetchAll();
  }

  @Get('ancien-etudiants')
  async findAncienEtudiants() {
    return this.service.fetchAll();
  }

  @Get('feedback')
  async findFeedback() {
    return this.service.fetchTable('feedback');
  }

  @Post('ancien-etudiants')
  async createAncienEtudiant(@Body() body: Record<string, unknown>) {
    return this.service.createAncienEtudiant(body);
  }

  @Post('feedback')
  async createFeedback(@Body() body: Record<string, unknown>) {
    return this.service.createFeedback(body);
  }

  @Delete('ancien-etudiants/:id')
  async deleteAncienEtudiant(
    @Param('id') id: string,
    @Query('email') email?: string,
  ) {
    await this.service.deleteAncienEtudiant(id, email);
    return { success: true };
  }

  @Post('ancien-etudiants/:id/send-invitation')
  async sendSingleInvitation(
    @Param('id') id: string,
    @Body() body: { subject?: string; message?: string } = {},
  ) {
    const subject = (body.subject ?? '').trim() || 'Partagez votre expérience professionnelle - ISGI';
    const message = (body.message ?? '').trim() || 'Nous aimerions connaître votre parcours professionnel.';
    return this.service.sendSingleInvitation(id, subject, message);
  }

  @Post('ancien-etudiants/send-invitations')
  async sendInvitations(
    @Body() body: { subject?: string; message?: string } = {},
  ) {
    const subject = (body.subject ?? '').trim() || 'Partagez votre expérience professionnelle - ISGI';
    const message = (body.message ?? '').trim() || 'Nous aimerions connaître votre parcours professionnel.\n\n[Lien vers le formulaire]';
    return this.service.sendInvitationsToUncontacted(subject, message);
  }

  @Post('societe/send-approval-email')
  async sendApprovalEmail(@Body() body: { societeId: number | string }) {
    const { email, nom } = await this.resolveSocieteEmail(body?.societeId);
    await this.mailService.sendCompanyApproval(email, nom);
    return { success: true };
  }

  @Post('societe/send-rejection-email')
  async sendRejectionEmail(@Body() body: { societeId: number | string }) {
    const { email, nom } = await this.resolveSocieteEmail(body?.societeId);
    await this.mailService.sendCompanyRejection(email, nom);
    return { success: true };
  }

  @Post('societe/send-pending-email')
  async sendPendingEmail(@Body() body: { societeId: number | string }) {
    const { email, nom } = await this.resolveSocieteEmail(body?.societeId);
    await this.mailService.sendCompanyPending(email, nom);
    return { success: true };
  }
}
