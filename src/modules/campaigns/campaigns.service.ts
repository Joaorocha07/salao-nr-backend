import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';

export async function listCampaigns(companyId: string) {
  return prisma.campaign.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
}

export async function createCampaign(
  companyId: string,
  input: { name: string; message: string; mediaUrl?: string; recipientIds: string[] },
) {
  const recipientCount = await prisma.lead.count({ where: { companyId, id: { in: input.recipientIds } } });

  return prisma.campaign.create({
    data: {
      companyId,
      name: input.name,
      message: input.message,
      mediaUrl: input.mediaUrl,
      date: new Date().toISOString().slice(0, 10),
      recipientCount,
    },
  });
}

export async function deleteCampaign(companyId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, companyId } });
  if (!campaign) throw HttpError.notFound('Campanha não encontrada.');
  await prisma.campaign.delete({ where: { id: campaignId } });
}
