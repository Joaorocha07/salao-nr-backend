import { CompanySettings, LeadStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// Horários livres para o bot oferecer. Os horários de início seguem uma
// grade de botSlotMinutes em botSlotMinutes a partir da abertura. Cada
// agendamento ocupa a duração dos seus serviços (serviceDurations); um
// horário está livre quando o atendimento inteiro cabe antes do fechamento,
// não encosta no almoço e não se sobrepõe a botSlotCapacity agendamentos
// (inclusive os marcados à mão no CRM, em qualquer horário).

type AgendaSettings = Pick<CompanySettings,
  'botOpeningTime' | 'botClosingTime' | 'botWorkDays' | 'botSlotMinutes' | 'botSlotCapacity'
  | 'botLunchEnabled' | 'botLunchStart' | 'botLunchEnd' | 'serviceDurations'>;

// Antecedência mínima para marcar no mesmo dia.
const MIN_NOTICE_MINUTES = 30;

const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const weekdayOf = (isoDate: string) => new Date(`${isoDate}T12:00:00`).getDay();
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

// Tempo que os serviços ocupam na agenda (soma, quando são vários).
export function serviceDuration(settings: Pick<CompanySettings, 'serviceDurations' | 'botSlotMinutes'>, services: string[]): number {
  const durations = (settings.serviceDurations ?? {}) as Record<string, number>;
  const total = services.reduce((sum, s) => sum + (Number(durations[s]) > 0 ? Number(durations[s]) : settings.botSlotMinutes), 0);
  return total || settings.botSlotMinutes;
}

type Busy = { start: number; end: number };

// Agendamentos ativos por dia, como intervalos em minutos desde 00:00.
async function loadBusy(companyId: string, settings: AgendaSettings, from: string, to: string, excludeLeadId?: string | null) {
  const leads = await prisma.lead.findMany({
    where: {
      companyId,
      status: LeadStatus.AGENDADO,
      appointmentDate: { gte: from, lte: to },
      appointmentTime: { not: null },
      ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
    },
    select: { appointmentDate: true, appointmentTime: true, appointmentServices: true },
  });
  const busy = new Map<string, Busy[]>();
  for (const { appointmentDate, appointmentTime, appointmentServices } of leads) {
    const start = toMinutes(appointmentTime!);
    busy.set(appointmentDate!, [...(busy.get(appointmentDate!) ?? []), { start, end: start + serviceDuration(settings, appointmentServices) }]);
  }
  return busy;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

// O atendimento de `duration` minutos começando em `start` cabe no dia?
function fits(settings: AgendaSettings, busy: Busy[], start: number, duration: number): boolean {
  const end = start + duration;
  if (start < toMinutes(settings.botOpeningTime) || end > toMinutes(settings.botClosingTime)) return false;
  if (settings.botLunchEnabled && overlaps(start, end, toMinutes(settings.botLunchStart), toMinutes(settings.botLunchEnd))) return false;
  return busy.filter((b) => overlaps(start, end, b.start, b.end)).length < settings.botSlotCapacity;
}

function candidateStarts(settings: AgendaSettings, date: string, now: Date): number[] {
  const today = toIsoDate(now);
  if (date < today || !settings.botWorkDays.includes(weekdayOf(date))) return [];
  const starts: number[] = [];
  for (let t = toMinutes(settings.botOpeningTime); t < toMinutes(settings.botClosingTime); t += settings.botSlotMinutes) starts.push(t);
  // Depois do almoço, a grade recomeça no fim do almoço (ex.: almoço até 13:30 -> 13:30, 14:30...).
  if (settings.botLunchEnabled) {
    const lunchEnd = toMinutes(settings.botLunchEnd);
    for (let t = lunchEnd; t < toMinutes(settings.botClosingTime); t += settings.botSlotMinutes) if (!starts.includes(t)) starts.push(t);
    starts.sort((a, b) => a - b);
  }
  if (date !== today) return starts;
  const cutoff = now.getHours() * 60 + now.getMinutes() + MIN_NOTICE_MINUTES;
  return starts.filter((t) => t >= cutoff);
}

// Próximos dias de atendimento com pelo menos um horário livre para `duration` minutos.
export async function nextFreeDays(companyId: string, settings: AgendaSettings, count: number, duration: number, excludeLeadId?: string | null, horizonDays = 45): Promise<string[]> {
  const now = new Date();
  const busy = await loadBusy(companyId, settings, toIsoDate(now), toIsoDate(addDays(now, horizonDays)), excludeLeadId);
  const days: string[] = [];
  for (let i = 0; i <= horizonDays && days.length < count; i++) {
    const date = toIsoDate(addDays(now, i));
    const dayBusy = busy.get(date) ?? [];
    if (candidateStarts(settings, date, now).some((t) => fits(settings, dayBusy, t, duration))) days.push(date);
  }
  return days;
}

export async function freeTimes(companyId: string, settings: AgendaSettings, date: string, duration: number, excludeLeadId?: string | null): Promise<string[]> {
  const busy = (await loadBusy(companyId, settings, date, date, excludeLeadId)).get(date) ?? [];
  return candidateStarts(settings, date, new Date()).filter((t) => fits(settings, busy, t, duration)).map(fromMinutes);
}

// Horário digitado pelo cliente (pode estar fora da grade, ex.: 14:30).
export async function isTimeFree(companyId: string, settings: AgendaSettings, date: string, time: string, duration: number, excludeLeadId?: string | null): Promise<boolean> {
  const minutes = toMinutes(time);
  const now = new Date();
  if (date < toIsoDate(now) || !settings.botWorkDays.includes(weekdayOf(date))) return false;
  if (date === toIsoDate(now) && minutes < now.getHours() * 60 + now.getMinutes() + MIN_NOTICE_MINUTES) return false;
  const busy = (await loadBusy(companyId, settings, date, date, excludeLeadId)).get(date) ?? [];
  return fits(settings, busy, minutes, duration);
}
