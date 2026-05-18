import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';


export const usersRouter = Router();

// GET /me
usersRouter.get('/', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;

    const [userResult, statsResult] = await Promise.all([
      pool.query(
        `SELECT id, pseudonym, avatar, timezone, tier, email, created_at
         FROM users WHERE id = $1`,
        [uid],
      ),
      pool.query(
        `SELECT
           COUNT(DISTINCT c.id)::int                                           AS total_calls,
           COALESCE(SUM(c.duration_secs), 0)::int / 60                        AS total_minutes,
           COUNT(DISTINCT w.id)::int                                           AS total_words,
           (SELECT COUNT(DISTINCT COALESCE(c2.country_a, c2.country_b))
            FROM calls c2
            WHERE (c2.user_a = u.id OR c2.user_b = u.id)
              AND c2.country_a IS NOT NULL)::int                               AS countries_reached
         FROM users u
         LEFT JOIN calls c ON (c.user_a = u.id OR c.user_b = u.id)
         LEFT JOIN words w ON w.user_id = u.id
         WHERE u.id = $1`,
        [uid],
      ),
    ]);

    if (!userResult.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: userResult.rows[0], stats: statsResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z.object({
  pseudonym: z.string().min(2).max(30).optional(),
  avatar: z.string().max(30).optional(),
  timezone: z.string().max(60).optional(),
});

// PUT /me
usersRouter.put('/', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const body = UpdateSchema.parse(req.body);

    const setClauses: string[] = [];
    const values: (string | undefined)[] = [];
    let idx = 1;

    if (body.pseudonym !== undefined) { setClauses.push(`pseudonym = $${idx++}`); values.push(body.pseudonym); }
    if (body.avatar !== undefined)    { setClauses.push(`avatar = $${idx++}`);    values.push(body.avatar); }
    if (body.timezone !== undefined)  { setClauses.push(`timezone = $${idx++}`);  values.push(body.timezone); }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(uid);

    const result = await pool.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}
       RETURNING id, pseudonym, avatar, timezone, tier`,
      values,
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /me/username — change pseudonym (once per 7 days)
usersRouter.put('/username', requireAuth, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { pseudonym } = z.object({
      pseudonym: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
    }).parse(req.body);

    const user = await pool.query(
      `SELECT username_changed_at FROM users WHERE id = $1`, [req.uid],
    );
    const lastChange = user.rows[0]?.username_changed_at;
    if (lastChange) {
      const daysSince = (Date.now() - new Date(lastChange).getTime()) / 86400000;
      if (daysSince < 7) {
        return res.status(400).json({
          error: 'Username can only be changed once every 7 days',
          daysRemaining: Math.ceil(7 - daysSince),
        });
      }
    }

    const taken = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(pseudonym)=LOWER($1) AND id != $2`, [pseudonym, req.uid],
    );
    if (taken.rows.length) return res.status(409).json({ error: 'Username taken' });

    await pool.query(
      `UPDATE users SET pseudonym=$1, username_changed_at=NOW() WHERE id=$2`,
      [pseudonym, req.uid],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /me — GDPR account deletion
usersRouter.delete('/', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
