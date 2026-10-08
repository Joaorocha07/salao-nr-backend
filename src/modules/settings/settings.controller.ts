import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as settingsService from './settings.service';

// O token da API oficial do WhatsApp nunca sai do servidor: o CRM só fica
// sabendo se ele está cadastrado.
function publicSettings<T extends { whatsappCloudToken: string | null }>(settings: T) {
  const { whatsappCloudToken, ...rest } = settings;
  return { ...rest, whatsappCloudTokenSet: Boolean(whatsappCloudToken) };
}

export const get = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingsService.getSettings(req.auth!.companyId);
  return res.json({ settings: publicSettings(settings) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingsService.updateSettings(req.auth!.companyId, req.body);
  return res.json({ settings: publicSettings(settings) });
});

export const addInterest = asyncHandler(async (req: Request, res: Response) => {
  const settings = await settingsService.addInterest(req.auth!.companyId, req.body.name);
  return res.status(201).json({ settings: publicSettings(settings) });
});
