import { CompanySettings, Lead, LeadStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { toIsoDate } from './whatsapp.availability';
import { FollowUpKind, SendFn, endIdleHumanSession, humanSessionEndsAt, sendDayBeforeReminder, sendFollowUp, sendHourReminder, withContactLock } from './whatsapp.bot';
import { NoTemplateError, findWhatsAppJid, isConnected, sendMessage } from './whatsapp.gateway';

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
// - Retorno automático: pergunta se o cliente quer agendar quando
//   * a equipe marcou "Não fechou" há botFollowUpNotClosedDays dias;
//   * um cliente antigo (já foi atendido) está há botFollowUpInactiveDays
//     dias sem falar com o salão.
//   Uma mensagem por vez: só volta a enviar se o cliente conversar de novo
//   (ou for marcado outra vez como "Não fechou") e o prazo passar de novo.
//   * chegou pelo WhatsApp (firstContactAt) e ainda não agendou: a primeira
//     botFollowUpLeadFirstDays dias depois do primeiro contato, depois uma a
//     cada botFollowUpLeadRepeatDays, até agendar. Esse tem prioridade sobre
//     o "Não fechou" para esses clientes.

const CHECK_INTERVAL_MS = 60 * 1000;
// Espaço entre um lembrete e outro, para não disparar tudo de uma vez.
const DELAY_BETWEEN_MS = 2000;

const pad = (n: number) => String(n).padStart(2, '0');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ReminderKind = 'day' | 'hour';

// API oficial sem modelo aprovado e cliente fora da janela de 24h: a mensagem
// não sai. Guarda por um tempo para não tentar de novo a cada minuto.
const SKIP_MS = 6 * 60 * 60 * 1000;
const skipped = new Map<string, number>();
const isSkipped = (key: string) => {
  const at = skipped.get(key);
  return at !== undefined && Date.now() - at < SKIP_MS;
};
function handleSendError(key: string, err: unknown, label: string) {
  if (err instanceof NoTemplateError) {
    skipped.set(key, Date.now());
    console.warn(err.message);
    return;
  }
  console.error(label, err);
}

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
        const reminderKind = dueReminder(candidate, settings, now);
        const skipKey = `${candidate.id}:${reminderKind}`;
        if (!reminderKind || isSkipped(skipKey)) continue;
        try {
          await withContactLock(settings.companyId, candidate.whatsappId!, async () => {
            // Pode ter sido reagendado, cancelado ou avisado enquanto esperava na fila.
            const lead = await prisma.lead.findUnique({ where: { id: candidate.id } });
            const kind = lead && dueReminder(lead, settings, new Date());
            if (!lead || !kind) return;
            const send: SendFn = (text, automatic) => sendMessage(settings.companyId, lead.whatsappId!, text, automatic);
            if (kind === 'hour') await sendHourReminder(settings.companyId, settings, lead, send);
            else await sendDayBeforeReminder(settings.companyId, settings, lead, send);
            sent += 1;
          });
        } catch (err) {
          handleSendError(skipKey, err, 'Falha ao enviar lembrete do WhatsApp:');
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
        if (await endIdleHumanSession(session.companyId, session.phone, (text) => sendMessage(session.companyId, session.phone, text))) ended += 1;
      } catch (err) {
        console.error('Falha ao encerrar atendimento do WhatsApp:', err);
      }
    }
  } finally {
    closingHandoffs = false;
  }
  return ended;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Uma mensagem de retorno a cada 5 minutos por empresa: muitas mensagens
// seguidas para quem não puxou conversa parecem spam e podem bloquear o número.
const FOLLOW_UP_INTERVAL_MS = 5 * 60 * 1000;
// Cliente sem WhatsApp no número cadastrado: não tenta de novo por um dia.
const noWhatsApp = new Map<string, number>();

export type FollowUpLead = Lead & { history: { date: string }[] };

// "2026-09-01" -> meio-dia desse dia (datas do CRM não têm horário).
const fromIsoDate = (date: string | null | undefined) => (date ? new Date(`${date}T12:00:00`) : null);
const latest = (...dates: (Date | null)[]) => dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);

// Último contato que conta para o prazo do retorno.
function followUpSince(lead: FollowUpLead): Date | null {
  if (lead.status === LeadStatus.NAO_FECHOU) return latest(lead.notClosedAt, lead.lastClientMessageAt);
  return latest(lead.lastClientMessageAt, fromIsoDate(lead.activityDate), fromIsoDate(lead.appointmentDate), lead.createdAt, ...lead.history.map((h) => fromIsoDate(h.date)));
}

