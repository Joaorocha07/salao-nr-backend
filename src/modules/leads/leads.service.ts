import { LeadStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';

const includeRelations = {
  notes: { orderBy: { createdAt: Prisma.SortOrder.asc } },
  messages: { orderBy: { createdAt: Prisma.SortOrder.asc } },
  history: { orderBy: { createdAt: Prisma.SortOrder.asc } },
} satisfies Prisma.LeadInclude;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function findOwnedLead(companyId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId }, include: includeRelations });
  if (!lead) throw HttpError.notFound('Lead não encontrado.');
  return lead;
}

export async function listLeads(
  companyId: string,
  filters: { status?: LeadStatus; search?: string; from?: string; to?: string },
) {
  return prisma.lead.findMany({
    where: {
      companyId,
      status: filters.status,
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { phone: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filters.from ? { date: { gte: filters.from } } : {}),
      ...(filters.to ? { date: { lte: filters.to } } : {}),
    },
    include: includeRelations,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLead(companyId: string, leadId: string) {
  return findOwnedLead(companyId, leadId);
}

export async function createLead(
  companyId: string,
  input: { name: string; phone: string; gender?: string; interests: string[]; status: LeadStatus },
) {
  const date = today();
  const lead = await prisma.lead.create({
    data: {
      companyId,
      name: input.name,
      phone: input.phone,
      gender: input.gender,
      interests: input.interests,
      status: input.status,
      date,
      activityDate: date,
      ...(input.status === LeadStatus.FECHADO
        ? { history: { create: { companyId, service: input.interests.join(' + '), date } } }
        : {}),
    },
    include: includeRelations,
  });
  return lead;
}

export async function updateLead(
  companyId: string,
  leadId: string,
  input: {
    name?: string;
    phone?: string;
    gender?: string;
    birthday?: string;
    interests?: string[];
    status?: LeadStatus;
  },
) {
  const lead = await findOwnedLead(companyId, leadId);
  const date = today();

  const data: Prisma.LeadUpdateInput = {
    name: input.name,
    phone: input.phone,
    gender: input.gender,
    birthday: input.birthday,
    interests: input.interests,
  };

  if (input.status && input.status !== lead.status) {
    data.status = input.status;

    if (input.status === LeadStatus.FECHADO) {
      if (lead.appointmentDate && lead.appointmentTime) {
        const scheduledAt = new Date(`${lead.appointmentDate}T${lead.appointmentTime}:00`);
        if (!Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now()) {
          throw HttpError.badRequest(
            `Este atendimento está agendado para ${lead.appointmentDate.split('-').reverse().join('/')} às ${lead.appointmentTime}. Não é possível marcar como fechado antes desse horário.`,
          );
        }
      }
      data.activityDate = date;
      data.history = {
        create: {
          companyId,
          service: input.interests
            ? input.interests.join(' + ')
            : lead.appointmentServices.length
              ? lead.appointmentServices.join(' + ')
              : lead.interests.join(' + '),
          date,
          time: lead.appointmentTime ?? undefined,
        },
      };
      data.appointmentDate = null;
      data.appointmentTime = null;
      data.appointmentServices = [];
    } else if (input.status !== LeadStatus.AGENDADO) {
      data.appointmentDate = null;
      data.appointmentTime = null;
      data.appointmentServices = [];
    }
  }

  return prisma.lead.update({ where: { id: leadId }, data, include: includeRelations });
}

export async function deleteLead(companyId: string, leadId: string) {
  await findOwnedLead(companyId, leadId);
  await prisma.lead.delete({ where: { id: leadId } });
}

export async function scheduleAppointment(companyId: string, leadId: string, date: string, time: string, services: string[]) {
  await findOwnedLead(companyId, leadId);

  const scheduledAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now()) {
    throw HttpError.badRequest('Não é possível agendar em uma data e horário que já passaram.');
  }

  return prisma.lead.update({
    where: { id: leadId },
    data: {
      status: LeadStatus.AGENDADO,
      appointmentDate: date,
      appointmentTime: time,
      appointmentServices: services,
      activityDate: date,
    },
    include: includeRelations,
  });
}

export async function cancelAppointment(companyId: string, leadId: string) {
  await findOwnedLead(companyId, leadId);
  return prisma.lead.update({
    where: { id: leadId },
    data: { status: LeadStatus.NOVO_LEAD, appointmentDate: null, appointmentTime: null, appointmentServices: [], activityDate: today() },
    include: includeRelations,
  });
}

export async function addNote(companyId: string, leadId: string, text: string) {
  await findOwnedLead(companyId, leadId);
  await prisma.leadNote.create({ data: { leadId, text } });
  return findOwnedLead(companyId, leadId);
}

export async function addMessage(companyId: string, leadId: string, text: string, own: boolean) {
  await findOwnedLead(companyId, leadId);
  await prisma.leadMessage.create({ data: { leadId, text, own } });
  return findOwnedLead(companyId, leadId);
}

export async function deleteHistoryRecord(companyId: string, leadId: string, recordId: string) {
  const lead = await findOwnedLead(companyId, leadId);
  const record = lead.history.find((h) => h.id === recordId);
  if (!record) throw HttpError.notFound('Atendimento não encontrado no histórico.');
  await prisma.serviceRecord.delete({ where: { id: recordId } });
  return findOwnedLead(companyId, leadId);
}

export async function listServiceHistory(companyId: string) {
  return prisma.serviceRecord.findMany({
    where: { companyId },
    include: { lead: { select: { id: true, name: true, phone: true } } },
    orderBy: { date: 'desc' },
  });
}
