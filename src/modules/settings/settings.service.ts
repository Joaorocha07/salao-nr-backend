import { prisma } from '../../lib/prisma';

export async function getSettings(companyId: string) {
  return prisma.companySettings.upsert({
    where: { companyId },
    update: {},
    create: { companyId },
  });
}

export async function updateSettings(companyId: string, input: Record<string, unknown>) {
  await getSettings(companyId);
  return prisma.companySettings.update({ where: { companyId }, data: input });
}
