import { MembershipStatus, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import { hashPassword } from '../../lib/password';
import { generateOpaqueToken } from '../../lib/jwt';

export async function listCompanyMembers(companyId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, approvalStatus: MembershipStatus.ACTIVE, user: { isSuperAdmin: false } },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    active: m.active && m.user.active,
    allowedScreens: m.allowedScreens,
  }));
}

export async function listPendingMembers(companyId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, approvalStatus: MembershipStatus.PENDING, user: { isSuperAdmin: false } },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function approveMember(companyId: string, membershipId: string) {
  const membership = await prisma.companyMembership.findFirst({
    where: { id: membershipId, companyId, approvalStatus: MembershipStatus.PENDING },
    include: { user: true },
  });
  if (!membership) throw HttpError.notFound('Solicitação não encontrada.');

  const updated = await prisma.companyMembership.update({
    where: { id: membershipId },
    data: { approvalStatus: MembershipStatus.ACTIVE },
    include: { user: true },
  });

  return {
    membershipId: updated.id,
    id: updated.user.id,
    name: updated.user.name,
    email: updated.user.email,
    role: updated.role,
    active: updated.active,
    allowedScreens: updated.allowedScreens,
  };
}

export async function rejectMember(companyId: string, membershipId: string) {
  const membership = await prisma.companyMembership.findFirst({
    where: { id: membershipId, companyId, approvalStatus: MembershipStatus.PENDING },
  });
  if (!membership) throw HttpError.notFound('Solicitação não encontrada.');

  await prisma.companyMembership.update({
    where: { id: membershipId },
    data: { approvalStatus: MembershipStatus.REJECTED, active: false },
  });
}

export async function addCompanyMember(
  requester: { userId: string; isSuperAdmin: boolean },
  input: { name: string; email: string; role: Role; password?: string; allowedScreens?: string[]; companyIds: string[] },
) {
  const companyIds = Array.from(new Set(input.companyIds));

  if (input.role === Role.ADMIN && !requester.isSuperAdmin) {
    throw HttpError.forbidden('Somente o administrador master pode cadastrar novos administradores.');
  }

  const companies = await prisma.company.findMany({ where: { id: { in: companyIds }, active: true } });
  if (companies.length !== companyIds.length) throw HttpError.notFound('Uma ou mais empresas não foram encontradas.');

  if (!requester.isSuperAdmin) {
    const adminMemberships = await prisma.companyMembership.count({
      where: {
        userId: requester.userId,
        companyId: { in: companyIds },
        role: Role.ADMIN,
        active: true,
        approvalStatus: MembershipStatus.ACTIVE,
      },
    });
    if (adminMemberships !== companyIds.length) {
      throw HttpError.forbidden('Você só pode vincular usuários às empresas que administra.');
    }
  }

  let user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    const passwordHash = await hashPassword(input.password ?? generateOpaqueToken());
    user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash } });
  } else {
    const existingMemberships = await prisma.companyMembership.findMany({
      where: { userId: user.id, companyId: { in: companyIds } },
    });
    if (existingMemberships.length > 0) throw HttpError.conflict('Este e-mail já está cadastrado em uma das empresas selecionadas.');
  }

  const memberships = await Promise.all(
    companyIds.map((companyId) =>
      prisma.companyMembership.create({
        data: {
          userId: user!.id,
          companyId,
          role: input.role,
          approvalStatus: MembershipStatus.ACTIVE,
          allowedScreens: input.allowedScreens ?? [],
        },
        include: { user: true, company: true },
      }),
    ),
  );

  return memberships.map((membership) => ({
    membershipId: membership.id,
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    active: membership.active,
    allowedScreens: membership.allowedScreens,
    company: { id: membership.company.id, name: membership.company.name, slug: membership.company.slug },
  }));
}

async function protectLastActiveAdmin(companyId: string, membershipId: string) {
  const activeAdmins = await prisma.companyMembership.count({
    where: { companyId, role: Role.ADMIN, active: true, approvalStatus: MembershipStatus.ACTIVE },
  });
  const target = await prisma.companyMembership.findFirst({ where: { id: membershipId, companyId } });
  if (target?.role === Role.ADMIN && target.active && activeAdmins <= 1) {
    throw HttpError.badRequest('Mantenha pelo menos um administrador ativo nesta empresa.');
  }
}

export async function updateCompanyMember(
  requester: { isSuperAdmin: boolean },
  companyId: string,
  membershipId: string,
  input: { name?: string; role?: Role; active?: boolean; allowedScreens?: string[] },
) {
  const membership = await prisma.companyMembership.findFirst({
    where: { id: membershipId, companyId, approvalStatus: MembershipStatus.ACTIVE },
    include: { user: true },
  });
  if (!membership) throw HttpError.notFound('Usuário não encontrado nesta empresa.');

  if (input.role === Role.ADMIN && membership.role !== Role.ADMIN && !requester.isSuperAdmin) {
    throw HttpError.forbidden('Somente o administrador master pode promover usuários a administrador.');
  }

  if (input.active === false || input.role === Role.EMPLOYEE) {
    await protectLastActiveAdmin(companyId, membershipId);
  }

  const [, updatedMembership] = await prisma.$transaction([
    input.name
      ? prisma.user.update({ where: { id: membership.userId }, data: { name: input.name } })
      : prisma.user.findUniqueOrThrow({ where: { id: membership.userId } }),
    prisma.companyMembership.update({
      where: { id: membershipId },
      data: { role: input.role, active: input.active, allowedScreens: input.allowedScreens },
      include: { user: true },
    }),
  ]);

  return {
    membershipId: updatedMembership.id,
    id: updatedMembership.user.id,
    name: updatedMembership.user.name,
    email: updatedMembership.user.email,
    role: updatedMembership.role,
    active: updatedMembership.active,
    allowedScreens: updatedMembership.allowedScreens,
  };
}

