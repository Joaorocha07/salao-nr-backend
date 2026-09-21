import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        companyId: string;
        role: Role;
        isSuperAdmin: boolean;
      };
    }
  }
}

export {};
