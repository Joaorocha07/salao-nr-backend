import { MembershipStatus, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import { MAX_COMPANIES } from '../auth/auth.service';

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

export async function createCompany(userId: string, input: { name: string }) {
  const activeCount = await prisma.company.count({ where: { active: true } });
  if (activeCount >= MAX_COMPANIES) {
    throw HttpError.forbidden('Limite de empresas cadastradas atingido.');
  }

  const [slug, user] = await Promise.all([
    uniqueSlug(input.name),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } }),
  ]);

  const company = await prisma.company.create({
    data: {
      name: input.name,
      slug,
      settings: { create: { salonName: input.name, ownerName: user.name, email: user.email } },
    },
  });

  await prisma.companyMembership.create({
    data: {
      userId,
      companyId: company.id,
      role: Role.ADMIN,
      approvalStatus: MembershipStatus.ACTIVE,
    },
  });

  return { id: company.id, name: company.name, slug: company.slug };
}

export async function updateCompany(userId: string, companyId: string, input: { name: string }) {
  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });

  if (!membership || !membership.active || membership.approvalStatus !== MembershipStatus.ACTIVE || membership.role !== Role.ADMIN) {
    throw HttpError.forbidden('Você não tem permissão para editar esta empresa.');
  }

  const company = await prisma.company.update({ where: { id: companyId }, data: { name: input.name } });
  return { id: company.id, name: company.name, slug: company.slug };
}
