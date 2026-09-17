import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { apiRateLimiter } from './middlewares/rateLimit.middleware';
import { authRouter } from './modules/auth/auth.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { leadsRouter } from './modules/leads/leads.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { usersRouter } from './modules/users/users.routes';

export const app = express();

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

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/settings', settingsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
