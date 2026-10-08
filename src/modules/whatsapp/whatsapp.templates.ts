import crypto from 'crypto';
import { CompanySettings, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/httpError';
import { AutomaticKind, MessageVars, automaticMessageText } from './whatsapp.bot';
import { CloudApiError, cloudConfig, graph } from './whatsapp.cloud';

// Modelos (templates) da Meta para as mensagens automáticas. Pela API oficial,
// lembretes e retornos quase sempre saem mais de 24h depois da última mensagem
// do cliente, e aí só modelo aprovado pode ser enviado. O CRM gera o modelo a
// partir da mensagem configurada na tela WhatsApp ({nome} -> {{1}} ...), manda
// para aprovação e guarda nome e ordem das variáveis em
// CompanySettings.whatsappTemplates. Mudou a mensagem? Basta enviar de novo:
// o nome do modelo muda junto com o texto.

type Category = 'UTILITY' | 'MARKETING';
type VarName = keyof MessageVars;
export type StoredTemplate = { name: string; language: string; params: VarName[]; text: string; category: Category };
type StoredTemplates = Partial<Record<AutomaticKind, StoredTemplate>>;

export const TEMPLATE_KINDS: { kind: AutomaticKind; label: string; category: Category; vars: VarName[] }[] = [
  { kind: 'lembrete_vespera', label: 'Lembrete na véspera', category: 'UTILITY', vars: ['nome', 'servico', 'data', 'hora'] },
  { kind: 'lembrete_hora', label: 'Aviso pouco antes do horário', category: 'UTILITY', vars: ['nome', 'servico', 'data', 'hora'] },
  { kind: 'retorno_sem_agendamento', label: 'Retorno: primeira mensagem para quem não agendou', category: 'MARKETING', vars: ['nome', 'servico'] },
  { kind: 'retorno_sem_agendamento_repetido', label: 'Retorno: mensagem que se repete para quem não agendou', category: 'MARKETING', vars: ['nome', 'servico'] },
  { kind: 'retorno_nao_fechou', label: 'Retorno: clientes que não fecharam', category: 'MARKETING', vars: ['nome', 'servico'] },
  { kind: 'retorno_inativo', label: 'Retorno: clientes antigos que sumiram', category: 'MARKETING', vars: ['nome', 'servico'] },
];

const LANGUAGE = 'pt_BR';
const EXAMPLES: Record<VarName, string> = { nome: 'Maria', servico: 'Corte', data: '25/12', hora: '14:00' };
// Variável vazia é recusada pela Meta: usa um texto neutro no lugar.
const EMPTY_FALLBACK: Record<VarName, string> = { nome: 'cliente', servico: 'seu atendimento', data: '-', hora: '-' };
const MARK = '\u0001';

export function storedTemplates(settings: Pick<CompanySettings, 'whatsappTemplates'>): StoredTemplates {
  return (settings.whatsappTemplates ?? {}) as StoredTemplates;
}

// Corpo do modelo: a mensagem como o cliente recebe, com {{1}}, {{2}}... no
// lugar das variáveis, na ordem em que aparecem.
export function templateBody(settings: CompanySettings, kind: AutomaticKind): { text: string; params: VarName[] } {
  const info = TEMPLATE_KINDS.find((k) => k.kind === kind)!;
  const marked = automaticMessageText(settings, kind, Object.fromEntries(info.vars.map((v) => [v, `${MARK}${v}${MARK}`])));
  const params: VarName[] = [];
  const text = marked.replace(new RegExp(`${MARK}(\\w+)${MARK}`, 'g'), (_, name: VarName) => {
    params.push(name);
    return `{{${params.length}}}`;
  });
  return { text, params };
}

// Valores das variáveis na ordem do modelo.
export function templateParams(template: StoredTemplate, vars: MessageVars): string[] {
  return template.params.map((name) => (vars[name] ?? '').trim() || EMPTY_FALLBACK[name]);
}

function templateName(kind: AutomaticKind, text: string, category: Category): string {
  const hash = crypto.createHash('sha1').update(`${category}:${text}`).digest('hex').slice(0, 8);
  return `nr_${kind}_${hash}`;
}

type MetaTemplate = { id: string; name: string; language: string; status: string; category: string; rejected_reason?: string };

async function fetchMetaTemplates(companyId: string): Promise<MetaTemplate[]> {
  const config = cloudConfig(companyId);
  if (!config?.wabaId) return [];
  const result = await graph<{ data: MetaTemplate[] }>(config.token, `${config.wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason&limit=250`);
  return result.data ?? [];
}

function requireCloud(companyId: string) {
  const config = cloudConfig(companyId);
  if (!config) throw HttpError.badRequest('Configure a API oficial do WhatsApp antes de criar os modelos.');
  if (!config.wabaId) throw HttpError.badRequest('Informe o ID da conta do WhatsApp Business (WABA) na configuração da API oficial.');
  return config;
}

// Situação de cada mensagem automática: modelo enviado, status na Meta e se
// a mensagem configurada mudou depois do envio.
export async function listTemplates(companyId: string) {
  requireCloud(companyId);
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { companyId } });
  const stored = storedTemplates(settings);
  let meta: MetaTemplate[] = [];
  let error: string | null = null;
  try {
    meta = await fetchMetaTemplates(companyId);
  } catch (err) {
    error = err instanceof CloudApiError ? err.message : 'Não foi possível consultar os modelos na Meta.';
  }
  return {
    error,
    templates: TEMPLATE_KINDS.map((info) => {
      const current = templateBody(settings, info.kind);
      const template = stored[info.kind] ?? null;
      const onMeta = template ? meta.find((m) => m.name === template.name && m.language === template.language) : undefined;
      return {
        kind: info.kind,
        label: info.label,
        category: info.category,
        text: current.text,
        template: template ? { name: template.name, text: template.text } : null,
        status: template ? onMeta?.status ?? (error ? 'DESCONHECIDO' : 'NAO_ENCONTRADO') : 'NAO_ENVIADO',
        rejectedReason: onMeta?.rejected_reason && onMeta.rejected_reason !== 'NONE' ? onMeta.rejected_reason : null,
        outdated: Boolean(template && template.text !== current.text),
      };
    }),
  };
}

