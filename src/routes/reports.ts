import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const reportsRouter = Router();

const ReportSchema = z.object({
  reportedId: z.string().uuid(),
  callId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

// POST /report
reportsRouter.post('/', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const { reportedId, callId, reason } = ReportSchema.parse(req.body);

    if (uid === reportedId) {
      res.status(400).json({ error: 'Cannot report yourself' });
      return;
    }

    await pool.query(
      `INSERT INTO reports (reporter_id, reported_id, call_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [uid, reportedId, callId ?? null, reason ?? null],
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
