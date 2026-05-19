import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AncienEtudiantsService } from './ancien-etudiants.service';

@Controller('admin/ancien-etudiants')
export class GoogleFormController {
  constructor(private readonly service: AncienEtudiantsService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('google-form-submission')
  async googleFormSubmission(@Body() body: Record<string, any>) {
    return this.service.ingestGoogleFormSubmission(body ?? {});
  }
}
