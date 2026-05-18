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
import { verifyRouter } from './routes/verify';
import { usernameRouter } from './routes/username';
import { confessionsRouter } from './routes/confessions';
import { statsRouter } from './routes/stats';
import { errorHandler } from './middleware/error';
import { setupWebSocket } from './ws/server';
import { configureWebPush } from './services/webpush';
import { startCronJobs } from './services/cron';

configureWebPush();

const app = express();
const server = http.createServer(app);

app.use(helmet());

// Support comma-separated allowed origins (e.g. "https://app.vercel.app,http://localhost:5173")
const allowedOrigins = config.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no origin) and listed origins
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);
app.use(pinoHttp({ logger }));
app.options('/{*path}', cors());

// Stripe webhook must receive raw body — mount before express.json()
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10kb' }));

// Health + diagnostics
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/ping', (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: config.NODE_ENV,
    turnConfigured: !!(config.TURN_USERNAME || config.METERED_API_KEY),
    cors: config.FRONTEND_URL,
  });
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
app.use('/verify',     verifyRouter);
app.use('/username',   usernameRouter);
app.use('/confession', confessionsRouter);
app.use('/stats',      statsRouter);

app.get('/ws-test', (req, res) => {
  res.json({
    ok: true,
    message: 'WebSocket server is mounted at /ws on this same server',
    wsUrl: `wss://${req.headers.host ?? 'unknown'}/ws`,
    hint: 'If HTTP works but WS fails, check Railway does not strip Upgrade headers',
  });
});

app.use(errorHandler);

// Log every HTTP→WS upgrade request so Railway forwarding can be confirmed in logs
server.on('upgrade', (request) => {
  logger.info({ url: request.url }, 'WS: HTTP upgrade request received');
});

// WebSocket server — must be before server.listen()
setupWebSocket(server);

const PORT = parseInt(config.PORT, 10);

server.listen(PORT, '0.0.0.0', async () => {
  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error({ err }, 'PostgreSQL connection failed — continuing anyway');
  }

  try {
    await redis.ping();
    logger.info('Redis connected');
  } catch (err) {
    logger.error({ err }, 'Redis connection failed — continuing anyway');
  }

  if (config.NODE_ENV === 'production') startCronJobs();

  logger.info({ port: PORT }, 'NightCall backend running');
});

export { server, logger };
