import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { redis } from '../redis/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { callRateLimit } from '../middleware/ratelimit';
import { endCall } from '../ws/matchmaking';
import { config } from '../config';

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
    if (config.METERED_API_KEY) {
      const meteredRes = await fetch(
        `https://nighttalks.metered.live/api/v1/turn/credentials?apiKey=${config.METERED_API_KEY}`
      );
      if (!meteredRes.ok) throw new Error(`Metered API error: ${meteredRes.status}`);
      const iceServers = await meteredRes.json();
      res.json({ iceServers });
      return;
    }

    res.json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  } catch (err) {
    next(err);
  }
});
