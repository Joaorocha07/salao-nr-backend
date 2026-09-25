import { CompanySettings, Lead, LeadStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import * as leadsService from '../leads/leads.service';
import { freeTimes, isTimeFree, nextFreeDays, serviceDuration, toIsoDate, weekdayOf } from './whatsapp.availability';

// Chatbot do WhatsApp. Toda mensagem recebida: encontra (ou cria) o cliente
// pelo número, salva a mensagem no histórico dele e, se o bot estiver ligado,
// avança a conversa:
//   MENU -> 1) agendar: [ASK_NAME] -> ASK_SERVICE -> ASK_DATE (dias livres)
//              -> ASK_TIME (horários livres) -> agendado
//        -> 2) falar com a equipe: HUMAN (bot fica quieto enquanto a equipe atende)
// A equipe responder (CRM ou celular) também abre HUMAN. Se a equipe passar
// botHumanTimeoutMinutes sem escrever, o bot encerra o atendimento e volta ao menu.
// Na véspera o lembrete (whatsapp.jobs.ts) abre a etapa CONFIRM:
//   1) confirmar  2) remarcar -> ASK_DATE  3) cancelar
// "Ver meu agendamento" / "Remarcar ou cancelar" no menu abrem MANAGE, com as
// mesmas ações para o próximo horário do cliente.

type BotStep = 'MENU' | 'ASK_NAME' | 'ASK_SERVICE' | 'ASK_DATE' | 'ASK_TIME' | 'CONFIRM' | 'MANAGE' | 'HUMAN';
type SessionData = {
  askName?: boolean;
  // MANAGE: ações oferecidas na última mensagem, na ordem numerada.
  manage?: string[];
  // MENU depois de concluir algo: o cliente pode escolher uma opção direto;
  // outra mensagem recebe as boas-vindas, como numa conversa nova.
  idle?: boolean;
  services?: string[];
  // Dias e horários oferecidos na última mensagem, para o cliente responder pelo número.
  days?: string[];
  date?: string;
  times?: string[];
  reschedule?: boolean;
  // HUMAN: última mensagem da equipe e quando o cliente pediu atendimento (ISO).
  staffAt?: string;
  requestedAt?: string;
};
type BotContext = {
  companyId: string;
  // Número do contato só com dígitos (ex.: 5531999999999). Se o WhatsApp não
  // revelar o número, é o JID anônimo do contato (termina em @lid).
  waId: string;
  send: (text: string) => Promise<void>;
  saveContact?: (name: string) => Promise<void>;
  settings: CompanySettings;
  leadId: string | null;
};
export type IncomingWhatsAppMessage = {
  companyId: string;
  contactId: string;
  messageId?: string;
  text: string | null;
  mediaType?: string;
  profileName?: string;
  send: (text: string) => Promise<void>;
  // Salva o cliente nos contatos do WhatsApp do salão.
  saveContact?: (name: string) => Promise<void>;
};

// Cliente parou no meio do agendamento: depois desse tempo começa do zero.
const FLOW_TIMEOUT_MS = 30 * 60 * 1000;
// O cliente pode responder o lembrete horas depois.
const CONFIRM_TIMEOUT_MS = 48 * 60 * 60 * 1000;
// Cliente pediu a equipe e ninguém respondeu: depois disso o bot volta (sem avisar).
const HANDOFF_MAX_WAIT_MS = 12 * 60 * 60 * 1000;
// Recomeçam a conversa do zero ("0", "voltar" e "menu" só voltam ao menu: BACK_WORDS).
const RESET_WORDS = new Set(['sair', 'cancelar']);
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MEDIA_LABELS: Record<string, string> = {
  audio: 'áudio', image: 'imagem', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contact: 'contato',
};
const DAYS_OFFERED = 6;
const DEFAULT_GREETING = 'Olá! Bem-vindo(a) ao nosso espaço.';
// Menu principal: a empresa escolhe quais opções aparecem (botMenuOptions).
type MenuOption = 'agendar' | 'ver' | 'remarcar' | 'equipe';
const MENU_LABELS: Record<MenuOption, string> = {
  agendar: 'Agendar um horário',
  ver: 'Ver meu agendamento',
  remarcar: 'Remarcar ou cancelar',
  equipe: 'Falar com a equipe',
};
// Palavras que o cliente pode digitar em vez do número. "remarcar" vem antes
// de "agendar" porque "remarcar" também contém "marcar".
const MENU_KEYWORDS: [MenuOption, RegExp][] = [
  ['remarcar', /remarc|cancel|desmarc|mudar|trocar/],
  ['ver', /\bver\b|meu horario|meu agendamento|consultar|quando e/],
  ['agendar', /agend|marcar|horario/],
  ['equipe', /atend|equipe|falar|pessoa|humano/],
];

export function menuOptions(settings: Pick<CompanySettings, 'botMenuOptions' | 'botSchedulingEnabled'>): MenuOption[] {
  const options = settings.botMenuOptions.filter((o): o is MenuOption => o in MENU_LABELS)
    .filter((o) => o !== 'agendar' || settings.botSchedulingEnabled);
  return options.length ? options : ['equipe'];
}

export function mainMenu(settings: Pick<CompanySettings, 'botMenuOptions' | 'botSchedulingEnabled'>): string {
  return `Como posso te ajudar? Responda com o número:\n\n${numbered(menuOptions(settings).map((o) => MENU_LABELS[o]))}`;
}

// Fim de toda lista fora do menu principal: "0" (ou "voltar"/"menu") volta para ele.
export const BACK_OPTION = '0) Voltar ao menu principal';
const BACK_WORDS = new Set(['0', 'voltar', 'menu', 'inicio', 'menu principal', 'voltar ao menu']);

// Blocos da mensagem separados por uma linha em branco (os vazios são ignorados).
const blocks = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join('\n\n');

function pickMenuOption(answer: string, settings: CompanySettings): MenuOption | undefined {
  const options = menuOptions(settings);
  return pickFromList(answer, options) ?? MENU_KEYWORDS.find(([option, pattern]) => options.includes(option) && pattern.test(answer))?.[0];
}

// Ações sobre o próximo horário do cliente (etapa MANAGE).
type ManageAction = 'confirmar' | 'remarcar' | 'cancelar';
const MANAGE_LABELS: Record<ManageAction, string> = {
  confirmar: 'Confirmar presença',
  remarcar: 'Remarcar',
  cancelar: 'Cancelar',
};

function manageActionFromText(answer: string): ManageAction | undefined {
  if (/remarc|mudar|trocar/.test(answer)) return 'remarcar';
  if (/cancel|desmarc/.test(answer)) return 'cancelar';
  if (/confirm/.test(answer)) return 'confirmar';
  return undefined;
}

export const CONFIRM_OPTIONS = `Responda com o número:\n\n1) Confirmar\n2) Remarcar\n3) Cancelar\n\n${BACK_OPTION}`;
const CONFIRM_WORDS = new Set(['1', 'sim', 's', 'confirmo', 'confirmar', 'confirmado', 'confirmada', 'ok', 'certo', 'tudo certo', 'pode ser', 'combinado', '👍']);
const PLACEHOLDER_PREFIX = 'Cliente WhatsApp';

// Contato que o WhatsApp identifica só por um id anônimo, sem número.
const isHiddenNumber = (waId: string) => waId.includes('@');
const onlyDigits = (value: string) => value.replace(/\D/g, '');
const pad = (n: number) => String(n).padStart(2, '0');
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';
const brDate = (isoDate: string) => isoDate.split('-').reverse().slice(0, 2).join('/');
export const isPlaceholderName = (name: string | null | undefined) => !name?.trim() || name.startsWith(PLACEHOLDER_PREFIX);

// Nome como o cliente escreveu, sem emojis ("João Rocha ❤️" -> "João Rocha").
export function cleanName(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}‍︎️⃣]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function fillTemplate(template: string, vars: { nome?: string; servico?: string; data?: string; hora?: string }): string {
  return template.replace(/\{(nome|servico|serviço|data|hora)\}/gi, (_, key: string) => vars[normalize(key) as keyof typeof vars] ?? '');
}

