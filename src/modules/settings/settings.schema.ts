import { z } from 'zod';

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
});

export const addInterestSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do interesse.').max(40, 'Nome muito longo.'),
});
