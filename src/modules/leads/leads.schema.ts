import { z } from 'zod';
import { LeadStatus } from '@prisma/client';

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.'),
  phone: z.string().trim().min(8, 'Telefone inválido.'),
  gender: z.string().trim().optional(),
  interests: z.array(z.string().trim().min(1)).min(1, 'Selecione pelo menos um interesse.'),
  status: z.nativeEnum(LeadStatus).default(LeadStatus.NOVO_LEAD),
});

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(8).optional(),
  gender: z.string().trim().optional(),
  birthday: z.string().trim().optional(),
  interests: z.array(z.string().trim().min(1)).optional(),
  status: z.nativeEnum(LeadStatus).optional(),
});

export const scheduleAppointmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido.'),
});

export const addNoteSchema = z.object({
  text: z.string().trim().min(1, 'Observação vazia.'),
});

export const addMessageSchema = z.object({
  text: z.string().trim().min(1, 'Mensagem vazia.'),
  own: z.boolean().default(false),
});

export const listLeadsQuerySchema = z.object({
  status: z.nativeEnum(LeadStatus).optional(),
  search: z.string().trim().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
