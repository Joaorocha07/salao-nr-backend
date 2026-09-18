import { z } from 'zod';

export const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'Informe o nome do salão.'),
  name: z.string().trim().min(2, 'Informe seu nome completo.'),
  email: z.string().trim().email('E-mail inválido.').toLowerCase(),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.'),
});

export const registerEmployeeSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome completo.'),
  email: z.string().trim().email('E-mail inválido.').toLowerCase(),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.'),
  companyId: z.string().uuid('Selecione uma empresa válida.'),
});

export const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido.').toLowerCase(),
  password: z.string().min(1, 'Informe a senha.'),
});

export const selectCompanySchema = z.object({
  preAuthToken: z.string().min(1, 'Token de pré-autenticação ausente.'),
  companyId: z.string().uuid('Empresa inválida.'),
});

export const switchCompanySchema = z.object({
  companyId: z.string().uuid('Empresa inválida.'),
});

export const googleAuthSchema = z.object({
  credential: z.string().min(1, 'Credencial Google ausente.'),
  companyId: z.string().uuid().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('E-mail inválido.').toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token ausente.'),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: z.string().min(8, 'A nova senha precisa ter pelo menos 8 caracteres.'),
});
