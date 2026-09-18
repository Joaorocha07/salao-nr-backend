import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './users.controller';
import { createUserSchema, updateUserSchema } from './users.schema';

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/', controller.list);
usersRouter.post('/', requireRole(Role.ADMIN), validate(createUserSchema), controller.create);
usersRouter.patch('/:membershipId', requireRole(Role.ADMIN), validate(updateUserSchema), controller.update);

usersRouter.get('/pending', requireRole(Role.ADMIN), controller.listPending);
usersRouter.post('/:membershipId/approve', requireRole(Role.ADMIN), controller.approve);
usersRouter.post('/:membershipId/reject', requireRole(Role.ADMIN), controller.reject);