// Horário marcado que ainda não chegou: o cliente já vai voltar, sem retorno.
function hasUpcomingAppointment(lead: Lead, now: Date): boolean {
  if (lead.status !== LeadStatus.AGENDADO || !lead.appointmentDate) return false;
  return new Date(`${lead.appointmentDate}T${lead.appointmentTime ?? '23:59'}:00`).getTime() > now.getTime();
}

// Chegou pelo WhatsApp depois do retorno "sem agendamento" existir, nunca
// foi atendido e não está agendado.
function awaitingBooking(lead: FollowUpLead): boolean {
  return Boolean(lead.firstContactAt) && lead.history.length === 0
    && (lead.status === LeadStatus.NOVO_LEAD || lead.status === LeadStatus.NAO_FECHOU);
}

type FollowUpPlan = { kind: FollowUpKind; since: Date; days: number };

// Qual retorno vale para este cliente e de quando conta o prazo. null = nenhum
// (ou já enviado, esperando o cliente).
export function followUpPlan(lead: FollowUpLead, settings: CompanySettings, now = new Date()): FollowUpPlan | null {
  if (hasUpcomingAppointment(lead, now)) return null;
  if (settings.botFollowUpLeadEnabled && awaitingBooking(lead)) {
    // Primeiro retorno conta do primeiro contato; os seguintes, do último
    // retorno. Mensagem do cliente recomeça o prazo.
    const first = lead.followUpCount === 0;
    const since = latest(first ? lead.firstContactAt : lead.followUpSentAt ?? lead.firstContactAt, lead.lastClientMessageAt);
    if (!since) return null;
    return { kind: 'sem_agendamento', since, days: first ? settings.botFollowUpLeadFirstDays : settings.botFollowUpLeadRepeatDays };
  }
  let kind: FollowUpKind;
  let days: number;
  if (lead.status === LeadStatus.NAO_FECHOU) {
    if (!settings.botFollowUpNotClosedEnabled || !lead.notClosedAt) return null;
    kind = 'nao_fechou';
    days = settings.botFollowUpNotClosedDays;
  } else {
    // Cliente antigo = já foi atendido pelo salão: fechou, está no histórico ou
    // teve um horário que já passou (mesmo que a equipe não tenha marcado "Fechado").
    const wasClient = lead.status === LeadStatus.FECHADO || lead.status === LeadStatus.ANTIGO || lead.status === LeadStatus.AGENDADO || lead.history.length > 0;
    if (!settings.botFollowUpInactiveEnabled || !wasClient) return null;
    kind = 'inativo';
    days = settings.botFollowUpInactiveDays;
  }
  const since = followUpSince(lead);
  if (!since) return null;
  // Já mandou o retorno depois do último contato: espera o cliente responder.
  if (lead.followUpSentAt && lead.followUpSentAt >= since) return null;
  return { kind, since, days };
}

// Quando sai o próximo retorno (sem contar dias e horários de atendimento).
export function nextFollowUpAt(lead: FollowUpLead, settings: CompanySettings, now = new Date()): Date | null {
  const plan = followUpPlan(lead, settings, now);
  return plan ? new Date(plan.since.getTime() + plan.days * DAY_MS) : null;
}

// Qual retorno (se algum) está na hora de ir para este cliente.
export function dueFollowUp(lead: FollowUpLead, settings: CompanySettings, now = new Date()): FollowUpKind | null {
  const plan = followUpPlan(lead, settings, now);
  return plan && now.getTime() - plan.since.getTime() >= plan.days * DAY_MS ? plan.kind : null;
}

// Retorno só nos dias e horários de atendimento do salão.
function withinBusinessHours(settings: CompanySettings, now: Date): boolean {
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return settings.botWorkDays.includes(now.getDay()) && time >= settings.botOpeningTime && time < settings.botClosingTime;
}

// Número do WhatsApp do cliente. Quem foi cadastrado à mão no CRM ainda não
// tem whatsappId: confere se o telefone tem WhatsApp (resolve o nono dígito).
async function contactFor(companyId: string, lead: Lead): Promise<string | null> {
  if (lead.whatsappId) return lead.whatsappId;
  const failedAt = noWhatsApp.get(lead.id);
  if (failedAt && Date.now() - failedAt < DAY_MS) return null;
  const digits = lead.phone.replace(/\D/g, '');
  const full = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  const jid = full.length >= 12 ? await findWhatsAppJid(companyId, full).catch(() => null) : null;
  if (!jid) {
    noWhatsApp.set(lead.id, Date.now());
    return null;
  }
  return jid.split('@')[0];
}

