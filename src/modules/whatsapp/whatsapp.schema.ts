import { z } from 'zod';

export const replySchema = z.object({
  text: z.string().trim().min(1, 'Mensagem vazia.').max(4096, 'Mensagem muito longa.'),
});

export const cloudConfigSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'O ID do número tem só números (copie em WhatsApp > Configuração da API no Meta for Developers).'),
  wabaId: z.string().trim().regex(/^\d{5,30}$/, 'O ID da conta do WhatsApp Business (WABA) tem só números.'),
  // Opcional ao editar: vazio mantém o token já salvo.
  accessToken: z.string().trim().max(1000).optional(),
  // PIN de 6 dígitos da confirmação em duas etapas, para registrar o número (só na primeira vez).
  pin: z.string().trim().regex(/^\d{6}$/, 'O PIN tem 6 dígitos.').optional().or(z.literal('').transform(() => undefined)),
});

export const templateKindSchema = z.object({
  kind: z.enum(['lembrete_vespera', 'lembrete_hora', 'retorno_sem_agendamento', 'retorno_sem_agendamento_repetido', 'retorno_nao_fechou', 'retorno_inativo']),
});

export const sendTestSchema = z.object({
  to: z.string().trim().min(8, 'Informe um número de WhatsApp válido.'),
});
