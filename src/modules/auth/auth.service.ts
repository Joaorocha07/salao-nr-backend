import { MembershipStatus, Role } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
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
import { env } from '../../config/env';

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
  user: { id: string; name: string; email: string; imageUrl: string | null; isSuperAdmin: boolean };
  company: { id: string; name: string; slug: string };
  role: Role;
  allowedScreens: string[];
};

async function issueSession(userId: string, companyId: string, role: Role): Promise<SessionResult> {
  const [user, company, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    prisma.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId, companyId } } }),
  ]);

  const accessToken = signAccessToken({ sub: userId, companyId, role, isSuperAdmin: user.isSuperAdmin });
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
    user: { id: user.id, name: user.name, email: user.email, imageUrl: user.imageUrl, isSuperAdmin: user.isSuperAdmin },
    company: { id: company.id, name: company.name, slug: company.slug },
    role,
    allowedScreens: membership.allowedScreens,
  };
}

export const MAX_COMPANIES = 2;

async function assertCanCreateCompany(): Promise<void> {
  const count = await prisma.company.count({ where: { active: true } });
  if (count >= MAX_COMPANIES) {
    throw HttpError.forbidden('Limite de empresas cadastradas atingido.');
  }
}

// Super-admins têm ADMIN garantido em toda empresa ativa, mesmo em empresas
// criadas depois de virarem super-admin — por isso essa sincronização roda
// a cada login/refresh em vez de só uma vez.
async function ensureSuperAdminMemberships(userId: string): Promise<void> {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });
  await Promise.all(
    companies.map((company) =>
      prisma.companyMembership.upsert({
        where: { userId_companyId: { userId, companyId: company.id } },
        update: { role: Role.ADMIN, active: true, approvalStatus: MembershipStatus.ACTIVE },
        create: {
          userId,
          companyId: company.id,
          role: Role.ADMIN,
          active: true,
          approvalStatus: MembershipStatus.ACTIVE,
        },
      }),
    ),
  );
}

export async function listPublicCompanies() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function registerAdminWithCompany(input: { companyName: string; name: string; email: string; password: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw HttpError.conflict('Este e-mail já está cadastrado.');

  await assertCanCreateCompany();

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
    data: { userId: user.id, companyId: company.id, role: Role.ADMIN, approvalStatus: MembershipStatus.ACTIVE },
  });

  return issueSession(user.id, company.id, Role.ADMIN);
}

export async function registerEmployee(input: { name: string; email: string; password: string; companyId: string }) {
  const company = await prisma.company.findUnique({ where: { id: input.companyId, active: true } });
  if (!company) throw HttpError.notFound('Empresa não encontrada.');

  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  let userId: string;
  if (existing) {
    const existingMembership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: existing.id, companyId: input.companyId } },
    });
    if (existingMembership) {
      if (existingMembership.approvalStatus === MembershipStatus.PENDING) {
        throw HttpError.conflict('Você já tem um cadastro pendente nesta empresa. Aguarde a aprovação do administrador.');
      }
      throw HttpError.conflict('Você já tem um cadastro nesta empresa.');
    }
    userId = existing.id;
  } else {
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });
    userId = user.id;
  }

  await prisma.companyMembership.create({
    data: {
      userId,
      companyId: input.companyId,
      role: Role.EMPLOYEE,
      approvalStatus: MembershipStatus.PENDING,
    },
  });
}

export type LoginResult =
  | { status: 'ok'; session: SessionResult }
  | { status: 'select-company'; preAuthToken: string; companies: { id: string; name: string; slug: string; role: Role }[] };