// "sexta, 26/09" — ou "hoje (sexta, 26/09)" / "amanhã (sábado, 27/09)".
function dayLabel(isoDate: string, now = new Date()): string {
  const label = `${WEEKDAYS[weekdayOf(isoDate)]}, ${brDate(isoDate)}`;
  if (isoDate === toIsoDate(now)) return `hoje (${label})`;
  if (isoDate === toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return `amanhã (${label})`;
  return label;
}

// Para usar no meio da frase: "hoje (sexta, 26/09)", "na sexta, 26/09", "no sábado, 27/09".
function onDay(isoDate: string): string {
  const label = dayLabel(isoDate);
  if (label.startsWith('hoje') || label.startsWith('amanhã')) return label;
  return `${[0, 6].includes(weekdayOf(isoDate)) ? 'no' : 'na'} ${label}`;
}

const numbered = (items: string[]) => items.map((item, i) => `${i + 1}) ${item}`).join('\n');

// Pergunta do serviço: lista numerada e, havendo mais de um serviço, como
// escolher vários de uma vez.
function serviceQuestion(settings: CompanySettings): string {
  return blocks(
    'Qual serviço você deseja? Responda com o número:',
    numbered(settings.interests),
    settings.interests.length > 1 && 'Quer fazer mais de um? Mande os números juntos, por exemplo: 1,2 ou 1 2.',
    BACK_OPTION,
  );
}

// "1", "1,2", "1 2", "1 e 2", "corte" -> serviços escolhidos (sem repetir).
// Devolve null se algum número/nome não existir.
function pickServices(text: string, settings: CompanySettings): string[] | null {
  const answer = normalize(text);
  const byName = settings.interests.find((s) => normalize(s) === answer);
  if (byName) return [byName];
  const parts = answer.replace(/\be\b/g, ' ').split(/[\s,;/+]+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const chosen = parts.map((p) => settings.interests[Number(p) - 1]);
  if (chosen.some((s) => !s)) return null;
  return [...new Set(chosen)];
}

// "2h", "até 11:00"
function durationNote(settings: CompanySettings, services: string[], time: string): string {
  const minutes = serviceDuration(settings, services);
  const [h, m] = time.split(':').map(Number);
  const end = h * 60 + m + minutes;
  return `Duração prevista: ${beforeLabel(minutes)} (até ${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}).`;
}

// Resposta "2" escolhe o 2º item da lista oferecida.
function pickFromList<T>(answer: string, list: T[] | undefined): T | undefined {
  if (!list || !/^\d{1,2}$/.test(answer)) return undefined;
  return list[Number(answer) - 1];
}

// wa_id brasileiro (55 + DDD + número) -> DDD + número com 9º dígito.
function brLocalNumber(waId: string): string | null {
  const digits = onlyDigits(waId);
  if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) return null;
  const local = digits.slice(2);
  // Contas antigas do WhatsApp chegam sem o nono dígito dos celulares.
  if (local.length === 10 && /[6-9]/.test(local[2])) return `${local.slice(0, 2)}9${local.slice(2)}`;
  return local;
}

// Mesmo formato da máscara de telefone do frontend: (31) 99999-9999.
export function formatPhone(waId: string): string {
  if (isHiddenNumber(waId)) return 'Não informado';
  const local = brLocalNumber(waId);
  if (!local) return `+${onlyDigits(waId)}`;
  return local.length === 11
    ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
    : `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
}

export function parseBrDate(text: string, now = new Date()): string | null {
  const t = normalize(text);
  if (t === 'hoje') return toIsoDate(now);
  if (t === 'amanha') return toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  const match = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : now.getFullYear();
  // "05/01" pedido em dezembro = janeiro do ano que vem ("19/12" no dia 20/12 = já passou).
  if (!match[3] && month < now.getMonth() + 1) year += 1;

  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (new Date(year, month - 1, day, 23, 59, 59).getTime() < now.getTime()) return null;
  return toIsoDate(date);
}

// Aceita "14", "14h", "14:30", "14h30", "14hs".
export function parseTime(text: string): string | null {
  const match = /^(\d{1,2})(?:[:h](\d{2}))?(?:h|hs|horas)?$/.exec(normalize(text).replace(/\s/g, ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

function placeholderName(waId: string): string {
  return `${PLACEHOLDER_PREFIX} ${onlyDigits(waId).slice(-4)}`;
}

// O WhatsApp pode entregar a mesma mensagem de novo após uma reconexão; ignora as já processadas.
const recentMessageIds = new Set<string>();
function alreadyProcessed(id: string | undefined): boolean {
  if (!id) return false;
  if (recentMessageIds.has(id)) return true;
  recentMessageIds.add(id);
  if (recentMessageIds.size > 2000) recentMessageIds.delete(recentMessageIds.values().next().value!);
  return false;
}

// Mensagens do mesmo número são processadas em fila, para duas mensagens
// seguidas não avançarem a mesma sessão ao mesmo tempo.
const contactQueues = new Map<string, Promise<void>>();
export function withContactLock(companyId: string, contactId: string, task: () => Promise<void>): Promise<void> {
  const key = `${companyId}:${contactId}`;
  const next = (contactQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  contactQueues.set(key, next);
  next.finally(() => { if (contactQueues.get(key) === next) contactQueues.delete(key); }).catch(() => {});
  return next;
}

async function findLeadByWhatsApp(companyId: string, waId: string) {
  const linked = await prisma.lead.findFirst({ where: { companyId, whatsappId: waId }, orderBy: { createdAt: 'desc' } });
  if (linked || isHiddenNumber(waId)) return linked;

  // Cliente cadastrado à mão no CRM: casa pelos últimos 8 dígitos + DDD e
  // vincula o wa_id, em vez de criar um cliente duplicado.
  const local = brLocalNumber(waId) ?? onlyDigits(waId);
  const candidates = await prisma.$queryRaw<{ id: string; phone: string }[]>`
    SELECT id, phone FROM leads
    WHERE "companyId" = ${companyId} AND "whatsappId" IS NULL
      AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = ${local.slice(-8)}
    ORDER BY "createdAt" DESC`;
  const ddd = local.length >= 10 ? local.slice(0, 2) : null;
  const match = candidates.find((c) => {
    const digits = onlyDigits(c.phone).replace(/^55(?=\d{10,11}$)/, '');
    return !ddd || digits.length < 10 || digits.startsWith(ddd);
  });
  if (!match) return null;
  return prisma.lead.update({ where: { id: match.id }, data: { whatsappId: waId } });
}

async function logMessage(ctx: BotContext, text: string, own: boolean) {
  if (!ctx.leadId || !ctx.settings.captureConversations) return;
  await prisma.leadMessage.create({ data: { leadId: ctx.leadId, text, own } });
}

async function say(ctx: BotContext, text: string) {
  await ctx.send(text);
  await logMessage(ctx, text, true);
}

async function setSession(ctx: BotContext, step: BotStep, data: SessionData) {
  await upsertSession(ctx.companyId, ctx.waId, step, data);
}

async function upsertSession(companyId: string, phone: string, step: BotStep, data: SessionData) {
  await prisma.whatsAppSession.upsert({
    where: { companyId_phone: { companyId, phone } },
    update: { step, data },
    create: { companyId, phone, step, data },
  });
}

async function clearSession(ctx: BotContext) {
  await prisma.whatsAppSession.deleteMany({ where: { companyId: ctx.companyId, phone: ctx.waId } });
}

// Começo de conversa: boas-vindas e menu em duas mensagens separadas.
async function sendWelcome(ctx: BotContext, name: string | undefined, data: SessionData) {
  await setSession(ctx, 'MENU', data);
  await say(ctx, fillTemplate(ctx.settings.greetingMessage || DEFAULT_GREETING, { nome: name ?? '' }));
  await say(ctx, mainMenu(ctx.settings));
}

// Terminou um agendamento/confirmação/cancelamento: continua ouvindo o menu
// por um tempo, para o cliente poder mandar "2" (ver) ou "remarcar" em seguida.
async function finishConversation(ctx: BotContext) {
  await setSession(ctx, 'MENU', { idle: true });
}

async function saveContact(ctx: BotContext, name: string) {
  if (!ctx.settings.saveContactOnWhatsApp || !ctx.saveContact || isPlaceholderName(name)) return;
  // Salvar o contato é um extra: se o WhatsApp recusar, o cliente continua no CRM.
  await ctx.saveContact(name).catch((err) => console.error('Não foi possível salvar o contato no WhatsApp:', err));
}

// A equipe mandou mensagem: o bot fica em silêncio com esse cliente e o prazo
// de inatividade (botHumanTimeoutMinutes) recomeça a contar.
export async function pauseBotForStaff(companyId: string, contactId: string) {
  const settings = await prisma.companySettings.findUnique({ where: { companyId } });
  if (settings && !settings.botPauseOnStaffReply) return;
  await upsertSession(companyId, contactId, 'HUMAN', { staffAt: new Date().toISOString() });
}

type HumanSession = { data: unknown; updatedAt: Date };

// Quando o atendimento pela equipe acaba. Sem nenhuma mensagem da equipe
// ainda (cliente pediu e está esperando), o bot não encerra por inatividade.
export function humanSessionEndsAt(session: HumanSession, settings: CompanySettings): { endsAt: Date; waitingForStaff: boolean } {
  const data = (session.data ?? {}) as SessionData;
  const timeout = settings.botHumanTimeoutMinutes * 60 * 1000;
  if (data.staffAt) return { endsAt: new Date(Date.parse(data.staffAt) + timeout), waitingForStaff: false };
  if (data.requestedAt) return { endsAt: new Date(Date.parse(data.requestedAt) + HANDOFF_MAX_WAIT_MS), waitingForStaff: true };
  // Sessões gravadas antes desses campos: contam como resposta da equipe.
  return { endsAt: new Date(session.updatedAt.getTime() + timeout), waitingForStaff: false };
}

// Situação do atendimento pela equipe com esse contato, para a ficha do cliente.
export async function humanState(companyId: string, contactId: string) {
  const [session, settings] = await Promise.all([
    prisma.whatsAppSession.findUnique({ where: { companyId_phone: { companyId, phone: contactId } } }),
    prisma.companySettings.findUnique({ where: { companyId } }),
  ]);
  if (session?.step !== 'HUMAN' || !settings) return { paused: false, pausedUntil: null, waitingForStaff: false };
  const { endsAt, waitingForStaff } = humanSessionEndsAt(session, settings);
  if (endsAt.getTime() <= Date.now()) return { paused: false, pausedUntil: null, waitingForStaff: false };
  return { paused: true, pausedUntil: endsAt, waitingForStaff };
}

// Chamado periodicamente (whatsapp.jobs.ts). Se a equipe ficou sem escrever
// além do prazo, avisa o cliente que o atendimento terminou e volta ao menu.
export async function endIdleHumanSession(companyId: string, contactId: string, send: (text: string) => Promise<void>): Promise<boolean> {
  let ended = false;
  await withContactLock(companyId, contactId, async () => {
    const [session, settings] = await Promise.all([
      prisma.whatsAppSession.findUnique({ where: { companyId_phone: { companyId, phone: contactId } } }),
      prisma.companySettings.findUnique({ where: { companyId } }),
    ]);
    if (session?.step !== 'HUMAN' || !settings?.botEnabled) return;
    const { endsAt, waitingForStaff } = humanSessionEndsAt(session, settings);
    if (endsAt.getTime() > Date.now()) return;

    const lead = await findLeadByWhatsApp(companyId, contactId);
    const ctx: BotContext = { companyId, waId: contactId, send, settings, leadId: lead?.id ?? null };
    if (waitingForStaff) {
      // Ninguém da equipe respondeu: só libera o bot para a próxima mensagem.
      await clearSession(ctx);
      return;
    }
    // Só a despedida. A conversa termina aqui: se o cliente escrever de novo,
    // recebe as boas-vindas e o menu como numa conversa nova.
    await say(ctx, fillTemplate(settings.botHumanEndMessage, { nome: isPlaceholderName(lead?.name) ? '' : firstName(lead?.name) }));
    await clearSession(ctx);
    ended = true;
  });
  return ended;
}

export async function handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<void> {
  if (alreadyProcessed(message.messageId)) return;
  const settings = await prisma.companySettings.findUnique({ where: { companyId: message.companyId } });
  if (!settings) return;

  const ctx: BotContext = { companyId: message.companyId, waId: message.contactId, send: message.send, saveContact: message.saveContact, settings, leadId: null };
  await withContactLock(ctx.companyId, ctx.waId, () => processMessage(ctx, message));
}

// Alguém da equipe respondeu o cliente direto pelo celular: registra a
// mensagem na ficha e pausa o bot com esse cliente, igual à resposta pelo CRM.
export async function handleMessageFromPhone(companyId: string, contactId: string, text: string): Promise<void> {
  await withContactLock(companyId, contactId, async () => {
    const settings = await prisma.companySettings.findUnique({ where: { companyId } });
    const lead = await findLeadByWhatsApp(companyId, contactId);
    if (lead && settings?.captureConversations) await prisma.leadMessage.create({ data: { leadId: lead.id, text, own: true } });
    await pauseBotForStaff(companyId, contactId);
  });
}

function appointmentVars(lead: Lead) {
  return {
    nome: firstName(lead.name),
    servico: lead.appointmentServices.join(' + ') || lead.interests.join(' + '),
    data: brDate(lead.appointmentDate!),
    hora: lead.appointmentTime ?? '',
  };
}

// 60 -> "1h", 90 -> "1h30", 30 -> "30 min"
const beforeLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${minutes % 60 ? pad(minutes % 60) : ''}`);

// Fim da confirmação do agendamento: quais lembretes o cliente vai receber.
// Mesmas regras de whatsapp.jobs.ts (sem véspera se ela já é hoje).
function reminderNote(settings: CompanySettings, date: string, time: string): string {
  const now = new Date();
  const dayBefore = new Date(`${date}T12:00:00`);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const withDayBefore = settings.botReminderEnabled && toIsoDate(dayBefore) > toIsoDate(now);
  const withHour = settings.botHourReminderEnabled
    && new Date(`${date}T${time}:00`).getTime() - settings.botHourReminderMinutes * 60 * 1000 > now.getTime();
  const before = `${beforeLabel(settings.botHourReminderMinutes)} antes`;
  if (withDayBefore && withHour) return `\n\nVou te mandar um lembrete na véspera e outro ${before}.`;
  if (withDayBefore) return '\n\nNa véspera eu te mando uma mensagem para confirmar.';
  if (withHour) return `\n\nVou te mandar um lembrete ${before}.`;
  return '';
}

// Lembretes (chamados por whatsapp.jobs.ts, dentro do lock do contato).
// Véspera: sempre pede confirmação.
export async function sendDayBeforeReminder(companyId: string, settings: CompanySettings, lead: Lead, send: (text: string) => Promise<void>) {
  const ctx: BotContext = { companyId, waId: lead.whatsappId!, send, settings, leadId: lead.id };
  await say(ctx, `${fillTemplate(settings.botReminderMessage, appointmentVars(lead))}\n\n${CONFIRM_OPTIONS}`);
  await prisma.lead.update({ where: { id: lead.id }, data: { appointmentReminderSentAt: new Date() } });
  await setSession(ctx, 'CONFIRM', {});
}

// Pouco antes do horário: só avisa; se o cliente ainda não confirmou (ou
// marcou no mesmo dia e não teve o da véspera), também pede confirmação.
export async function sendHourReminder(companyId: string, settings: CompanySettings, lead: Lead, send: (text: string) => Promise<void>) {
  const ctx: BotContext = { companyId, waId: lead.whatsappId!, send, settings, leadId: lead.id };
  const text = fillTemplate(settings.botHourReminderMessage, appointmentVars(lead));
  const askConfirmation = !lead.appointmentConfirmedAt;
  await say(ctx, askConfirmation ? `${text}\n\n${CONFIRM_OPTIONS}` : text);
  await prisma.lead.update({ where: { id: lead.id }, data: { appointmentHourReminderSentAt: new Date() } });
  if (askConfirmation) await setSession(ctx, 'CONFIRM', {});
}

// Lembrete enviado, cliente ainda não respondeu e o horário não passou.
function awaitingConfirmation(lead: Lead | null): boolean {
  return Boolean(lead && lead.status === LeadStatus.AGENDADO && lead.appointmentDate && lead.appointmentDate >= toIsoDate(new Date())
    && (lead.appointmentReminderSentAt || lead.appointmentHourReminderSentAt) && !lead.appointmentConfirmedAt);
}

function sessionExpired(session: HumanSession & { step: string }, settings: CompanySettings): boolean {
  if (session.step === 'HUMAN') return humanSessionEndsAt(session, settings).endsAt.getTime() <= Date.now();
  const timeout = session.step === 'CONFIRM' ? CONFIRM_TIMEOUT_MS : FLOW_TIMEOUT_MS;
  return Date.now() - session.updatedAt.getTime() > timeout;
}

async function processMessage(ctx: BotContext, message: IncomingWhatsAppMessage) {
  const { settings } = ctx;
  const { text } = message;
  const profileName = settings.captureName ? cleanName(message.profileName) || undefined : undefined;

  let lead = await findLeadByWhatsApp(ctx.companyId, ctx.waId);
  if (!lead && settings.autoCreateLead) {
    lead = await leadsService.createLead(ctx.companyId, {
      name: profileName ?? placeholderName(ctx.waId),
      phone: formatPhone(ctx.waId),
      interests: [],
      status: LeadStatus.NOVO_LEAD,
      whatsappId: ctx.waId,
    });
    ctx.leadId = lead.id;
    if (profileName) await saveContact(ctx, profileName);
  }
  ctx.leadId = lead?.id ?? null;
  await logMessage(ctx, text ?? `[${MEDIA_LABELS[message.mediaType ?? ''] ?? 'mensagem'}]`, false);

  let session = await prisma.whatsAppSession.findUnique({ where: { companyId_phone: { companyId: ctx.companyId, phone: ctx.waId } } });
  if (session) {
    const expired = sessionExpired(session, settings);
    const word = text ? normalize(text) : '';
    // Na confirmação, "cancelar" é uma resposta (cancela o horário), não "recomeçar".
    const reset = RESET_WORDS.has(word) && !(['CONFIRM', 'MANAGE', 'MENU'].includes(session.step) && word === 'cancelar');
    if (expired || reset) {
      await clearSession(ctx);
      session = null;
    }
  }

  if (!settings.botEnabled) return;

  if (!session) {
    // Respondeu o lembrete depois que a conversa expirou: ainda vale como resposta.
    if (text && lead && awaitingConfirmation(lead) && await answerConfirmation(ctx, lead, normalize(text))) return;

    const name = firstName(isPlaceholderName(lead?.name) ? profileName : lead?.name);
    if (!settings.botSchedulingEnabled) {
      await setSession(ctx, 'HUMAN', { requestedAt: new Date().toISOString() });
      await say(ctx, fillTemplate(settings.greetingMessage || DEFAULT_GREETING, { nome: name }));
      await say(ctx, settings.botHandoffMessage);
      return;
    }
    // Só pergunta o nome quando o WhatsApp não trouxe um nome de perfil.
    const askName = settings.captureName && (lead ? isPlaceholderName(lead.name) : !profileName);
    await sendWelcome(ctx, name, { askName });
    return;
  }

  // "0", "voltar" ou "menu" em qualquer etapa: volta direto ao menu principal
  // (sem repetir as boas-vindas). Também tira o cliente da espera pela equipe.
  if (text && BACK_WORDS.has(normalize(text))) {
    const data = (session.data as SessionData) ?? {};
    await setSession(ctx, 'MENU', { askName: data.askName });
    await say(ctx, mainMenu(settings));
    return;
  }

  if (session.step === 'HUMAN') return;
  if (!text) {
    await say(ctx, 'Por enquanto só consigo entender mensagens de texto. Pode digitar sua resposta?');
    return;
  }
  await advanceConversation(ctx, session.step as BotStep, (session.data as SessionData) ?? {}, text, lead);
}

async function advanceConversation(ctx: BotContext, step: BotStep, data: SessionData, text: string, lead: Lead | null) {
  const { settings } = ctx;
  const answer = normalize(text);

  if (step === 'MENU') {
    const option = pickMenuOption(answer, settings);
    if (option === 'agendar') {
      if (data.askName) {
        await setSession(ctx, 'ASK_NAME', data);
        await say(ctx, blocks('Ótimo! Para fazer seu cadastro, qual é o seu nome?', BACK_OPTION));
      } else {
        await offerServices(ctx, data, 'Ótimo!');
      }
      return;
    }
    if (option === 'ver' || option === 'remarcar') {
      await showAppointment(ctx, lead, data, option === 'remarcar' ? 'O que você quer fazer com esse horário?' : undefined);
      return;
    }
    if (option === 'equipe') {
      await setSession(ctx, 'HUMAN', { requestedAt: new Date().toISOString() });
      await say(ctx, settings.botHandoffMessage);
      return;
    }
    if (data.idle) {
      // Conversa anterior já concluída ("obrigada", "oi" etc.): recomeça com as boas-vindas.
      await sendWelcome(ctx, isPlaceholderName(lead?.name) ? '' : firstName(lead?.name), { askName: data.askName });
      return;
    }
    await say(ctx, blocks('Não entendi.', mainMenu(settings)));
    return;
  }

  if (step === 'MANAGE') {
    if (!lead || !hasActiveAppointment(lead)) {
      await setSession(ctx, 'MENU', {});
      await say(ctx, blocks('Você não tem nenhum horário marcado no momento.', mainMenu(settings)));
      return;
    }
    const action = pickFromList(answer, data.manage as ManageAction[] | undefined) ?? manageActionFromText(answer);
    if (action === 'confirmar' && !lead.appointmentConfirmedAt) {
      await answerConfirmation(ctx, lead, '1');
      return;
    }
    if (action === 'remarcar') {
      await answerConfirmation(ctx, lead, '2');
      return;
    }
    if (action === 'cancelar') {
      await answerConfirmation(ctx, lead, '3');
      return;
    }
    await showAppointment(ctx, lead, data, 'Não entendi.');
    return;
  }

  if (step === 'ASK_NAME') {
    const name = cleanName(text);
    if (name.length < 2 || /^\d+$/.test(name)) {
      await say(ctx, blocks('Pode me dizer seu nome, por favor?', BACK_OPTION));
      return;
    }
    if (ctx.leadId) await prisma.lead.update({ where: { id: ctx.leadId }, data: { name } });
    await saveContact(ctx, name);
    await offerServices(ctx, { ...data, askName: false }, `Prazer, ${firstName(name)}!`);
    return;
  }

  if (step === 'ASK_SERVICE') {
    const services = pickServices(text, settings);
    if (!services) {
      await say(ctx, blocks('Não encontrei esse serviço.', serviceQuestion(settings)));
      return;
    }
    const total = services.length > 1 ? ` Os ${services.length} serviços levam cerca de ${beforeLabel(serviceDuration(settings, services))} no total.` : '';
    await offerDays(ctx, { ...data, services }, `Perfeito, ${services.join(' + ')}!${total}`);
    return;
  }

  if (step === 'ASK_DATE') {
    const date = pickFromList(answer, data.days) ?? parseBrDate(text);
    if (!date) {
      await offerDays(ctx, data, 'Não entendi o dia (ou ele já passou).');
      return;
    }
    if (!settings.botWorkDays.includes(weekdayOf(date))) {
      await offerDays(ctx, data, `Não atendemos ${WEEKDAYS[weekdayOf(date)]}.`);
      return;
    }
    const times = await freeTimes(ctx.companyId, settings, date, serviceDuration(settings, data.services ?? []), ctx.leadId);
    if (!times.length) {
      await offerDays(ctx, data, `Não temos mais horários livres ${onDay(date)}. Que outro dia fica bom para você?`);
      return;
    }
    await offerTimes(ctx, { ...data, date }, times);
    return;
  }

  if (step === 'ASK_TIME') {
    if (!data.date || !data.services?.length) {
      await offerServices(ctx, data, 'Vamos recomeçar o agendamento.');
      return;
    }
    const time = pickFromList(answer, data.times) ?? parseTime(text);
    if (!time) {
      await offerTimes(ctx, data, await freeTimes(ctx.companyId, settings, data.date, serviceDuration(settings, data.services), ctx.leadId), 'Não entendi o horário.');
      return;
    }
    await book(ctx, data, time);
    return;
  }

  if (step === 'CONFIRM') {
    if (!lead || !awaitingConfirmation(lead)) {
      // Horário já passou ou foi alterado pela equipe.
      await sendWelcome(ctx, isPlaceholderName(lead?.name) ? '' : firstName(lead?.name), {});
      return;
    }
    if (!(await answerConfirmation(ctx, lead, answer))) await say(ctx, blocks('Não entendi.', CONFIRM_OPTIONS));
  }
}

// Cliente tem um horário marcado que ainda não passou.
function hasActiveAppointment(lead: Lead | null): lead is Lead {
  if (!lead || lead.status !== LeadStatus.AGENDADO || !lead.appointmentDate || !lead.appointmentTime) return false;
  return new Date(`${lead.appointmentDate}T${lead.appointmentTime}:00`).getTime() > Date.now();
}

// "Ver meu agendamento" / "Remarcar ou cancelar": mostra o próximo horário e
// as ações possíveis (etapa MANAGE).
async function showAppointment(ctx: BotContext, lead: Lead | null, data: SessionData, question?: string) {
  if (!hasActiveAppointment(lead)) {
    await setSession(ctx, 'MENU', { askName: data.askName });
    await say(ctx, blocks('Você não tem nenhum horário marcado no momento.', mainMenu(ctx.settings)));
    return;
  }
  const actions: ManageAction[] = [
    ...(lead.appointmentConfirmedAt ? [] : ['confirmar' as const]),
    ...(ctx.settings.botSchedulingEnabled ? ['remarcar' as const] : []),
    'cancelar',
  ];
  const services = lead.appointmentServices.join(' + ') || 'Atendimento';
  const status = lead.appointmentConfirmedAt ? 'Presença confirmada ✅' : 'Presença ainda não confirmada';
  await setSession(ctx, 'MANAGE', { manage: actions });
  await say(ctx, blocks(
    question,
    `Seu próximo horário: ${services} ${onDay(lead.appointmentDate!)} às ${lead.appointmentTime}.`,
    status,
    'Responda com o número:',
    numbered(actions.map((a) => MANAGE_LABELS[a])),
    BACK_OPTION,
  ));
}

async function offerServices(ctx: BotContext, data: SessionData, prefix: string) {
  const { interests } = ctx.settings;
  if (interests.length === 1) {
    await offerDays(ctx, { ...data, services: interests }, prefix);
    return;
  }
  await setSession(ctx, 'ASK_SERVICE', data);
  await say(ctx, blocks(prefix, serviceQuestion(ctx.settings)));
}

async function offerDays(ctx: BotContext, data: SessionData, prefix: string) {
  const days = await nextFreeDays(ctx.companyId, ctx.settings, DAYS_OFFERED, serviceDuration(ctx.settings, data.services ?? []), ctx.leadId);
  if (!days.length) {
    await setSession(ctx, 'HUMAN', { requestedAt: new Date().toISOString() });
    await say(ctx, blocks(prefix, 'Não encontrei horários livres nos próximos dias.', ctx.settings.botHandoffMessage));
    return;
  }
  await setSession(ctx, 'ASK_DATE', { ...data, days, date: undefined, times: undefined });
  await say(ctx, blocks(
    prefix,
    'Estes são os próximos dias com horário livre:',
    numbered(days.map((d) => dayLabel(d))),
    `Responda com o número do dia ou digite outra data (ex.: ${brDate(days[0])}).`,
    BACK_OPTION,
  ));
}

async function offerTimes(ctx: BotContext, data: SessionData & { date?: string }, times: string[], prefix?: string) {
  if (!times.length) {
    await offerDays(ctx, data, `${prefix ? `${prefix} ` : ''}Esse dia não tem mais horários livres. Que outro dia fica bom para você?`);
    return;
  }
  await setSession(ctx, 'ASK_TIME', { ...data, times });
  await say(ctx, blocks(
    prefix,
    `Horários livres ${onDay(data.date!)}:`,
    numbered(times),
    'Responda com o número do horário.',
    BACK_OPTION,
  ));
}

async function book(ctx: BotContext, data: SessionData & { date?: string }, time: string) {
  const { settings } = ctx;
  const date = data.date!;
  const services = data.services!;

  // Confere de novo: outro cliente pode ter pego o horário enquanto este respondia.
  if (!(await isTimeFree(ctx.companyId, settings, date, time, serviceDuration(settings, services), ctx.leadId))) {
    await offerTimes(ctx, data, await freeTimes(ctx.companyId, settings, date, serviceDuration(settings, services), ctx.leadId), `O horário ${time} não está disponível.`);
    return;
  }

  // "Criar cliente automaticamente" desligado: o cliente só entra no CRM
  // quando conclui um agendamento.
  if (!ctx.leadId) {
    const lead = await leadsService.createLead(ctx.companyId, {
      name: placeholderName(ctx.waId),
      phone: formatPhone(ctx.waId),
      interests: services,
      status: LeadStatus.NOVO_LEAD,
      whatsappId: ctx.waId,
    });
    ctx.leadId = lead.id;
  }

  let lead;
  try {
    lead = await leadsService.scheduleAppointment(ctx.companyId, ctx.leadId, date, time, services, 'bot');
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    await offerDays(ctx, data, err.message);
    return;
  }
  const missing = services.filter((s) => !lead.interests.includes(s));
  if (missing.length) await prisma.lead.update({ where: { id: lead.id }, data: { interests: { push: missing } } });

  await finishConversation(ctx);
  const confirmation = fillTemplate(settings.botConfirmationMessage, {
    nome: firstName(lead.name),
    servico: services.join(' + '),
    data: brDate(date),
    hora: time,
  });
  await say(ctx, `${confirmation}\n\n${durationNote(settings, services, time)}${reminderNote(settings, date, time)}`);
}

// Resposta ao lembrete. Devolve false se a mensagem não for uma das opções.
async function answerConfirmation(ctx: BotContext, lead: Lead, answer: string): Promise<boolean> {
  const when = `${lead.appointmentServices.join(' + ') || 'seu horário'} ${onDay(lead.appointmentDate!)} às ${lead.appointmentTime}`;

  if (CONFIRM_WORDS.has(answer)) {
    await leadsService.confirmAppointment(ctx.companyId, lead.id, 'bot');
    await finishConversation(ctx);
    await say(ctx, `Obrigado, ${firstName(lead.name)}! Está confirmado: ${when}. Até lá!`);
    return true;
  }
  if (answer === '2' || answer.includes('remarc')) {
    const services = lead.appointmentServices.length ? lead.appointmentServices : lead.interests.slice(0, 1);
    if (!services.length) {
      await offerServices(ctx, { reschedule: true }, 'Sem problemas, vamos remarcar.');
    } else {
      await offerDays(ctx, { services, reschedule: true }, 'Sem problemas, vamos remarcar.');
    }
    return true;
  }
  if (answer === '3' || answer.includes('cancel')) {
    await leadsService.cancelAppointment(ctx.companyId, lead.id, 'bot');
    await finishConversation(ctx);
    await say(ctx, 'Tudo bem, seu horário foi cancelado. Quando quiser marcar de novo, é só mandar uma mensagem por aqui.');
    return true;
  }
  return false;
}
