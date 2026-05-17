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
           COUNT(DISTINCT w.id)::int                                           AS total_words
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
