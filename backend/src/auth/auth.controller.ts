import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signin.dto';
import { SignInEntrepriseDto } from './dto/signin-entreprise.dto';
import { ResendTwoFactorDto, VerifyTwoFactorDto } from './dto/verify-2fa.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signin')
  async signIn(@Body() signInDto: SignInDto) {
    return this.authService.signIn(signInDto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signin-entreprise')
  async signInEntreprise(@Body() dto: SignInEntrepriseDto) {
    return this.authService.signInEntreprise(dto);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('verify-2fa')
  async verifyTwoFactor(@Body() dto: VerifyTwoFactorDto) {
    return this.authService.verifyTwoFactor(dto.challengeId, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-2fa')
  async resendTwoFactor(@Body() dto: ResendTwoFactorDto) {
    return this.authService.resendTwoFactor(dto.challengeId);
  }

  @Get('ping')
  ping() {
    return { success: true, message: 'pong', time: new Date().toISOString() };
  }
}
