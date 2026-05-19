import { IsString, Length, Matches, MinLength } from 'class-validator';

export class VerifyTwoFactorDto {
  @IsString()
  @MinLength(1)
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;
}

export class ResendTwoFactorDto {
  @IsString()
  @MinLength(1)
  challengeId!: string;
}
