import { z } from 'zod';

export const replySchema = z.object({
  text: z.string().trim().min(1, 'Mensagem vazia.').max(4096, 'Mensagem muito longa.'),
});

export const sendTestSchema = z.object({
  to: z.string().trim().min(8, 'Informe um número de WhatsApp válido.'),
});
