import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openapiSpec } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { apiRateLimiter } from './middlewares/rateLimit.middleware';
import { authRouter } from './modules/auth/auth.routes';
import { leadsRouter } from './modules/leads/leads.routes';
import { companiesRouter } from './modules/companies/companies.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { usersRouter } from './modules/users/users.routes';

export const app = express();

// No Render, reconhece o proxy mesmo se NODE_ENV estiver configurado como development.
// Isso permite que os rate limiters identifiquem o IP de cada cliente.
app.set('trust proxy', env.RENDER || env.NODE_ENV === 'production' ? 1 : false);

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(apiRateLimiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// CSP do helmet bloqueia o script/CSS inline do Swagger UI; desliga só
// nessa rota (o resto da API segue com o CSP padrão do helmet).
app.use('/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.get('/docs.json', (_req, res) => res.json(openapiSpec));

app.use('/api/auth', authRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/users', usersRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/settings', settingsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
