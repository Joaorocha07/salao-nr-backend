import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da campanha.'),
  message: z.string().trim().min(1, 'Informe a mensagem.'),
  mediaUrl: z.string().trim().url().optional(),
  recipientIds: z.array(z.string().uuid()).min(1, 'Selecione pelo menos um destinatário.'),
});
