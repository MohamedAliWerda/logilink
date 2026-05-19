import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MailService } from '../admin/mail.service';
import { EntrepriseService } from './entreprise.service';
import { RegisterEntrepriseDto } from './dto/register-entreprise.dto';

@Controller('entreprise')
export class EntrepriseController {
  constructor(
    private readonly entrepriseService: EntrepriseService,
    private readonly mailService: MailService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterEntrepriseDto) {
    const result = await this.entrepriseService.register(dto);
    try {
      await this.mailService.sendCompanyPending(dto.email, dto.nomEntreprise);
    } catch {
      // non-fatal
    }
    return {
      message: 'Inscription reçue. Votre demande est en attente de validation.',
      data: { id: result.id },
    };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('conflict')
  async checkConflict(@Body() body: { email?: string; telephone?: string; nomEntreprise?: string }) {
    const email = (body?.email ?? '').toString().trim();
    if (!email) {
      throw new BadRequestException('email manquant');
    }
    const conflict = await this.entrepriseService.findConflict(
      email,
      (body?.telephone ?? '').toString(),
      (body?.nomEntreprise ?? '').toString(),
    );
    return conflict ? { id: conflict.id } : null;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get()
  async listAll() {
    return this.entrepriseService.fetchAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('by-situations')
  async listBySituations(@Query('values') values?: string) {
    const list = (values ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) {
      throw new BadRequestException('Paramètre values manquant');
    }
    return this.entrepriseService.fetchBySituations(list);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'entreprise')
  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new BadRequestException('id invalide');
    }
    const user = req.user as { role?: string; sub?: string; email?: string };
    if (user?.role === 'entreprise' && String(user.sub) !== String(numericId)) {
      const row = await this.entrepriseService.fetchById(numericId);
      const rowEmail = String((row as any)?.email ?? '').toLowerCase();
      const jwtEmail = (user?.email ?? '').toLowerCase();
      if (!rowEmail || !jwtEmail || rowEmail !== jwtEmail) {
        throw new ForbiddenException(`Accès interdit (sub=${user?.sub}, requested=${numericId})`);
      }
      return row;
    }
    return this.entrepriseService.fetchById(numericId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put(':id/situation')
  async updateSituation(@Param('id') id: string, @Body() body: { situation: string }) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new BadRequestException('id invalide');
    }
    const situation = (body?.situation ?? '').toString().trim();
    if (!situation) {
      throw new BadRequestException('situation manquante');
    }
    return this.entrepriseService.updateSituation(numericId, situation);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('entreprise', 'admin')
  @Put(':id/profile')
  async updateProfile(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      nomEntreprise: string;
      email: string;
      telephone: string;
      adresse: string;
      description: string;
    },
  ) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new BadRequestException('id invalide');
    }
    const user = req.user as { role?: string; sub?: string; email?: string };
    if (user?.role === 'entreprise' && String(user.sub) !== String(numericId)) {
      const row = await this.entrepriseService.fetchById(numericId);
      const rowEmail = String((row as any)?.email ?? '').toLowerCase();
      const jwtEmail = (user?.email ?? '').toLowerCase();
      if (!rowEmail || !jwtEmail || rowEmail !== jwtEmail) {
        throw new ForbiddenException(
          `Vous ne pouvez modifier que votre propre profil. (sub=${user?.sub}, requested=${numericId})`,
        );
      }
    }
    return this.entrepriseService.updateProfile(numericId, body);
  }
}
