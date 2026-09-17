import { z } from 'zod';
import { Role } from '@prisma/client';

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo.'),
  email: z.string().trim().email('E-mail inválido.').toLowerCase(),
  role: z.nativeEnum(Role).default(Role.EMPLOYEE),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
});

export const userParamsSchema = z.object({
  membershipId: z.string().uuid(),
});
