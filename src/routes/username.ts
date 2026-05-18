import { Router } from 'express';
import { pool } from '../db/pool';

export const usernameRouter = Router();

// GET /username/check?name=xyz
usernameRouter.get('/check', async (req, res, next) => {
  try {
    const name = String(req.query.name ?? '').trim().toLowerCase();
    if (name.length < 3)  return res.json({ available: false, reason: 'too_short' });
    if (name.length > 20) return res.json({ available: false, reason: 'too_long' });
    if (!/^[a-z0-9_]+$/.test(name)) return res.json({ available: false, reason: 'invalid_chars' });

    const blocked = ['nightcall', 'admin', 'support', 'abuse', 'root', 'system', 'null', 'undefined'];
    if (blocked.includes(name)) return res.json({ available: false, reason: 'reserved' });

    const result = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(pseudonym) = $1 LIMIT 1`, [name],
    );
    res.json({ available: result.rows.length === 0 });
  } catch (err) { next(err); }
});
