import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as leadsService from './leads.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const leads = await leadsService.listLeads(req.auth!.companyId, req.query as never);
  return res.json({ leads });
});

export const history = asyncHandler(async (req: Request, res: Response) => {
  const records = await leadsService.listServiceHistory(req.auth!.companyId);
  return res.json({ records });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.getLead(req.auth!.companyId, req.params.id);
  return res.json({ lead });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.createLead(req.auth!.companyId, req.body);
  return res.status(201).json({ lead });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.updateLead(req.auth!.companyId, req.params.id, req.body);
  return res.json({ lead });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await leadsService.deleteLead(req.auth!.companyId, req.params.id);
  return res.status(204).send();
});

export const schedule = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.scheduleAppointment(req.auth!.companyId, req.params.id, req.body.date, req.body.time, req.body.services);
  return res.json({ lead });
});

export const cancelAppointment = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.cancelAppointment(req.auth!.companyId, req.params.id);
  return res.json({ lead });
});

export const addNote = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.addNote(req.auth!.companyId, req.params.id, req.body.text);
  return res.status(201).json({ lead });
});

export const addMessage = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.addMessage(req.auth!.companyId, req.params.id, req.body.text, req.body.own);
  return res.status(201).json({ lead });
});

export const deleteHistoryRecord = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.deleteHistoryRecord(req.auth!.companyId, req.params.id, req.params.recordId);
  return res.json({ lead });
});
