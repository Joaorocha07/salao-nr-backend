import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      // Corpo cru da requisição, para conferir a assinatura do webhook da Meta.
      rawBody?: Buffer;
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
