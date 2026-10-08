import crypto from 'crypto';
import { Request, Response } from 'express';
import { env } from '../../config/env';
import { decryptSecret } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { handleIncomingMessage, handleMessageFromPhone } from './whatsapp.bot';

// API oficial do WhatsApp (WhatsApp Cloud API da Meta). Diferente do QR Code
// (whatsapp.connection.ts), não há conexão aberta: o servidor manda mensagens
// pela Graph API e recebe as do cliente pelo webhook (POST /api/whatsapp/webhook),
// configurado uma vez no app da Meta. Cada empresa cadastra o id do número, o
// id da conta (WABA) e o token de acesso na tela WhatsApp do CRM.
//
// Regra da Meta: texto livre só até 24h depois da última mensagem do cliente.
// Fora dessa janela só modelos aprovados (whatsapp.templates.ts).

export type CloudConfig = { phoneNumberId: string; wabaId: string | null; token: string };

// Empresas usando a API oficial (carregadas do banco ao subir e ao salvar).
const configs = new Map<string, CloudConfig>();

export class CloudApiError extends Error {
  constructor(message: string, public code?: number, public details?: string) {
    super(message);
  }
}

// Erros da Meta que a equipe precisa entender.
const FRIENDLY_ERRORS: Record<number, string> = {
  131047: 'Passaram mais de 24h desde a última mensagem do cliente. Pela API oficial, fora dessa janela só é possível enviar um modelo aprovado pela Meta.',
  131026: 'Não foi possível entregar: o número não tem WhatsApp ou não aceita mensagens.',
  131030: 'Número de teste: adicione este destinatário na lista de números permitidos do app da Meta.',
  190: 'O token de acesso da API oficial expirou ou é inválido. Gere um token permanente no Meta for Developers e salve de novo na tela WhatsApp.',
  132001: 'O modelo da mensagem não existe ou ainda não foi aprovado pela Meta.',
};

export function cloudConfig(companyId: string): CloudConfig | undefined {
  return configs.get(companyId);
}

export function isCloudConnected(companyId: string): boolean {
  return configs.has(companyId);
}

export function setCloudConfig(companyId: string, config: CloudConfig | null) {
  if (config) configs.set(companyId, config);
  else configs.delete(companyId);
}

// Carrega as empresas que usam a API oficial (ao subir o servidor).
export async function loadCloudConfigs(): Promise<void> {
  const rows = await prisma.companySettings.findMany({
    where: { whatsappProvider: 'cloud', whatsappCloudPhoneNumberId: { not: null }, whatsappCloudToken: { not: null } },
  });
  for (const row of rows) {
    try {
      configs.set(row.companyId, { phoneNumberId: row.whatsappCloudPhoneNumberId!, wabaId: row.whatsappCloudWabaId, token: decryptSecret(row.whatsappCloudToken!) });
    } catch (err) {
      console.error('Token da API oficial do WhatsApp ilegível (JWT_REFRESH_SECRET mudou?):', row.companyId, err);
    }
  }
}

type GraphError = { message?: string; code?: number; error_user_msg?: string; error_user_title?: string; error_data?: { details?: string } };

// Chamada à Graph API com o token informado.
export async function graph<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: GraphError } & T;
  if (!res.ok || body.error) {
    const error = body.error ?? {};
    const details = error.error_data?.details ?? error.error_user_msg;
    throw new CloudApiError(
      (error.code && FRIENDLY_ERRORS[error.code]) || details || error.message || `Erro ${res.status} na API do WhatsApp.`,
      error.code,
      details,
    );
  }
  return body;
}

function requireConfig(companyId: string): CloudConfig {
  const config = configs.get(companyId);
  if (!config) throw new CloudApiError('A API oficial do WhatsApp não está configurada para esta empresa.');
  return config;
}

// Número só com dígitos, com DDI (cadastros manuais do CRM vêm sem o 55).
export function cloudRecipient(contact: string): string {
  // Cliente que veio pelo QR Code identificado só por id anônimo (@lid), sem número.
  if (contact.includes('@') && !contact.endsWith('@s.whatsapp.net')) {
    throw new CloudApiError('Este cliente não tem número de telefone conhecido (veio pelo QR Code com id anônimo). Cadastre o telefone na ficha do cliente.');
  }
  const digits = contact.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

export async function sendCloudText(companyId: string, to: string, text: string): Promise<void> {
  const { phoneNumberId, token } = requireConfig(companyId);
  await graph(token, `${phoneNumberId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: cloudRecipient(to), type: 'text', text: { body: text, preview_url: false } },
  });
}

export async function sendCloudTemplate(companyId: string, to: string, name: string, language: string, params: string[]): Promise<void> {
  const { phoneNumberId, token } = requireConfig(companyId);
  await graph(token, `${phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to: cloudRecipient(to),
      type: 'template',
      template: {
        name,
        language: { code: language },
        ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
      },
    },
  });
}

