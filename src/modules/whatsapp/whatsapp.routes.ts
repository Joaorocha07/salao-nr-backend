import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './whatsapp.controller';
import { replySchema, sendTestSchema } from './whatsapp.schema';

export const whatsappRouter = Router();

whatsappRouter.use(authenticate);
whatsappRouter.get('/status', controller.getStatus);
whatsappRouter.post('/connect', requireRole(Role.ADMIN), controller.connect);
whatsappRouter.post('/disconnect', requireRole(Role.ADMIN), controller.disconnect);
whatsappRouter.post('/test', requireRole(Role.ADMIN), validate(sendTestSchema), controller.sendTest);
whatsappRouter.post('/leads/:id/reply', validate(replySchema), controller.replyToLead);
whatsappRouter.get('/leads/:id/bot', controller.getBotState);
whatsappRouter.post('/leads/:id/bot/resume', controller.resumeBot);
