import { env } from '../../config/env';
import { encryptSecret } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import * as leadsService from '../leads/leads.service';
import * as connection from './whatsapp.connection';
import { humanState, pauseBotForStaff } from './whatsapp.bot';
import { CloudApiError, cloudConfig, getPhoneInfo, graph, isCloudConnected, sendCloudTemplate, sendCloudText, setCloudConfig } from './whatsapp.cloud';
import { sendMessage, windowOpen } from './whatsapp.gateway';

// provider: "web" = QR Code (WhatsApp Web); "cloud" = API oficial da Meta.
// verifiedName: nome aprovado pela Meta para o número (só na API oficial).
export type WhatsAppStatus = connection.WhatsAppConnectionState & {
  provider: 'web' | 'cloud';
  verifiedName?: string | null;
  cloud?: { phoneNumberId: string | null; wabaId: string | null; webhookReady: boolean };
};

function cloudError(err: unknown, fallback: string): never {
  if (err instanceof CloudApiError) throw HttpError.badRequest(err.message);
  throw err instanceof HttpError ? err : HttpError.badRequest(fallback);
}

export async function getStatus(companyId: string): Promise<WhatsAppStatus> {
  const settings = await prisma.companySettings.findUnique({ where: { companyId } });
  if (settings?.whatsappProvider === 'cloud') {
    const config = cloudConfig(companyId);
    let verifiedName: string | null = null;
    let error: string | null = null;
    if (config) {
      try {
        verifiedName = (await getPhoneInfo(config.token, config.phoneNumberId)).verified_name ?? null;
      } catch (err) {
        error = err instanceof CloudApiError ? err.message : 'Não foi possível consultar o número na Meta.';
      }
    }
    return {
      provider: 'cloud',
      status: config && !error ? 'connected' : 'disconnected',
      qr: null,
      phone: settings.whatsappPhone,
      error: error ?? (config ? null : 'A API oficial está selecionada, mas o token não pôde ser lido. Salve a configuração de novo.'),
      verifiedName,
      cloud: {
        phoneNumberId: settings.whatsappCloudPhoneNumberId,
        wabaId: settings.whatsappCloudWabaId,
        webhookReady: Boolean(env.WHATSAPP_CLOUD_VERIFY_TOKEN && env.WHATSAPP_CLOUD_APP_SECRET),
      },
    };
  }

  const state = { ...connection.getConnectionState(companyId), provider: 'web' as const };
  if (state.status !== 'disconnected' || state.error) return state;
  // Sessão salva, mas ainda não aberta neste processo (ex.: servidor acabou de subir).
  if (settings?.whatsappConnected) return { ...state, status: 'connecting', phone: settings.whatsappPhone };
  return state;
}

export async function connect(companyId: string): Promise<WhatsAppStatus> {
  if (isCloudConnected(companyId)) throw HttpError.badRequest('Esta empresa usa a API oficial do WhatsApp. Desconecte a API oficial antes de conectar pelo QR Code.');
  await connection.connect(companyId);
  return getStatus(companyId);
}

export async function disconnect(companyId: string): Promise<WhatsAppStatus> {
  if (isCloudConnected(companyId)) {
    setCloudConfig(companyId, null);
    await prisma.companySettings.update({
      where: { companyId },
      data: { whatsappProvider: 'web', whatsappConnected: false, whatsappPhone: null, whatsappCloudToken: null, whatsappCloudPhoneNumberId: null },
    });
  } else {
    await connection.disconnect(companyId);
  }
  await prisma.whatsAppSession.deleteMany({ where: { companyId } });
  return getStatus(companyId);
}

