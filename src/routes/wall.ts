import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { wallRateLimit } from '../middleware/ratelimit';
import { moderateText } from '../services/moderation';

export const wallRouter = Router();

// GET /wall?cursor=&limit=20
wallRouter.get('/', async (req, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    const query = cursor
      ? `SELECT id, body, country_vague, created_at FROM wall_posts
         WHERE is_approved = TRUE AND created_at < $1
         ORDER BY created_at DESC LIMIT $2`
      : `SELECT id, body, country_vague, created_at FROM wall_posts
         WHERE is_approved = TRUE
         ORDER BY created_at DESC LIMIT $1`;

    const params = cursor ? [cursor, limit] : [limit];
    const result = await pool.query(query, params);
    const posts = result.rows;
    const nextCursor = posts.length === limit ? posts[posts.length - 1].created_at : null;

    res.json({ posts, nextCursor });
  } catch (err) {
    next(err);
  }
});

const WallPostSchema = z.object({
  body: z.string().min(10).max(500),
  callId: z.string().uuid().optional(),
});

// POST /wall
wallRouter.post('/', requireAuth, wallRateLimit, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const { body, callId } = WallPostSchema.parse(req.body);

    // One confession per calendar day (UTC) per user
    const dayCheck = await pool.query(
      `SELECT id FROM wall_posts WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
      [uid],
    );
    if (dayCheck.rows.length >= 1) {
      res.status(429).json({ error: 'confession_limit', message: 'One confession per night — come back tomorrow' });
      return;
    }

    const { passed, reason } = moderateText(body);
    if (!passed) {
      res.status(422).json({ error: 'Content violates community guidelines', reason });
      return;
    }

    const userResult = await pool.query('SELECT timezone FROM users WHERE id = $1', [uid]);
    const countryVague = timezoneToVagueCountry(userResult.rows[0]?.timezone ?? '');

    const result = await pool.query(
      `INSERT INTO wall_posts (user_id, call_id, body, country_vague)
       VALUES ($1, $2, $3, $4)
       RETURNING id, body, country_vague, created_at`,
      [uid, callId ?? null, body, countryVague],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

function timezoneToVagueCountry(tz: string): string {
  const map: Record<string, string> = {
    'Asia/Kolkata': 'somewhere in India',
    'Asia/Tokyo': 'somewhere in Japan',
    'America/Sao_Paulo': 'somewhere in Brazil',
    'Europe/London': 'somewhere in the UK',
    'America/New_York': 'somewhere in the US',
    'America/Los_Angeles': 'somewhere in the US',
    'Europe/Paris': 'somewhere in Europe',
    'Australia/Sydney': 'somewhere in Australia',
    'Asia/Singapore': 'somewhere in Southeast Asia',
    'Asia/Seoul': 'somewhere in Korea',
  };
  return map[tz] ?? 'somewhere in the world';
}
