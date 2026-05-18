import { Router, Response, NextFunction, Request } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { wallRateLimit } from '../middleware/ratelimit';
import { moderateText } from '../services/moderation';
import { config } from '../config';

export const wallRouter = Router();

// GET /wall?cursor=&limit=20&type=confession
wallRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;
    const type   = req.query.type as string | undefined;

    // Optional auth — liked_by_viewer needs the viewer's uid
    let viewerUid: string | null = null;
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        const payload = jwt.verify(token, config.JWT_SECRET) as { uid: string };
        viewerUid = payload.uid;
      }
    } catch { /* unauthenticated — likes show as not liked */ }

    const conditions: string[] = ['w.is_approved = TRUE'];
    const params: unknown[] = [];
    let pi = 1;

    if (cursor) { conditions.push(`w.created_at < $${pi++}`); params.push(cursor); }
    if (type && type !== 'all') { conditions.push(`w.type = $${pi++}`); params.push(type); }

    params.push(limit);
    const limitParam = pi;

    const query = `
      SELECT
        w.id, w.body, w.country_vague, w.created_at, w.type,
        COUNT(wl.id)::int AS like_count,
        COALESCE(${viewerUid ? `BOOL_OR(wl.user_id = '${viewerUid}')` : 'FALSE'}, FALSE) AS liked_by_viewer
      FROM wall_posts w
      LEFT JOIN wall_likes wl ON wl.post_id = w.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY w.id
      ORDER BY w.created_at DESC
      LIMIT $${limitParam}
    `;

    const result = await pool.query(query, params);
    const posts = result.rows;
    const nextCursor = posts.length === limit ? posts[posts.length - 1].created_at : null;

    res.json({ posts, nextCursor });
  } catch (err) { next(err); }
});

const WallPostSchema = z.object({
  body: z.string().min(10).max(500),
  callId: z.string().uuid().optional(),
});

// POST /wall
wallRouter.post('/', requireAuth, wallRateLimit, async (req: Request, res: Response, next: NextFunction) => {
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
  } catch (err) { next(err); }
});

// POST /wall/:id/like — toggle like
wallRouter.post('/:id/like', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const { id } = req.params;

    const post = await pool.query(
      `SELECT id FROM wall_posts WHERE id = $1 AND is_approved = TRUE`, [id]
    );
    if (!post.rows[0]) { res.status(404).json({ error: 'Post not found' }); return; }

    const existing = await pool.query(
      `SELECT id FROM wall_likes WHERE user_id = $1 AND post_id = $2`, [uid, id]
    );

    if (existing.rows[0]) {
      await pool.query(`DELETE FROM wall_likes WHERE user_id = $1 AND post_id = $2`, [uid, id]);
      res.json({ liked: false });
    } else {
      await pool.query(`INSERT INTO wall_likes (user_id, post_id) VALUES ($1, $2)`, [uid, id]);
      res.json({ liked: true });
    }
  } catch (err) { next(err); }
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
