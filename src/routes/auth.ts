import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool';
import { config } from '../config';
import { authRateLimit } from '../middleware/ratelimit';

export const authRouter = Router();

const InitSchema = z.object({
  pseudonym: z.string().min(2).max(30),
  avatar: z.string().max(30),
  timezone: z.string().max(60),
  consentAge: z.boolean().refine((v) => v === true, { message: 'Age consent required' }),
  consentAnon: z.boolean().refine((v) => v === true, { message: 'Anonymity consent required' }),
  consentTerms: z.boolean().refine((v) => v === true, { message: 'Terms consent required' }),
});

// POST /auth/init — called once on onboarding completion
authRouter.post('/init', authRateLimit, async (req, res, next) => {
  try {
    const body = InitSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO users
        (pseudonym, avatar, timezone, consent_age, consent_anon, consent_terms, consented_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       RETURNING id, pseudonym, avatar, timezone, tier`,
      [body.pseudonym, body.avatar, body.timezone, body.consentAge, body.consentAnon, body.consentTerms],
    );
    const user = result.rows[0] as { id: string };
    const token = jwt.sign({ uid: user.id }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh — extend token
authRouter.post('/refresh', authRateLimit, async (req, res, next) => {
  try {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) {
      res.status(401).json({ error: 'No token' });
      return;
    }
    const payload = jwt.verify(auth, config.JWT_SECRET) as { uid: string };
    const token = jwt.sign({ uid: payload.uid }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});
