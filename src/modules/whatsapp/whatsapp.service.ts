import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import * as leadsService from '../leads/leads.service';
import * as connection from './whatsapp.connection';
import { humanState, pauseBotForStaff } from './whatsapp.bot';

export type WhatsAppStatus = connection.WhatsAppConnectionState;

export async function getStatus(companyId: string): Promise<WhatsAppStatus> {
  const state = connection.getConnectionState(companyId);
  if (state.status !== 'disconnected' || state.error) return state;

  // Sessão salva, mas ainda não aberta neste processo (ex.: servidor acabou de subir).
  const settings = await prisma.companySettings.findUnique({ where: { companyId } });
  if (settings?.whatsappConnected) return { ...state, status: 'connecting', phone: settings.whatsappPhone };
  return state;
}

export function connect(companyId: string): Promise<WhatsAppStatus> {
  return connection.connect(companyId);
}

export async function disconnect(companyId: string): Promise<WhatsAppStatus> {
  await connection.disconnect(companyId);
  await prisma.whatsAppSession.deleteMany({ where: { companyId } });
  return connection.getConnectionState(companyId);
}

export async function sendTestMessage(companyId: string, to: string): Promise<void> {
  const jid = await connection.findWhatsAppJid(companyId, to.replace(/\D/g, ''));
  if (!jid) throw HttpError.badRequest('Esse número não tem WhatsApp. Confira o DDI e o DDD (ex.: 5531999999999).');
  await connection.sendText(companyId, jid, 'Mensagem de teste do Espaço NR. Sua conexão com o WhatsApp está funcionando!');
}

// Resposta enviada por um atendente pela tela do cliente no CRM.
export async function replyToLead(companyId: string, leadId: string, text: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
  if (!lead) throw HttpError.notFound('Lead não encontrado.');
  if (!lead.whatsappId) throw HttpError.badRequest('Este cliente ainda não conversou com o salão pelo WhatsApp.');

  await connection.sendText(companyId, lead.whatsappId, text);
  await pauseBotForStaff(companyId, lead.whatsappId);
  return leadsService.addMessage(companyId, leadId, text, true);
}

async function findLeadContact(companyId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId }, select: { whatsappId: true } });
  if (!lead) throw HttpError.notFound('Lead não encontrado.');
  return lead.whatsappId;
}

const NOT_PAUSED = { paused: false, pausedUntil: null, waitingForStaff: false };

// O bot está em silêncio com esse cliente porque a equipe está atendendo
// (ou porque o cliente pediu a equipe e está aguardando)?
export async function getBotState(companyId: string, leadId: string) {
  const contactId = await findLeadContact(companyId, leadId);
  return contactId ? humanState(companyId, contactId) : NOT_PAUSED;
}

export async function resumeBot(companyId: string, leadId: string) {
  const contactId = await findLeadContact(companyId, leadId);
  if (contactId) await prisma.whatsAppSession.deleteMany({ where: { companyId, phone: contactId, step: 'HUMAN' } });
  return NOT_PAUSED;
}
