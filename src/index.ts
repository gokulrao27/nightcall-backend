import http from 'http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { pool } from './db/pool';
import { redis } from './redis/client';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { callsRouter } from './routes/calls';
import { wordsRouter } from './routes/words';
import { wallRouter } from './routes/wall';
import { reportsRouter } from './routes/reports';
import { pushRouter } from './routes/push';
import { stripeRouter } from './routes/stripe';
import { errorHandler } from './middleware/error';
import { setupWebSocket } from './ws/server';
import { configureWebPush } from './services/webpush';

configureWebPush();

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(pinoHttp({ logger }));

// Stripe webhook must receive raw body — mount before express.json()
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10kb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Routes
app.use('/auth', authRouter);
app.use('/me', usersRouter);
app.use('/call', callsRouter);
app.use('/word', wordsRouter);
app.use('/wall', wallRouter);
app.use('/report', reportsRouter);
app.use('/push', pushRouter);
// Stripe routes handle both /subscription/checkout and /webhook internally
app.use('/', stripeRouter);

app.use(errorHandler);

// WebSocket server
setupWebSocket(server);

const PORT = parseInt(config.PORT, 10);

server.listen(PORT, '0.0.0.0', async () => {
  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error(err, 'PostgreSQL connection failed');
  }

  try {
    await redis.ping();
    logger.info('Redis connected');
  } catch (err) {
    logger.error(err, 'Redis connection failed');
  }

  logger.info({ port: PORT }, 'NightCall backend running');
});

export { server, logger };
