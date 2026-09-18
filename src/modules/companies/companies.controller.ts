import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as companiesService from './companies.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const company = await companiesService.createCompany(req.auth!.userId, req.body);
  return res.status(201).json({ company });
});