type Requester = { userId: string; isSuperAdmin: boolean };

async function resolveManageableCompanyIds(requester: Requester): Promise<Set<string> | 'all'> {
  if (requester.isSuperAdmin) return 'all';
  const adminMemberships = await prisma.companyMembership.findMany({
    where: { userId: requester.userId, role: Role.ADMIN, active: true, approvalStatus: MembershipStatus.ACTIVE },
    select: { companyId: true },
  });
  return new Set(adminMemberships.map((m) => m.companyId));
}

async function assertManageable(requester: Requester, targetCompanyId: string) {
  const manageable = await resolveManageableCompanyIds(requester);
  if (manageable === 'all' || manageable.has(targetCompanyId)) return;
  throw HttpError.forbidden('Você só pode gerenciar acesso às empresas que administra.');
}

// Resolve o funcionário-alvo a partir de um membershipId já pertencente à
// empresa atual do requisitante — isso prova que existe alguma relação
// legítima entre quem pede e quem está sendo gerenciado antes de expor ou
// alterar o acesso dele a outras empresas. Nunca expõe super-admins: eles
// têm ADMIN automático em toda empresa e não devem aparecer para ninguém.
async function resolveManagedUser(companyId: string, membershipId: string) {
  const membership = await prisma.companyMembership.findFirst({
    where: { id: membershipId, companyId, approvalStatus: MembershipStatus.ACTIVE },
    include: { user: true },
  });
  if (!membership || membership.user.isSuperAdmin) throw HttpError.notFound('Usuário não encontrado nesta empresa.');
  return membership;
}

export async function listMemberCompanies(requester: Requester, companyId: string, membershipId: string) {
  const membership = await resolveManagedUser(companyId, membershipId);

  const [companies, userMemberships, manageable] = await Promise.all([
    prisma.company.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.companyMembership.findMany({ where: { userId: membership.userId, approvalStatus: MembershipStatus.ACTIVE } }),
    resolveManageableCompanyIds(requester),
  ]);

  const byCompanyId = new Map(userMemberships.map((m) => [m.companyId, m]));

  return {
    userId: membership.userId,
    companies: companies.map((company) => {
      const m = byCompanyId.get(company.id);
      return {
        companyId: company.id,
        companyName: company.name,
        membershipId: m?.id ?? null,
        role: m?.role ?? null,
        active: m?.active ?? false,
        manageable: manageable === 'all' || manageable.has(company.id),
      };
    }),
  };
}

export async function grantCompanyAccess(requester: Requester, companyId: string, membershipId: string, targetCompanyId: string) {
  const membership = await resolveManagedUser(companyId, membershipId);
  if (membership.userId === requester.userId) throw HttpError.badRequest('Você não pode alterar seu próprio acesso por aqui.');
  await assertManageable(requester, targetCompanyId);

  const company = await prisma.company.findUnique({ where: { id: targetCompanyId, active: true } });
  if (!company) throw HttpError.notFound('Empresa não encontrada.');

  const existing = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: membership.userId, companyId: targetCompanyId } },
  });

  if (existing) {
    if (existing.approvalStatus === MembershipStatus.PENDING) {
      throw HttpError.conflict('Este usuário já tem um cadastro pendente nesta empresa.');
    }
    await prisma.companyMembership.update({ where: { id: existing.id }, data: { active: true, approvalStatus: MembershipStatus.ACTIVE } });
  } else {
    await prisma.companyMembership.create({
      data: { userId: membership.userId, companyId: targetCompanyId, role: Role.EMPLOYEE, approvalStatus: MembershipStatus.ACTIVE },
    });
  }

  return listMemberCompanies(requester, companyId, membershipId);
}

export async function revokeCompanyAccess(requester: Requester, companyId: string, membershipId: string, targetCompanyId: string) {
  const membership = await resolveManagedUser(companyId, membershipId);
  if (membership.userId === requester.userId) throw HttpError.badRequest('Você não pode alterar seu próprio acesso por aqui.');
  await assertManageable(requester, targetCompanyId);

  const target = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: membership.userId, companyId: targetCompanyId } },
  });
  if (target?.active) {
    if (target.role === Role.ADMIN) await protectLastActiveAdmin(targetCompanyId, target.id);
    await prisma.companyMembership.update({ where: { id: target.id }, data: { active: false } });
  }

  return listMemberCompanies(requester, companyId, membershipId);
}
