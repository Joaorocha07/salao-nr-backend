import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './settings.controller';
import { updateSettingsSchema } from './settings.schema';

export const settingsRouter = Router();

settingsRouter.use(authenticate);

settingsRouter.get('/', controller.get);
settingsRouter.put('/', requireRole(Role.ADMIN), validate(updateSettingsSchema), controller.update);
