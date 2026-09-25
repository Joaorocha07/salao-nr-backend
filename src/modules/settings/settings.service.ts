import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';

export async function getSettings(companyId: string) {
  return prisma.companySettings.upsert({
    where: { companyId },
    update: {},
    create: { companyId },
  });
}

export async function updateSettings(companyId: string, input: Record<string, unknown>) {
  const current = await getSettings(companyId);
  const opening = (input.botOpeningTime as string | undefined) ?? current.botOpeningTime;
  const closing = (input.botClosingTime as string | undefined) ?? current.botClosingTime;
  if (opening >= closing) throw HttpError.badRequest('O horário de fechamento deve ser depois da abertura.');

  const lunchEnabled = (input.botLunchEnabled as boolean | undefined) ?? current.botLunchEnabled;
  if (lunchEnabled) {
    const lunchStart = (input.botLunchStart as string | undefined) ?? current.botLunchStart;
    const lunchEnd = (input.botLunchEnd as string | undefined) ?? current.botLunchEnd;
    if (lunchStart >= lunchEnd) throw HttpError.badRequest('O fim do almoço deve ser depois do início.');
    if (lunchStart < opening || lunchEnd > closing) throw HttpError.badRequest('O almoço precisa estar dentro do horário de atendimento.');
  }

  const data = { ...input };
  if (Array.isArray(input.interests)) {
    // Sem nomes repetidos (ignorando maiúsculas) e sem duração de serviço que saiu da lista.
    const interests = (input.interests as string[]).filter((name, i, all) => all.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === i);
    const durations = (input.serviceDurations ?? current.serviceDurations ?? {}) as Record<string, number>;
    data.interests = interests;
    data.serviceDurations = Object.fromEntries(Object.entries(durations).filter(([name]) => interests.includes(name)));
  }
  return prisma.companySettings.update({ where: { companyId }, data });
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
