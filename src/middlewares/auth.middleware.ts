import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { HttpError } from '../lib/httpError';
import { verifyAccessToken } from '../lib/jwt';

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) return next(HttpError.unauthorized('Token de acesso ausente.'));

  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, companyId: payload.companyId, role: payload.role, isSuperAdmin: payload.isSuperAdmin };
    next();
  } catch {
    next(HttpError.unauthorized('Token de acesso inválido ou expirado.'));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(HttpError.unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(HttpError.forbidden('Esta ação exige um perfil com mais permissões.'));
    }
    next();
  };
}
