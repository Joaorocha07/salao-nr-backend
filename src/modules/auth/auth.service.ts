import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import { comparePassword, hashPassword } from '../../lib/password';
import {
  generateOpaqueToken,
  hashToken,
  refreshTokenExpiryDate,
  signAccessToken,
  signPreAuthToken,
  verifyPreAuthToken,
} from '../../lib/jwt';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || 'empresa';
  let slug = root;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.company.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${root}-${suffix}`;
  }
  return slug;
}

export type SessionResult = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: { id: string; name: string; email: string };
  company: { id: string; name: string; slug: string };
  role: Role;
};

async function issueSession(userId: string, companyId: string, role: Role): Promise<SessionResult> {
  const [user, company] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
  ]);

  const accessToken = signAccessToken({ sub: userId, companyId, role });
  const refreshToken = generateOpaqueToken();

  await prisma.refreshToken.create({
    data: {
      userId,
      companyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiryDate(),
    },
  });

  return {
    accessToken,
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiryDate(),
    user: { id: user.id, name: user.name, email: user.email },
    company: { id: company.id, name: company.name, slug: company.slug },
    role,
  };
}

export async function registerAdminWithCompany(input: { companyName: string; name: string; email: string; password: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw HttpError.conflict('Este e-mail já está cadastrado.');

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.companyName);

  const company = await prisma.company.create({
    data: {
      name: input.companyName,
      slug,
      settings: { create: { salonName: input.companyName, ownerName: input.name, email: input.email } },
    },
  });

  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash },
  });

  await prisma.companyMembership.create({
    data: { userId: user.id, companyId: company.id, role: Role.ADMIN },
  });

  return issueSession(user.id, company.id, Role.ADMIN);
}

export type LoginResult =
  | { status: 'ok'; session: SessionResult }
  | { status: 'select-company'; preAuthToken: string; companies: { id: string; name: string; slug: string; role: Role }[] };

export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { where: { active: true }, include: { company: true } } },
  });

  // Mensagem genérica para não revelar se o e-mail existe.
  const invalidCredentials = () => HttpError.unauthorized('E-mail ou senha inválidos.');

  if (!user || !user.active) throw invalidCredentials();

  const passwordMatches = await comparePassword(input.password, user.passwordHash);
  if (!passwordMatches) throw invalidCredentials();

  const memberships = user.memberships.filter((m) => m.company.active);
  if (memberships.length === 0) {
    throw HttpError.forbidden('Este usuário não tem acesso a nenhuma empresa ativa.');
  }

  if (memberships.length === 1) {
    const membership = memberships[0];
    const session = await issueSession(user.id, membership.companyId, membership.role);
    return { status: 'ok', session };
  }

  const preAuthToken = signPreAuthToken({ sub: user.id });
  return {
    status: 'select-company',
    preAuthToken,
    companies: memberships.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug, role: m.role })),
  };
}

export async function selectCompany(input: { preAuthToken: string; companyId: string }): Promise<SessionResult> {
  let userId: string;
  try {
    userId = verifyPreAuthToken(input.preAuthToken).sub;
  } catch {
    throw HttpError.unauthorized('Sessão de login expirada. Faça login novamente.');
  }

  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId: input.companyId } },
    include: { company: true, user: true },
  });

  if (!membership || !membership.active || !membership.company.active || !membership.user.active) {
    throw HttpError.forbidden('Você não tem acesso a esta empresa.');
  }

  return issueSession(userId, membership.companyId, membership.role);
}

export async function refreshSession(rawRefreshToken: string): Promise<SessionResult> {
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw HttpError.unauthorized('Sessão expirada. Faça login novamente.');
  }

  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: stored.userId, companyId: stored.companyId } },
  });
  if (!membership || !membership.active) {
    throw HttpError.forbidden('Acesso a esta empresa foi revogado.');
  }

  // Rotação: o token usado é revogado e um novo é emitido. Reuso de um
  // token já revogado indica possível roubo do refresh token.
  const newRefreshToken = generateOpaqueToken();
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedByTokenHash: hashToken(newRefreshToken) },
    }),
    prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        companyId: stored.companyId,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: refreshTokenExpiryDate(),
      },
    }),
  ]);

  const accessToken = signAccessToken({ sub: stored.userId, companyId: stored.companyId, role: membership.role });
  const [user, company] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: stored.userId } }),
    prisma.company.findUniqueOrThrow({ where: { id: stored.companyId } }),
  ]);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt: refreshTokenExpiryDate(),
    user: { id: user.id, name: user.name, email: user.email },
    company: { id: company.id, name: company.name, slug: company.slug },
    role: membership.role,
  };
}

export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

const PASSWORD_RESET_EXPIRY_MS = 30 * 60 * 1000;

export async function requestPasswordReset(email: string): Promise<{ token: string } | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Resposta idêntica para e-mail existente ou não, evitando enumeração.
  if (!user || !user.active) return null;

  const token = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
    },
  });

  // Integração real de e-mail é um ponto de extensão: plugue aqui um
  // provedor (SES, Postmark, Resend...) para enviar `token` por e-mail.
  return { token };
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw HttpError.badRequest('Link de recuperação inválido ou expirado.');
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const matches = await comparePassword(currentPassword, user.passwordHash);
  if (!matches) throw HttpError.badRequest('Senha atual incorreta.');

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // Revoga todas as sessões de refresh existentes por segurança.
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
