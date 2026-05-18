import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { sendOTP, verifyOTP } from '../services/otp';
import { authRateLimit } from '../middleware/ratelimit';

export const verifyRouter = Router();

// POST /verify/send
verifyRouter.post('/send', requireAuth, authRateLimit, async (req: any, res, next) => {
  try {
    const { contact, type } = z.object({
      contact: z.string().min(5).max(255),
      type:    z.enum(['phone', 'email']),
    }).parse(req.body);
    await sendOTP(req.uid, contact, type);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /verify/confirm
verifyRouter.post('/confirm', requireAuth, async (req: any, res, next) => {
  try {
    const { contact, type, code } = z.object({
      contact: z.string(),
      type:    z.enum(['phone', 'email']),
      code:    z.string().length(6),
    }).parse(req.body);
    const result = await verifyOTP(contact, type, code);
    if (!result.valid) return res.status(400).json({ error: result.reason });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
