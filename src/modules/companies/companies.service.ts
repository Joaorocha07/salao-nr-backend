import { MembershipStatus, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';

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
  const slug = await uniqueSlug(input.name);

  const company = await prisma.company.create({
    data: {
      name: input.name,
      slug,
      settings: { create: { salonName: input.name } },
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
