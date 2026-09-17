import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './campaigns.controller';
import { createCampaignSchema } from './campaigns.schema';

export const campaignsRouter = Router();

campaignsRouter.use(authenticate);

campaignsRouter.get('/', controller.list);
campaignsRouter.post('/', validate(createCampaignSchema), controller.create);
campaignsRouter.delete('/:id', controller.remove);