// Marca a mensagem do cliente como lida (tiques azuis). Só cortesia: falha não importa.
async function markRead(companyId: string, messageId: string): Promise<void> {
  const config = configs.get(companyId);
  if (!config) return;
  await graph(config.token, `${config.phoneNumberId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
  }).catch(() => {});
}

export type PhoneInfo = { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string };

export function getPhoneInfo(token: string, phoneNumberId: string): Promise<PhoneInfo> {
  return graph<PhoneInfo>(token, `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
}

// ---------------------------------------------------------------- webhook

// GET: a Meta confere o token de verificação ao cadastrar a URL do webhook.
export function verifyWebhook(req: Request, res: Response) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && env.WHATSAPP_CLOUD_VERIFY_TOKEN && token === env.WHATSAPP_CLOUD_VERIFY_TOKEN) {
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }
  return res.sendStatus(403);
}

// Assinatura X-Hub-Signature-256 = HMAC-SHA256 do corpo cru com o segredo do app.
// Sem ela qualquer um poderia mandar mensagens falsas para o bot responder.
function validSignature(req: Request): boolean {
  const secret = env.WHATSAPP_CLOUD_APP_SECRET;
  const header = req.get('x-hub-signature-256');
  if (!secret || !header?.startsWith('sha256=') || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const received = header.slice('sha256='.length);
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

// POST: mensagens recebidas, status de entrega e (com coexistência) mensagens
// que a equipe mandou pelo app WhatsApp Business. Responde 200 na hora; a
// Meta reenvia o que não recebe 200.
export function receiveWebhook(req: Request, res: Response) {
  if (!env.WHATSAPP_CLOUD_APP_SECRET) {
    console.error('Webhook do WhatsApp recebido, mas WHATSAPP_CLOUD_APP_SECRET não está configurado.');
    return res.sendStatus(503);
  }
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200);
  processWebhook(req.body as WebhookBody).catch((err) => console.error('Erro processando webhook do WhatsApp:', err));
  return undefined;
}

type CloudMessage = {
  from: string; id: string; timestamp: string; type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string }; video?: { caption?: string }; document?: { caption?: string };
};
type CloudEcho = { from: string; to: string; id: string; timestamp: string; type: string; text?: { body?: string } };
type WebhookValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: CloudMessage[];
  message_echoes?: CloudEcho[];
  statuses?: { status?: string; recipient_id?: string; errors?: { code?: number; title?: string }[] }[];
};
type WebhookBody = { object?: string; entry?: { changes?: { field?: string; value?: WebhookValue }[] }[] };

const MEDIA_TYPES: Record<string, string> = {
  image: 'image', audio: 'audio', video: 'video', document: 'document', sticker: 'sticker', location: 'location', contacts: 'contact',
};
// Reações e avisos do sistema não são mensagens para o bot responder.
const IGNORED_TYPES = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'request_welcome']);

function messageText(message: CloudMessage): string | null {
  return (
    message.text?.body
    ?? message.button?.text
    ?? message.interactive?.button_reply?.title
    ?? message.interactive?.list_reply?.title
    ?? message.image?.caption
    ?? message.video?.caption
    ?? message.document?.caption
  )?.trim() || null;
}

async function companyForPhoneNumber(phoneNumberId: string | undefined): Promise<string | null> {
  if (!phoneNumberId) return null;
  for (const [companyId, config] of configs) if (config.phoneNumberId === phoneNumberId) return companyId;
  return null;
}

async function processWebhook(body: WebhookBody) {
  if (body.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const companyId = await companyForPhoneNumber(value?.metadata?.phone_number_id);
      if (!value || !companyId) continue;

      for (const status of value.statuses ?? []) {
        if (status.status === 'failed') console.error('WhatsApp não entregou a mensagem para', status.recipient_id, status.errors?.[0]);
      }

      // Coexistência: a equipe respondeu pelo app WhatsApp Business do celular.
      for (const echo of value.message_echoes ?? []) {
        const text = echo.text?.body?.trim();
        if (text) await handleMessageFromPhone(companyId, echo.to, text);
      }

      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const message of value.messages ?? []) {
        if (IGNORED_TYPES.has(message.type)) continue;
        void markRead(companyId, message.id);
        await handleIncomingMessage({
          companyId,
          contactId: message.from,
          messageId: message.id,
          text: messageText(message),
          mediaType: MEDIA_TYPES[message.type],
          profileName: names.get(message.from) ?? undefined,
          send: (reply) => sendCloudText(companyId, message.from, reply),
          // A API oficial não acessa a agenda do celular: não há contato para salvar.
        });
      }
    }
  }
}
