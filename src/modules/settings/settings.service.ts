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

export async function addInterest(companyId: string, name: string) {
  const settings = await getSettings(companyId);
  const exists = settings.interests.some((interest) => interest.toLowerCase() === name.toLowerCase());
  if (exists) return settings;

  return prisma.companySettings.update({
    where: { companyId },
    data: { interests: { push: name } },
  });
}
