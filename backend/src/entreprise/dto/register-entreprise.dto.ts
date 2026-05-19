import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterEntrepriseDto {
  @IsString()
  @MinLength(1)
  nomEntreprise!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d[\d\s]{6,12}\d$/, { message: 'telephone invalide' })
  telephone!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  adresse!: string;

  @IsString()
  @MinLength(1)
  description!: string;
}
