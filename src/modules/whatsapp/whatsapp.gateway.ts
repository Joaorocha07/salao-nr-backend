import { prisma } from '../../lib/prisma';
import { AutomaticMessage } from './whatsapp.bot';
import { cloudRecipient, isCloudConnected, sendCloudTemplate, sendCloudText } from './whatsapp.cloud';
import * as web from './whatsapp.connection';
import { storedTemplates, templateParams } from './whatsapp.templates';

// Envio de mensagens independente de como a empresa conectou o WhatsApp:
// QR Code (whatsapp.connection.ts) ou API oficial (whatsapp.cloud.ts).
// Jobs, serviço e bot mandam tudo por aqui.

// Janela de atendimento da API oficial: 24h desde a última mensagem do
// cliente (com folga, para não estourar no meio do envio).
const WINDOW_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

// Mensagem automática fora da janela de 24h sem modelo aprovado cadastrado.
export class NoTemplateError extends Error {}

export function isConnected(companyId: string): boolean {
  return isCloudConnected(companyId) || web.isConnected(companyId);
}

export function windowOpen(lastClientMessageAt: Date | null | undefined, now = Date.now()): boolean {
  return Boolean(lastClientMessageAt && now - lastClientMessageAt.getTime() < WINDOW_MS);
}

export async function sendMessage(companyId: string, contact: string, text: string, automatic?: AutomaticMessage): Promise<void> {
  if (!isCloudConnected(companyId)) {
    await web.sendText(companyId, contact, text);
    return;
  }
  if (!automatic || windowOpen(automatic.lastClientMessageAt)) {
    await sendCloudText(companyId, contact, text);
    return;
  }
  const settings = await prisma.companySettings.findUnique({ where: { companyId }, select: { whatsappTemplates: true } });
  const template = settings && storedTemplates(settings)[automatic.kind];
  if (!template) throw new NoTemplateError(`Sem modelo aprovado para "${automatic.kind}": a mensagem não foi enviada (cliente fora da janela de 24h).`);
  await sendCloudTemplate(companyId, contact, template.name, template.language, templateParams(template, automatic.vars));
}

// Número com WhatsApp para um cliente cadastrado à mão no CRM. A API oficial
// não tem como conferir antes de enviar: usa o número com DDI.
export async function findWhatsAppJid(companyId: string, phoneDigits: string): Promise<string | null> {
  if (isCloudConnected(companyId)) return cloudRecipient(phoneDigits);
  return web.findWhatsAppJid(companyId, phoneDigits);
}
