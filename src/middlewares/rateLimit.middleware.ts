import rateLimit from 'express-rate-limit';

// Limita tentativas de login/refresh para dificultar força bruta de senha
// e abuso de geração de tokens.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente em instantes.' } },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas requisições. Tente novamente em instantes.' } },
});
