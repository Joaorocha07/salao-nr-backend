import { Request, Response } from 'express';
import { AppointmentEventType, LeadStatus } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { prisma } from '../../lib/prisma';
import { getSettings } from '../settings/settings.service';
import { nextFollowUpAt } from '../whatsapp/whatsapp.jobs';

// Tela "Situação dos clientes": para cada cliente, em que pé está (aguardando
// agendamento, agendado ou já é cliente), quantas vezes agendou e foi
// atendido, se é frequente, há quanto tempo não fala com o salão e quando o
// bot manda o próximo retorno. Os critérios de "frequente" e "sem contato"
// vêm de CompanySettings (situation*).

const DAY_MS = 24 * 60 * 60 * 1000;

export type ClientSituation = 'agendado' | 'aguardando' | 'cliente';

// "2026-09-01" -> meio-dia desse dia (datas do CRM não têm horário).
const fromIsoDate = (date: string) => new Date(`${date}T12:00:00`);
const latest = (...dates: (Date | null | undefined)[]) => dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);

export async function listSituation(companyId: string, now = new Date()) {
  const settings = await getSettings(companyId);
  const leads = await prisma.lead.findMany({
    where: { companyId },
    include: {
      history: { select: { date: true } },
      _count: { select: { appointmentEvents: { where: { type: AppointmentEventType.AGENDADO } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const windowStart = new Date(now.getFullYear(), now.getMonth() - settings.situationFrequentMonths, now.getDate());
  const clients = leads.map((lead) => {
    const visitDates = lead.history.map((h) => h.date).sort();
    const lastVisit = visitDates.length ? fromIsoDate(visitDates[visitDates.length - 1]) : null;
    const visitsInWindow = visitDates.filter((d) => fromIsoDate(d) >= windowStart).length;
    // Intervalo médio entre um atendimento e o seguinte.
    const avgIntervalDays = visitDates.length >= 2
      ? Math.round((fromIsoDate(visitDates[visitDates.length - 1]).getTime() - fromIsoDate(visitDates[0]).getTime()) / DAY_MS / (visitDates.length - 1))
      : null;

    const appointmentAt = lead.status === LeadStatus.AGENDADO && lead.appointmentDate
      ? new Date(`${lead.appointmentDate}T${lead.appointmentTime ?? '23:59'}:00`) : null;
    const upcoming = Boolean(appointmentAt && appointmentAt > now);
    const situation: ClientSituation = upcoming ? 'agendado'
      : visitDates.length || lead.status === LeadStatus.FECHADO || lead.status === LeadStatus.ANTIGO ? 'cliente'
      : 'aguardando';

    // Último contato: mensagem do cliente, atendimento ou cadastro.
    const lastContactAt = latest(lead.lastClientMessageAt, lastVisit, lead.createdAt)!;
    const daysSinceContact = Math.max(0, Math.floor((now.getTime() - lastContactAt.getTime()) / DAY_MS));
    const next = settings.botEnabled ? nextFollowUpAt(lead, settings, now) : null;

    return {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      fromWhatsApp: Boolean(lead.whatsappId),
      firstContactAt: lead.firstContactAt ?? lead.createdAt,
      lastContactAt,
      daysSinceContact,
      bookings: lead._count.appointmentEvents,
      visits: visitDates.length,
      visitsInWindow,
      avgIntervalDays,
      frequent: visitsInWindow >= settings.situationFrequentVisits,
      // Agendado não conta como sumido: ele já vai voltar.
      inactive: !upcoming && daysSinceContact >= settings.situationInactiveDays,
      situation,
      appointment: upcoming ? { date: lead.appointmentDate!, time: lead.appointmentTime, confirmed: Boolean(lead.appointmentConfirmedAt) } : null,
      followUp: {
        count: lead.followUpCount,
        lastSentAt: lead.followUpSentAt,
        nextAt: next,
        // Está no retorno "7 dias e depois a cada 30" (chegou pelo WhatsApp depois da mudança).
        awaitingBooking: Boolean(lead.firstContactAt) && settings.botFollowUpLeadEnabled && situation === 'aguardando',
      },
    };
  });

  return {
    criteria: {
      frequentVisits: settings.situationFrequentVisits,
      frequentMonths: settings.situationFrequentMonths,
      inactiveDays: settings.situationInactiveDays,
    },
    clients,
  };
}

export const situation = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await listSituation(req.auth!.companyId));
});
