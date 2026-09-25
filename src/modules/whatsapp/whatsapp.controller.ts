import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as whatsappService from './whatsapp.service';

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = await whatsappService.getStatus(req.auth!.companyId);
  return res.json(status);
});

export const connect = asyncHandler(async (req: Request, res: Response) => {
  const status = await whatsappService.connect(req.auth!.companyId);
  return res.json(status);
});

export const disconnect = asyncHandler(async (req: Request, res: Response) => {
  const status = await whatsappService.disconnect(req.auth!.companyId);
  return res.json(status);
});

export const sendTest = asyncHandler(async (req: Request, res: Response) => {
  await whatsappService.sendTestMessage(req.auth!.companyId, req.body.to);
  return res.json({ message: 'Mensagem de teste enviada.' });
});

export const getBotState = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await whatsappService.getBotState(req.auth!.companyId, req.params.id));
});

export const resumeBot = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await whatsappService.resumeBot(req.auth!.companyId, req.params.id));
});

export const replyToLead =asyncHandler(async (req: Request, res: Response) => {
  const lead = await whatsappService.replyToLead(req.auth!.companyId, req.params.id, req.body.text);
  return res.json({ lead });
});