// Liga a API oficial: confere o número e o token na Meta, inscreve o app nos
// webhooks da conta (WABA) e, se informado o PIN, registra o número. O QR
// Code, se estava conectado, é desconectado (o bot responderia duas vezes).
export async function connectCloud(companyId: string, input: { phoneNumberId: string; wabaId: string; accessToken?: string; pin?: string }): Promise<WhatsAppStatus> {
  const current = await prisma.companySettings.findUnique({ where: { companyId } });
  const token = input.accessToken?.trim() || (current?.whatsappCloudPhoneNumberId ? cloudConfig(companyId)?.token : undefined);
  if (!token) throw HttpError.badRequest('Informe o token de acesso da API oficial.');

  const other = await prisma.companySettings.findFirst({ where: { whatsappCloudPhoneNumberId: input.phoneNumberId, NOT: { companyId } } });
  if (other) throw HttpError.badRequest('Este número já está configurado em outra empresa.');

  try {
    const info = await getPhoneInfo(token, input.phoneNumberId);
    if (input.pin) {
      await graph(token, `${input.phoneNumberId}/register`, { method: 'POST', body: { messaging_product: 'whatsapp', pin: input.pin } });
    }
    await graph(token, `${input.wabaId}/subscribed_apps`, { method: 'POST' });

    if (connection.isConnected(companyId) || current?.whatsappConnected) await connection.disconnect(companyId).catch(() => {});
    const phone = info.display_phone_number?.replace(/\D/g, '') ?? null;
    await prisma.companySettings.upsert({
      where: { companyId },
      update: { whatsappProvider: 'cloud', whatsappConnected: true, whatsappPhone: phone, whatsappCloudPhoneNumberId: input.phoneNumberId, whatsappCloudWabaId: input.wabaId, whatsappCloudToken: encryptSecret(token) },
      create: { companyId, whatsappProvider: 'cloud', whatsappConnected: true, whatsappPhone: phone, whatsappCloudPhoneNumberId: input.phoneNumberId, whatsappCloudWabaId: input.wabaId, whatsappCloudToken: encryptSecret(token) },
    });
    setCloudConfig(companyId, { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, token });
  } catch (err) {
    cloudError(err, 'Não foi possível validar a configuração na Meta.');
  }
  await prisma.whatsAppSession.deleteMany({ where: { companyId } });
  return getStatus(companyId);
}

export async function sendTestMessage(companyId: string, to: string): Promise<void> {
  const digits = to.replace(/\D/g, '');
  if (isCloudConnected(companyId)) {
    // Quem nunca falou com o número está fora da janela de 24h: o modelo
    // hello_world vem pronto em toda conta da Meta.
    try {
      await sendCloudTemplate(companyId, digits, 'hello_world', 'en_US', []);
    } catch (err) {
      cloudError(err, 'Não foi possível enviar a mensagem de teste.');
    }
    return;
  }
  const jid = await connection.findWhatsAppJid(companyId, digits);
  if (!jid) throw HttpError.badRequest('Esse número não tem WhatsApp. Confira o DDI e o DDD (ex.: 5531999999999).');
  await connection.sendText(companyId, jid, 'Mensagem de teste do Espaço NR. Sua conexão com o WhatsApp está funcionando!');
}

// Resposta enviada por um atendente pela tela do cliente no CRM.
export async function replyToLead(companyId: string, leadId: string, text: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
  if (!lead) throw HttpError.notFound('Lead não encontrado.');
  if (!lead.whatsappId) throw HttpError.badRequest('Este cliente ainda não conversou com o salão pelo WhatsApp.');

  if (isCloudConnected(companyId)) {
    if (!windowOpen(lead.lastClientMessageAt)) {
      throw HttpError.badRequest('Passaram mais de 24h desde a última mensagem deste cliente. Pela API oficial do WhatsApp, só é possível responder depois que ele mandar uma nova mensagem (ou com um modelo aprovado, como os retornos automáticos).');
    }
    try {
      await sendCloudText(companyId, lead.whatsappId, text);
    } catch (err) {
      cloudError(err, 'Não foi possível enviar a mensagem.');
    }
  } else {
    await sendMessage(companyId, lead.whatsappId, text);
  }
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