export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { where: { active: true }, include: { company: true } } },
  });

  const invalidCredentials = () => HttpError.unauthorized('E-mail ou senha inválidos.');

  if (!user || !user.active) throw invalidCredentials();

  if (!user.passwordHash) {
    throw HttpError.unauthorized('Esta conta usa login via Google. Clique em "Entrar com Google".');
  }

  const passwordMatches = await comparePassword(input.password, user.passwordHash);
  if (!passwordMatches) throw invalidCredentials();

  if (user.isSuperAdmin) {
    await ensureSuperAdminMemberships(user.id);
    user.memberships = await prisma.companyMembership.findMany({
      where: { userId: user.id, active: true },
      include: { company: true },
    });
  }

  const pendingMemberships = user.memberships.filter(
    (m) => m.approvalStatus === MembershipStatus.PENDING && m.company.active,
  );
  const activeMemberships = user.memberships.filter(
    (m) => m.approvalStatus === MembershipStatus.ACTIVE && m.company.active,
  );

  if (activeMemberships.length === 0) {
    if (pendingMemberships.length > 0) {
      throw HttpError.forbidden('Seu cadastro está aguardando aprovação do administrador.');
    }
    throw HttpError.forbidden('Este usuário não tem acesso a nenhuma empresa ativa.');
  }

  if (activeMemberships.length === 1) {
    const membership = activeMemberships[0];
    const session = await issueSession(user.id, membership.companyId, membership.role);
    return { status: 'ok', session };
  }

  const preAuthToken = signPreAuthToken({ sub: user.id });
  return {
    status: 'select-company',
    preAuthToken,
    companies: activeMemberships.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug, role: m.role })),
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

  if (
    !membership ||
    !membership.active ||
    membership.approvalStatus !== MembershipStatus.ACTIVE ||
    !membership.company.active ||
    !membership.user.active
  ) {
    throw HttpError.forbidden('Você não tem acesso a esta empresa.');
  }

  return issueSession(userId, membership.companyId, membership.role);
}

export async function switchCompanySession(userId: string, companyId: string): Promise<SessionResult> {
  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    include: { company: true, user: true },
  });

  if (
    !membership ||
    !membership.active ||
    membership.approvalStatus !== MembershipStatus.ACTIVE ||
    !membership.company.active ||
    !membership.user.active
  ) {
    throw HttpError.forbidden('Você não tem acesso a esta empresa.');
  }

  return issueSession(userId, companyId, membership.role);
}

export type GoogleAuthResult =
  | { status: 'ok'; session: SessionResult }
  | { status: 'select-company'; preAuthToken: string; companies: { id: string; name: string; slug: string; role: Role }[] }
  | { status: 'pending' }
  | { status: 'company-required'; name: string; email: string };

