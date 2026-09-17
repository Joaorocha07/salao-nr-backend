import { Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/httpError';
import { prisma } from '../../lib/prisma';
import * as authService from './auth.service';

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/auth',
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(env.REFRESH_COOKIE_NAME, { path: '/api/auth' });
}

function sessionResponse(res: Response, session: authService.SessionResult) {
  setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
  return res.json({
    accessToken: session.accessToken,
    user: session.user,
    company: session.company,
    role: session.role,
  });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const session = await authService.registerAdminWithCompany(req.body);
  return sessionResponse(res.status(201), session);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body);
  if (result.status === 'select-company') {
    return res.json({ status: 'select-company', preAuthToken: result.preAuthToken, companies: result.companies });
  }
  return sessionResponse(res, result.session);
});

export const selectCompany = asyncHandler(async (req: Request, res: Response) => {
  const session = await authService.selectCompany(req.body);
  return sessionResponse(res, session);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[env.REFRESH_COOKIE_NAME] ?? req.body?.refreshToken;
  if (!token) throw HttpError.unauthorized('Refresh token ausente.');
  const session = await authService.refreshSession(token);
  return sessionResponse(res, session);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[env.REFRESH_COOKIE_NAME] ?? req.body?.refreshToken;
  if (token) await authService.revokeRefreshToken(token);
  clearRefreshCookie(res);
  return res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  const [user, company] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true, email: true } }),
    prisma.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { id: true, name: true, slug: true } }),
  ]);
  return res.json({ user, company, role: auth.role });
});

export const myCompanies = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  const memberships = await prisma.companyMembership.findMany({
    where: { userId: auth.userId, active: true, company: { active: true } },
    include: { company: true },
  });
  return res.json({
    companies: memberships.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug, role: m.role })),
  });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.requestPasswordReset(req.body.email);
  if (result && env.NODE_ENV !== 'production') {
    // Facilita testes locais sem provedor de e-mail configurado.
    console.log(`[dev] Token de recuperação de senha para ${req.body.email}: ${result.token}`);
  }
  // Sempre 200, mesmo se o e-mail não existir, para não revelar cadastros.
  return res.json({ message: 'Se o e-mail existir em nossa base, enviaremos instruções de recuperação.' });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.password);
  return res.json({ message: 'Senha redefinida com sucesso.' });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  await authService.changePassword(auth.userId, req.body.currentPassword, req.body.newPassword);
  return res.json({ message: 'Senha atualizada com sucesso.' });
});
