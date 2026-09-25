import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  PORT: z.coerce.number().default(3333),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RENDER: z.string().optional().transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET precisa ter pelo menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET precisa ter pelo menos 16 caracteres'),
  JWT_PREAUTH_SECRET: z.string().min(16, 'JWT_PREAUTH_SECRET precisa ter pelo menos 16 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('24h'),
  JWT_PREAUTH_EXPIRES_IN: z.string().default('5m'),

  REFRESH_COOKIE_NAME: z.string().default('nr_refresh_token'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  GOOGLE_CLIENT_ID: z.string().optional(),

  // Conexão com o WhatsApp Web. Desligue em cópias locais que usam o mesmo
  // banco da produção, para não disputarem a sessão do WhatsApp.
  WHATSAPP_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  // Envio de e-mail (recuperação de senha). Sem SMTP_HOST, o link só aparece
  // no terminal do servidor. SMTP_SECURE=true para a porta 465 (SSL).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Remetente, ex.: "Espaço NR <no-reply@seudominio.com>". Padrão: SMTP_USER.
  MAIL_FROM: z.string().optional(),
  // Endereço do frontend usado nos links dos e-mails. Padrão: primeiro CORS_ORIGIN.
  APP_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  throw new Error('Configuração de ambiente inválida. Verifique o arquivo .env.');
}

export const env = parsed.data;
