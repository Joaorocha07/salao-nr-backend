import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as settingsService from './settings.service';

export const get = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingsService.getSettings(req.auth!.companyId);
  return res.json({ settings });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingsService.updateSettings(req.auth!.companyId, req.body);
  return res.json({ settings });
});

export const addInterest = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingsService.addInterest(req.auth!.companyId, req.body.name);
  return res.status(201).json({ settings });
});
