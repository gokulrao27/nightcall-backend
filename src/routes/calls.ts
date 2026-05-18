import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { redis } from '../redis/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { callRateLimit } from '../middleware/ratelimit';
import { endCall } from '../ws/matchmaking';
import { config } from '../config';
import { logger } from '../logger';

export const callsRouter = Router();

// GET /call/history?cursor=&limit=20
callsRouter.get('/history', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    const query = cursor
      ? `SELECT c.id, c.room_id, c.started_at, c.ended_at, c.duration_secs, c.ended_by,
                w.word
         FROM calls c
         LEFT JOIN words w ON w.call_id = c.id AND w.user_id = $1
         WHERE (c.user_a = $1 OR c.user_b = $1)
           AND c.started_at < $2
         ORDER BY c.started_at DESC LIMIT $3`
      : `SELECT c.id, c.room_id, c.started_at, c.ended_at, c.duration_secs, c.ended_by,
                w.word
         FROM calls c
         LEFT JOIN words w ON w.call_id = c.id AND w.user_id = $1
         WHERE (c.user_a = $1 OR c.user_b = $1)
         ORDER BY c.started_at DESC LIMIT $2`;

    const params = cursor ? [uid, cursor, limit] : [uid, limit];
    const result = await pool.query(query, params);
    const calls = result.rows;
    const nextCursor = calls.length === limit ? calls[calls.length - 1].started_at : null;

    res.json({ calls, nextCursor });
  } catch (err) {
    next(err);
  }
});

// POST /call/end — manually end a call early
callsRouter.post('/end', requireAuth, callRateLimit, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const roomId = await redis.get(`user:${uid}:room`);

    if (!roomId) {
      res.status(404).json({ error: 'No active call found' });
      return;
    }

    await endCall(roomId, 'system');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /call/ice-config — TURN server credentials for WebRTC
callsRouter.get('/ice-config', requireAuth, async (_req, res: Response, next: NextFunction) => {
  try {
    // Strategy 1: Fetch live credentials from Metered REST API
    if (config.METERED_API_KEY && config.METERED_DOMAIN) {
      try {
        const meteredRes = await fetch(
          `https://${config.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${config.METERED_API_KEY}`
        );
        if (meteredRes.ok) {
          const iceServers = await meteredRes.json() as unknown[];
          res.json(iceServers);
          return;
        }
      } catch (fetchErr) {
        logger.warn({ fetchErr }, 'Metered API fetch failed, falling back to static credentials');
      }
    }

    // Strategy 2: Static credentials from env vars
    if (config.TURN_USERNAME && config.TURN_CREDENTIAL) {
      res.json([
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:global.relay.metered.ca:80',                 username: config.TURN_USERNAME, credential: config.TURN_CREDENTIAL },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp',   username: config.TURN_USERNAME, credential: config.TURN_CREDENTIAL },
        { urls: 'turn:global.relay.metered.ca:443',                username: config.TURN_USERNAME, credential: config.TURN_CREDENTIAL },
        { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: config.TURN_USERNAME, credential: config.TURN_CREDENTIAL },
      ]);
      return;
    }

    // Strategy 3: STUN only (last resort)
    logger.warn('No TURN credentials configured — returning STUN only');
    res.json([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]);
  } catch (err) {
    next(err);
  }
});
