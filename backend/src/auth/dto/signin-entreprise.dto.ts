import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignInEntrepriseDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  mot_de_passe!: string;
}