let followingUp = false;

export async function sendDueFollowUps(now = new Date()): Promise<number> {
  if (followingUp) return 0;
  followingUp = true;
  let sent = 0;
  try {
    const companies = await prisma.companySettings.findMany({
      where: { whatsappConnected: true, botEnabled: true, OR: [{ botFollowUpNotClosedEnabled: true }, { botFollowUpInactiveEnabled: true }, { botFollowUpLeadEnabled: true }] },
    });

    for (const settings of companies) {
      if (!isConnected(settings.companyId) || !withinBusinessHours(settings, now)) continue;
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sentToday = await prisma.lead.count({ where: { companyId: settings.companyId, followUpSentAt: { gte: startOfDay } } });
      if (sentToday >= settings.botFollowUpDailyLimit) continue;
      // Último retorno enviado (vem do banco, então vale mesmo se o servidor reiniciar).
      const { _max: last } = await prisma.lead.aggregate({ where: { companyId: settings.companyId }, _max: { followUpSentAt: true } });
      if (last.followUpSentAt && now.getTime() - last.followUpSentAt.getTime() < FOLLOW_UP_INTERVAL_MS) continue;

      const statuses = [...new Set<LeadStatus>([
        ...(settings.botFollowUpNotClosedEnabled ? [LeadStatus.NAO_FECHOU] : []),
        ...(settings.botFollowUpInactiveEnabled ? [LeadStatus.FECHADO, LeadStatus.ANTIGO, LeadStatus.NOVO_LEAD, LeadStatus.AGENDADO] : []),
        ...(settings.botFollowUpLeadEnabled ? [LeadStatus.NOVO_LEAD, LeadStatus.NAO_FECHOU] : []),
      ])];
      const candidates = (await prisma.lead.findMany({
        where: { companyId: settings.companyId, status: { in: statuses } },
        include: { history: { select: { date: true } } },
      }))
        .filter((lead) => dueFollowUp(lead, settings, now))
        // Quem está há mais tempo esperando primeiro.
        .sort((a, b) => (followUpPlan(a, settings, now)?.since.getTime() ?? 0) - (followUpPlan(b, settings, now)?.since.getTime() ?? 0));

      // Só um por vez: o próximo sai na verificação de daqui a 5 minutos.
      for (const candidate of candidates) {
        if (isSkipped(`${candidate.id}:retorno`)) continue;
        try {
          const contactId = await contactFor(settings.companyId, candidate);
          if (!contactId) continue;
          let delivered = false as boolean;
          await withContactLock(settings.companyId, contactId, async () => {
            // Pode ter conversado, agendado ou mudado de etapa enquanto esperava.
            const lead = await prisma.lead.findUnique({ where: { id: candidate.id }, include: { history: { select: { date: true } } } });
            const kind = lead && dueFollowUp(lead, settings, new Date());
            if (!lead || !kind) return;
            delivered = await sendFollowUp(settings.companyId, settings, lead, contactId, kind, (text, automatic) => sendMessage(settings.companyId, contactId, text, automatic));
          });
          if (!delivered) continue;
          sent += 1;
          break;
        } catch (err) {
          handleSendError(`${candidate.id}:retorno`, err, 'Falha ao enviar retorno do WhatsApp:');
        }
      }
    }
  } finally {
    followingUp = false;
  }
  return sent;
}

export function startWhatsAppJobs(): void {
  const reminders = () => { sendDueReminders().catch((err) => console.error('Falha ao verificar lembretes do WhatsApp:', err)); };
  const handoffs = () => { closeIdleHandoffs().catch((err) => console.error('Falha ao verificar atendimentos do WhatsApp:', err)); };
  const followUps = () => { sendDueFollowUps().catch((err) => console.error('Falha ao verificar retornos do WhatsApp:', err)); };
  // Primeira verificação depois que as conexões tiveram tempo de reabrir.
  setTimeout(() => { reminders(); handoffs(); followUps(); }, 60_000);
  setInterval(reminders, CHECK_INTERVAL_MS);
  setInterval(handoffs, CHECK_INTERVAL_MS);
  setInterval(followUps, CHECK_INTERVAL_MS);
}
