import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './whatsapp.controller';
import { cloudConfigSchema, replySchema, sendTestSchema, templateKindSchema } from './whatsapp.schema';
import { receiveWebhook, verifyWebhook } from './whatsapp.cloud';

// Webhook da API oficial: chamado pela Meta, sem login (o POST é conferido
// pela assinatura). Montado antes do limite de requisições em app.ts.
export const whatsappWebhookRouter = Router();
whatsappWebhookRouter.get('/', verifyWebhook);
whatsappWebhookRouter.post('/', receiveWebhook);

export const whatsappRouter = Router();

whatsappRouter.use(authenticate);
whatsappRouter.get('/status', controller.getStatus);
whatsappRouter.post('/connect', requireRole(Role.ADMIN), controller.connect);
whatsappRouter.post('/disconnect', requireRole(Role.ADMIN), controller.disconnect);
whatsappRouter.put('/cloud', requireRole(Role.ADMIN), validate(cloudConfigSchema), controller.connectCloud);
whatsappRouter.get('/templates', requireRole(Role.ADMIN), controller.listTemplates);
whatsappRouter.post('/templates/:kind', requireRole(Role.ADMIN), validate(templateKindSchema, 'params'), controller.submitTemplate);
whatsappRouter.post('/test', requireRole(Role.ADMIN), validate(sendTestSchema), controller.sendTest);
whatsappRouter.post('/leads/:id/reply', validate(replySchema), controller.replyToLead);
whatsappRouter.get('/leads/:id/bot', controller.getBotState);
whatsappRouter.post('/leads/:id/bot/resume', controller.resumeBot);
