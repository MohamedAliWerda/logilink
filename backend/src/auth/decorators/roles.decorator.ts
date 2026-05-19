import { SetMetadata } from '@nestjs/common';

export type AppRole = 'admin' | 'etudiant' | 'entreprise';

export const ROLES_KEY = 'app:roles';

export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
