import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const pushRouter = Router();

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

// POST /push/subscribe
pushRouter.post('/subscribe', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const { endpoint, keys } = SubscribeSchema.parse(req.body);

    await pool.query(
      'UPDATE users SET push_endpoint = $1, push_keys = $2 WHERE id = $3',
      [endpoint, JSON.stringify(keys), uid],
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /push/subscribe
pushRouter.delete('/subscribe', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;

    await pool.query(
      'UPDATE users SET push_endpoint = NULL, push_keys = NULL WHERE id = $1',
      [uid],
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
