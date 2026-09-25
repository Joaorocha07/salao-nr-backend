import { Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/httpError';
import { appUrl, isMailConfigured, passwordResetEmail, sendMail } from '../../lib/mailer';
import { prisma } from '../../lib/prisma';
import * as authService from './auth.service';

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  // Frontend (Vercel) e backend (Render) são domínios diferentes, então o
  // cookie precisa de SameSite=None para ser enviado em requisições cross-site.
  // Navegadores exigem Secure sempre que SameSite=None é usado.
  const crossSite = env.RENDER || env.NODE_ENV === 'production';
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: crossSite ? true : env.COOKIE_SECURE,
    sameSite: crossSite ? 'none' : 'lax',
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
    allowedScreens: session.allowedScreens,
  });
}

export const publicCompanies = asyncHandler(async (_req: Request, res: Response) => {
  const companies = await authService.listPublicCompanies();
  return res.json({ companies });
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const session = await authService.registerAdminWithCompany(req.body);
  return sessionResponse(res.status(201), session);
});

export const registerEmployee = asyncHandler(async (req: Request, res: Response) => {
  await authService.registerEmployee(req.body);
  return res.status(201).json({ message: 'Cadastro enviado com sucesso. Aguarde a aprovação do administrador.' });
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

export const switchCompany = asyncHandler(async (req: Request, res: Response) => {
  const session = await authService.switchCompanySession(req.auth!.userId, req.body.companyId);
  return sessionResponse(res, session);
});

export const googleAuth = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.googleAuth(req.body);

  if (result.status === 'ok') return sessionResponse(res, result.session);
  if (result.status === 'select-company') {
    return res.json({ status: 'select-company', preAuthToken: result.preAuthToken, companies: result.companies });
  }
  if (result.status === 'pending') {
    return res.status(202).json({ status: 'pending', message: 'Cadastro enviado. Aguarde a aprovação do administrador.' });
  }
  // company-required
  return res.status(200).json({ status: 'company-required', name: result.name, email: result.email });
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
  const [user, company, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, imageUrl: true, isSuperAdmin: true },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { id: true, name: true, slug: true } }),
    prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: auth.userId, companyId: auth.companyId } },
      select: { allowedScreens: true },
    }),
  ]);
  return res.json({ user, company, role: auth.role, allowedScreens: membership.allowedScreens });
});

export const myCompanies = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  const memberships = await prisma.companyMembership.findMany({
    where: { userId: auth.userId, active: true, approvalStatus: 'ACTIVE', company: { active: true } },
    include: { company: true },
  });
  return res.json({
    companies: memberships.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug, role: m.role })),
  });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.requestPasswordReset(req.body.email);
  if (result) {
    const link = `${appUrl()}/redefinir-senha?token=${result.token}`;
    if (isMailConfigured()) {
      // Em segundo plano: a resposta não pode demorar mais quando o e-mail existe
      // (senão dá para descobrir quais e-mails estão cadastrados).
      const email = passwordResetEmail(result.name, link, authService.PASSWORD_RESET_MINUTES);
      sendMail({ to: req.body.email, ...email }).catch((err) => {
        console.error(`Falha ao enviar o e-mail de recuperação de senha para ${req.body.email}:`, err);
      });
    } else if (env.NODE_ENV !== 'production') {
      console.log(`[dev] SMTP não configurado. Link de recuperação de senha para ${req.body.email}: ${link}`);
    } else {
      console.error('SMTP não configurado: não foi possível enviar o e-mail de recuperação de senha.');
    }
  }
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
