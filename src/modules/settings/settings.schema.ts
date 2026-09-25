import { z } from 'zod';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const updateSettingsSchema = z.object({
  salonName: z.string().trim().min(1).optional(),
  ownerName: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  greetingMessage: z.string().trim().optional(),
  autoOldLeadDays: z.number().int().min(1).optional(),
  whatsappConnected: z.boolean().optional(),
  captureConversations: z.boolean().optional(),
  captureName: z.boolean().optional(),
  capturePhone: z.boolean().optional(),
  autoCreateLead: z.boolean().optional(),
  botEnabled: z.boolean().optional(),
  botSchedulingEnabled: z.boolean().optional(),
  botMenuOptions: z.array(z.enum(['agendar', 'ver', 'remarcar', 'equipe'])).min(1, 'Deixe ao menos uma opção no menu do bot.').optional(),
  botHandoffMessage: z.string().trim().min(1, 'Informe a mensagem de transferência.').max(1000).optional(),
  botConfirmationMessage: z.string().trim().min(1, 'Informe a mensagem de confirmação.').max(1000).optional(),
  botOpeningTime: z.string().regex(timePattern, 'Horário de abertura inválido.').optional(),
  botClosingTime: z.string().regex(timePattern, 'Horário de fechamento inválido.').optional(),
  botWorkDays: z.array(z.number().int().min(0).max(6)).min(1, 'Selecione ao menos um dia de atendimento.').optional(),
  botSlotMinutes: z.number().int().min(10, 'Duração mínima de 10 minutos.').max(480, 'Duração máxima de 8 horas.').optional(),
  botSlotCapacity: z.number().int().min(1, 'Informe ao menos 1 atendimento por horário.').max(20).optional(),
  botLunchEnabled: z.boolean().optional(),
  botLunchStart: z.string().regex(timePattern, 'Início do almoço inválido.').optional(),
  botLunchEnd: z.string().regex(timePattern, 'Fim do almoço inválido.').optional(),
  interests: z.array(z.string().trim().min(1, 'Informe o nome do serviço.').max(40, 'Nome muito longo.')).min(1, 'Cadastre ao menos um serviço.').max(50, 'Máximo de 50 serviços.').optional(),
  serviceDurations: z.record(z.string(), z.number().int().min(5, 'Duração mínima de 5 minutos.').max(600, 'Duração máxima de 10 horas.')).optional(),
  botReminderEnabled: z.boolean().optional(),
  botReminderTime: z.string().regex(timePattern, 'Horário do lembrete inválido.').optional(),
  botReminderMessage: z.string().trim().min(1, 'Informe a mensagem do lembrete.').max(1000).optional(),
  botHourReminderEnabled: z.boolean().optional(),
  botHourReminderMinutes: z.number().int().min(10, 'Aviso com no mínimo 10 minutos de antecedência.').max(720, 'Aviso com no máximo 12 horas de antecedência.').optional(),
  botHourReminderMessage: z.string().trim().min(1, 'Informe a mensagem do aviso.').max(1000).optional(),
  botPauseOnStaffReply: z.boolean().optional(),
  botHumanTimeoutMinutes: z.number().int().min(1, 'Prazo mínimo de 1 minuto.').max(1440, 'Prazo máximo de 24 horas.').optional(),
  botHumanEndMessage: z.string().trim().min(1, 'Informe a mensagem de encerramento.').max(1000).optional(),
  saveContactOnWhatsApp: z.boolean().optional(),
});

export const addInterestSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do interesse.').max(40, 'Nome muito longo.'),
});
