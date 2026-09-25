import { CompanySettings, Lead, LeadStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { toIsoDate } from './whatsapp.availability';
import { endIdleHumanSession, humanSessionEndsAt, sendDayBeforeReminder, sendHourReminder, withContactLock } from './whatsapp.bot';
import { isConnected, sendText } from './whatsapp.connection';

// Tarefas periódicas do bot:
// - Lembretes do agendamento:
//   * véspera: a partir de botReminderTime do dia anterior, pedindo
//     confirmação. Não vai para horários marcados no mesmo dia do lembrete
//     (o cliente acabou de marcar).
//   * pouco antes: botHourReminderMinutes antes do horário. Se o cliente
//     ainda não confirmou, também pede confirmação.
//   O cliente responde confirmando, remarcando ou cancelando (etapa CONFIRM
//   do bot); sem resposta, a agenda mostra o alerta amarelo.
// - Atendimento pela equipe parado: encerra e devolve o cliente ao menu.

const CHECK_INTERVAL_MS = 60 * 1000;
// Espaço entre um lembrete e outro, para não disparar tudo de uma vez.
const DELAY_BETWEEN_MS = 2000;

const pad = (n: number) => String(n).padStart(2, '0');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ReminderKind = 'day' | 'hour';

// Qual lembrete (se algum) está na hora de ir para este agendamento.
export function dueReminder(lead: Lead, settings: CompanySettings, now = new Date()): ReminderKind | null {
  if (lead.status !== LeadStatus.AGENDADO || !lead.appointmentDate || !lead.appointmentTime || !lead.whatsappId) return null;
  const appointmentAt = new Date(`${lead.appointmentDate}T${lead.appointmentTime}:00`);
  if (Number.isNaN(appointmentAt.getTime()) || appointmentAt <= now) return null;
  const bookedAt = lead.appointmentBookedAt?.getTime() ?? 0;

  if (settings.botHourReminderEnabled && !lead.appointmentHourReminderSentAt) {
    const hourAt = appointmentAt.getTime() - settings.botHourReminderMinutes * 60 * 1000;
    // Marcado já dentro dessa janela: o cliente acabou de agendar, não precisa.
    if (now.getTime() >= hourAt && bookedAt < hourAt) return 'hour';
  }

  if (settings.botReminderEnabled && !lead.appointmentReminderSentAt) {
    const today = toIsoDate(now);
    const tomorrow = toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const bookedEarlier = !lead.appointmentBookedAt || toIsoDate(lead.appointmentBookedAt) < today;
    if (lead.appointmentDate === tomorrow && `${pad(now.getHours())}:${pad(now.getMinutes())}` >= settings.botReminderTime && bookedEarlier) return 'day';
  }
  return null;
}

let running = false;

export async function sendDueReminders(now = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  let sent = 0;
  try {
    const today = toIsoDate(now);
    const tomorrow = toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const companies = await prisma.companySettings.findMany({
      where: { whatsappConnected: true, botEnabled: true, OR: [{ botReminderEnabled: true }, { botHourReminderEnabled: true }] },
    });

    for (const settings of companies) {
      if (!isConnected(settings.companyId)) continue;
      const leads = await prisma.lead.findMany({
        where: {
          companyId: settings.companyId,
          status: LeadStatus.AGENDADO,
          appointmentDate: { in: [today, tomorrow] },
          appointmentTime: { not: null },
          whatsappId: { not: null },
          OR: [{ appointmentReminderSentAt: null }, { appointmentHourReminderSentAt: null }],
        },
      });

      for (const candidate of leads) {
        if (!dueReminder(candidate, settings, now)) continue;
        try {
          await withContactLock(settings.companyId, candidate.whatsappId!, async () => {
            // Pode ter sido reagendado, cancelado ou avisado enquanto esperava na fila.
            const lead = await prisma.lead.findUnique({ where: { id: candidate.id } });
            const kind = lead && dueReminder(lead, settings, new Date());
            if (!lead || !kind) return;
            const send = (text: string) => sendText(settings.companyId, lead.whatsappId!, text);
            if (kind === 'hour') await sendHourReminder(settings.companyId, settings, lead, send);
            else await sendDayBeforeReminder(settings.companyId, settings, lead, send);
            sent += 1;
          });
        } catch (err) {
          console.error('Falha ao enviar lembrete do WhatsApp:', err);
        }
        await sleep(DELAY_BETWEEN_MS);
      }
    }
  } finally {
    running = false;
  }
  return sent;
}

let closingHandoffs = false;

export async function closeIdleHandoffs(): Promise<number> {
  if (closingHandoffs) return 0;
  closingHandoffs = true;
  let ended = 0;
  try {
    const sessions = await prisma.whatsAppSession.findMany({
      where: { step: 'HUMAN', company: { settings: { is: { whatsappConnected: true, botEnabled: true } } } },
      include: { company: { select: { settings: true } } },
    });
    for (const session of sessions) {
      const settings = session.company.settings;
      if (!settings || !isConnected(session.companyId)) continue;
      if (humanSessionEndsAt(session, settings).endsAt.getTime() > Date.now()) continue;
      try {
        if (await endIdleHumanSession(session.companyId, session.phone, (text) => sendText(session.companyId, session.phone, text))) ended += 1;
      } catch (err) {
        console.error('Falha ao encerrar atendimento do WhatsApp:', err);
      }
    }
  } finally {
    closingHandoffs = false;
  }
  return ended;
}

export function startWhatsAppJobs(): void {
  const reminders = () => { sendDueReminders().catch((err) => console.error('Falha ao verificar lembretes do WhatsApp:', err)); };
  const handoffs = () => { closeIdleHandoffs().catch((err) => console.error('Falha ao verificar atendimentos do WhatsApp:', err)); };
  // Primeira verificação depois que as conexões tiveram tempo de reabrir.
  setTimeout(() => { reminders(); handoffs(); }, 60_000);
  setInterval(reminders, CHECK_INTERVAL_MS);
  setInterval(handoffs, CHECK_INTERVAL_MS);
}
