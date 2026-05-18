import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

export const confessionsRouter = Router();

// POST /confession
confessionsRouter.post('/', requireAuth, async (req: any, res, next) => {
  try {
    const { callId, question, answer } = z.object({
      callId:   z.string().uuid(),
      question: z.string().min(5).max(200),
      answer:   z.string().min(1).max(140),
    }).parse(req.body);

    const call = await pool.query(
      `SELECT user_a, user_b FROM calls WHERE id = $1`, [callId],
    );
    if (!call.rows[0]) return res.status(404).json({ error: 'Call not found' });
    const { user_a, user_b } = call.rows[0];
    if (user_a !== req.uid && user_b !== req.uid) {
      return res.status(403).json({ error: 'Not your call' });
    }

    await pool.query(
      `INSERT INTO confessions (user_id, call_id, question, answer)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, call_id) DO UPDATE SET answer = $4`,
      [req.uid, callId, question, answer],
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// GET /confession/:callId
confessionsRouter.get('/:callId', requireAuth, async (req: any, res, next) => {
  try {
    const { callId } = req.params;

    const call = await pool.query(
      `SELECT user_a, user_b FROM calls WHERE id = $1`, [callId],
    );
    if (!call.rows[0]) return res.status(404).json({ error: 'Call not found' });
    const { user_a, user_b } = call.rows[0];
    if (user_a !== req.uid && user_b !== req.uid) {
      return res.status(403).json({ error: 'Not your call' });
    }

    const peerId = user_a === req.uid ? user_b : user_a;

    const [mine, theirs] = await Promise.all([
      pool.query(`SELECT question, answer FROM confessions WHERE user_id=$1 AND call_id=$2`, [req.uid, callId]),
      pool.query(`SELECT question, answer FROM confessions WHERE user_id=$1 AND call_id=$2`, [peerId, callId]),
    ]);

    res.json({
      mine:   mine.rows[0] ?? null,
      theirs: theirs.rows[0] ?? null,
    });
  } catch (err) { next(err); }
});
