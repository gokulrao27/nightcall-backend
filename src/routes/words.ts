import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { moderateText } from '../services/moderation';

export const wordsRouter = Router();

const WordSchema = z.object({
  word: z.string().min(1).max(30).trim(),
  callId: z.string().uuid().optional(),
});

// POST /word
wordsRouter.post('/', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const { word, callId } = WordSchema.parse(req.body);

    const { passed, reason } = moderateText(word);
    if (!passed) {
      res.status(422).json({ error: 'Word violates community guidelines', reason });
      return;
    }

    const result = await pool.query(
      `INSERT INTO words (user_id, call_id, word)
       VALUES ($1, $2, $3)
       RETURNING id, word, created_at`,
      [uid, callId ?? null, word],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
