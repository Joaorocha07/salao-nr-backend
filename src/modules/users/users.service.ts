import { MembershipStatus, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import { hashPassword } from '../../lib/password';
import { generateOpaqueToken } from '../../lib/jwt';

export async function listCompanyMembers(companyId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, approvalStatus: MembershipStatus.ACTIVE },
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
    where: { companyId, approvalStatus: MembershipStatus.PENDING },
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
  companyId: string,
  input: { name: string; email: string; role: Role; password?: string; allowedScreens?: string[] },
) {
  let user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    const passwordHash = await hashPassword(input.password ?? generateOpaqueToken());
    user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash } });
  } else {
    const existingMembership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
    });
    if (existingMembership) throw HttpError.conflict('Este e-mail já está cadastrado nesta empresa.');
  }

  const membership = await prisma.companyMembership.create({
    data: {
      userId: user.id,
      companyId,
      role: input.role,
      approvalStatus: MembershipStatus.ACTIVE,
      allowedScreens: input.allowedScreens ?? [],
    },
    include: { user: true },
  });

  return {
    membershipId: membership.id,
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    active: membership.active,
    allowedScreens: membership.allowedScreens,
  };
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
  companyId: string,
  membershipId: string,
  input: { name?: string; role?: Role; active?: boolean; allowedScreens?: string[] },
) {
  const membership = await prisma.companyMembership.findFirst({
    where: { id: membershipId, companyId, approvalStatus: MembershipStatus.ACTIVE },
    include: { user: true },
  });
  if (!membership) throw HttpError.notFound('Usuário não encontrado nesta empresa.');

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