export async function googleAuth(input: { credential: string; companyId?: string }): Promise<GoogleAuthResult> {
  if (!env.GOOGLE_CLIENT_ID) throw HttpError.badRequest('Login com Google não está configurado neste servidor.');

  let googleEmail: string;
  let googleName: string;
  let googleId: string;
  let googleImageUrl: string | undefined;

  try {
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: input.credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload?.sub) throw new Error('Payload inválido.');
    googleEmail = payload.email;
    googleName = payload.name || payload.given_name || payload.email;
    googleId = payload.sub;
    googleImageUrl = payload.picture;
  } catch {
    throw HttpError.unauthorized('Credencial Google inválida ou expirada.');
  }

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email: googleEmail }] },
    include: {
      memberships: {
        where: { active: true },
        include: { company: true },
      },
    },
  });

  if (!user) {
    if (!input.companyId) {
      return { status: 'company-required', name: googleName, email: googleEmail };
    }
    const company = await prisma.company.findUnique({ where: { id: input.companyId, active: true } });
    if (!company) throw HttpError.notFound('Empresa não encontrada.');

    const newUser = await prisma.user.create({
      data: { name: googleName, email: googleEmail, googleId, imageUrl: googleImageUrl },
    });
    await prisma.companyMembership.create({
      data: { userId: newUser.id, companyId: input.companyId, role: Role.EMPLOYEE, approvalStatus: MembershipStatus.PENDING },
    });
    return { status: 'pending' };
  }

  const userUpdates: { googleId?: string; imageUrl?: string } = {};
  if (!user.googleId) userUpdates.googleId = googleId;
  if (googleImageUrl && googleImageUrl !== user.imageUrl) userUpdates.imageUrl = googleImageUrl;
  if (Object.keys(userUpdates).length > 0) {
    await prisma.user.update({ where: { id: user.id }, data: userUpdates });
  }

  if (user.isSuperAdmin) {
    await ensureSuperAdminMemberships(user.id);
    user.memberships = await prisma.companyMembership.findMany({
      where: { userId: user.id, active: true },
      include: { company: true },
    });
  }

  const activeMemberships = user.memberships.filter(
    (m) => m.approvalStatus === MembershipStatus.ACTIVE && m.company.active,
  );
  const pendingMemberships = user.memberships.filter(
    (m) => m.approvalStatus === MembershipStatus.PENDING && m.company.active,
  );

  if (activeMemberships.length === 0) {
    if (input.companyId) {
      const existingMembership = await prisma.companyMembership.findUnique({
        where: { userId_companyId: { userId: user.id, companyId: input.companyId } },
      });
      if (existingMembership) {
        return existingMembership.approvalStatus === MembershipStatus.PENDING
          ? { status: 'pending' }
          : { status: 'company-required', name: googleName, email: googleEmail };
      }
      const company = await prisma.company.findUnique({ where: { id: input.companyId, active: true } });
      if (!company) throw HttpError.notFound('Empresa não encontrada.');
      await prisma.companyMembership.create({
        data: { userId: user.id, companyId: input.companyId, role: Role.EMPLOYEE, approvalStatus: MembershipStatus.PENDING },
      });
      return { status: 'pending' };
    }
    if (pendingMemberships.length > 0) return { status: 'pending' };
    return { status: 'company-required', name: googleName, email: googleEmail };
  }

  if (activeMemberships.length === 1) {
    const session = await issueSession(user.id, activeMemberships[0].companyId, activeMemberships[0].role);
    return { status: 'ok', session };
  }

  const preAuthToken = signPreAuthToken({ sub: user.id });
  return {
    status: 'select-company',
    preAuthToken,
    companies: activeMemberships.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug, role: m.role })),
  };
}

export async function refreshSession(rawRefreshToken: string): Promise<SessionResult> {
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw HttpError.unauthorized('Sessão expirada. Faça login novamente.');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: stored.userId } });
  if (user.isSuperAdmin) await ensureSuperAdminMemberships(user.id);

  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: stored.userId, companyId: stored.companyId } },
  });
  if (!membership || !membership.active || membership.approvalStatus !== MembershipStatus.ACTIVE) {
    throw HttpError.forbidden('Acesso a esta empresa foi revogado.');
  }

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

  const accessToken = signAccessToken({
    sub: stored.userId,
    companyId: stored.companyId,
    role: membership.role,
    isSuperAdmin: user.isSuperAdmin,
  });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: stored.companyId } });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt: refreshTokenExpiryDate(),
    user: { id: user.id, name: user.name, email: user.email, imageUrl: user.imageUrl, isSuperAdmin: user.isSuperAdmin },
    company: { id: company.id, name: company.name, slug: company.slug },
    role: membership.role,
    allowedScreens: membership.allowedScreens,
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

export const PASSWORD_RESET_MINUTES = PASSWORD_RESET_EXPIRY_MS / 60000;

export async function requestPasswordReset(email: string): Promise<{ token: string; name: string } | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) return null;

  const token = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
    },
  });

  return { token, name: user.name };
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
  if (!user.passwordHash) throw HttpError.badRequest('Esta conta usa login via Google e não possui senha para alterar.');
  const matches = await comparePassword(currentPassword, user.passwordHash);
  if (!matches) throw HttpError.badRequest('Senha atual incorreta.');

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
