import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './companies.controller';

const createCompanySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa.'),
});

const updateCompanySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa.'),
});

export const companiesRouter = Router();

companiesRouter.use(authenticate);
companiesRouter.post('/', requireRole(Role.ADMIN), validate(createCompanySchema), controller.create);
companiesRouter.patch('/:id', validate(updateCompanySchema), controller.update);