// Cria na Meta o modelo da mensagem automática, com o texto configurado agora.
export async function submitTemplate(companyId: string, kind: AutomaticKind) {
  const config = requireCloud(companyId);
  const info = TEMPLATE_KINDS.find((k) => k.kind === kind);
  if (!info) throw HttpError.badRequest('Tipo de mensagem desconhecido.');
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { companyId } });
  const { text, params } = templateBody(settings, kind);
  // Regras da Meta: variável não pode abrir nem fechar o texto.
  if (/^\s*\{\{\d+\}\}/.test(text) || /\{\{\d+\}\}\s*[.!?]?\s*$/.test(text)) {
    throw HttpError.badRequest('A Meta não aceita mensagem que começa ou termina com um marcador como {nome}. Coloque um texto antes e depois (ex.: "Olá, {nome}! ... Até logo!").');
  }
  if (text.length > 1024) throw HttpError.badRequest('A mensagem passou de 1024 caracteres, o limite da Meta para modelos.');

  const name = templateName(kind, text, info.category);
  try {
    await graph(config.token, `${config.wabaId}/message_templates`, {
      method: 'POST',
      body: {
        name,
        language: LANGUAGE,
        category: info.category,
        components: [{ type: 'BODY', text, ...(params.length ? { example: { body_text: [params.map((p) => EXAMPLES[p])] } } : {}) }],
      },
    });
  } catch (err) {
    // Mesmo texto já enviado antes: o modelo já existe, só passa a usá-lo.
    const exists = (await fetchMetaTemplates(companyId).catch(() => [])).some((m) => m.name === name && m.language === LANGUAGE);
    if (!exists) throw HttpError.badRequest(err instanceof CloudApiError ? `A Meta recusou o modelo: ${err.message}` : 'Não foi possível enviar o modelo para a Meta.');
  }

  const stored = { ...storedTemplates(settings), [kind]: { name, language: LANGUAGE, params, text, category: info.category } };
  await prisma.companySettings.update({ where: { companyId }, data: { whatsappTemplates: stored as Prisma.InputJsonValue } });
  return listTemplates(companyId);
}
