import { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as usersService from './users.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const members = await usersService.listCompanyMembers(req.auth!.companyId);
  return res.json({ members });
});

export const listPending = asyncHandler(async (req: Request, res: Response) => {
  const members = await usersService.listPendingMembers(req.auth!.companyId);
  return res.json({ members });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const member = await usersService.approveMember(req.auth!.companyId, req.params.membershipId);
  return res.json({ member });
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  await usersService.rejectMember(req.auth!.companyId, req.params.membershipId);
  return res.status(204).send();
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const members = await usersService.addCompanyMember(
    { userId: req.auth!.userId, isSuperAdmin: req.auth!.isSuperAdmin },
    req.body,
  );
  return res.status(201).json({ members });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const member = await usersService.updateCompanyMember(
    { isSuperAdmin: req.auth!.isSuperAdmin },
    req.auth!.companyId,
    req.params.membershipId,
    req.body,
  );
  return res.json({ member });
});

export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const result = await usersService.listMemberCompanies(
    { userId: req.auth!.userId, isSuperAdmin: req.auth!.isSuperAdmin },
    req.auth!.companyId,
    req.params.membershipId,
  );
  return res.json(result);
});

export const grantCompany = asyncHandler(async (req: Request, res: Response) => {
  const result = await usersService.grantCompanyAccess(
    { userId: req.auth!.userId, isSuperAdmin: req.auth!.isSuperAdmin },
    req.auth!.companyId,
    req.params.membershipId,
    req.params.companyId,
  );
  return res.status(201).json(result);
});

export const revokeCompany = asyncHandler(async (req: Request, res: Response) => {
  const result = await usersService.revokeCompanyAccess(
    { userId: req.auth!.userId, isSuperAdmin: req.auth!.isSuperAdmin },
    req.auth!.companyId,
    req.params.membershipId,
    req.params.companyId,
  );
  return res.json(result);
});
