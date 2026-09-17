import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as campaignsService from './campaigns.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const campaigns = await campaignsService.listCampaigns(req.auth!.companyId);
  return res.json({ campaigns });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await campaignsService.createCampaign(req.auth!.companyId, req.body);
  return res.status(201).json({ campaign });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await campaignsService.deleteCampaign(req.auth!.companyId, req.params.id);
  return res.status(204).send();
});
