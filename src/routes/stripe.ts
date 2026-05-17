import { Router, Response, NextFunction, Request } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { createCheckoutSession, handleWebhook } from '../services/stripe';
import { config } from '../config';

export const stripeRouter = Router();

// POST /subscription/checkout
stripeRouter.post('/subscription/checkout', requireAuth, async (req, res: Response, next: NextFunction) => {
  try {
    const uid = (req as AuthRequest).uid;
    const origin = config.FRONTEND_URL;

    const sessionUrl = await createCheckoutSession(
      uid,
      `${origin}/me?upgraded=1`,
      `${origin}/me?cancelled=1`,
    );

    res.json({ url: sessionUrl });
  } catch (err) {
    next(err);
  }
});

// POST /webhook — Stripe events (raw body applied in index.ts)
stripeRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    await handleWebhook(req.body as Buffer, Array.isArray(signature) ? signature[0] : signature);
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});
