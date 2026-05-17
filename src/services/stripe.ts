import StripeLib from 'stripe';
import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from '../logger';

type StripeClient = InstanceType<typeof StripeLib>;

let stripeClient: StripeClient | null = null;

export function getStripe(): StripeClient {
  if (!stripeClient) {
    if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
    stripeClient = new StripeLib(config.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export async function createCheckoutSession(
  userId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  if (!config.STRIPE_PREMIUM_PRICE_ID) throw new Error('STRIPE_PREMIUM_PRICE_ID not set');

  const stripe = getStripe();

  // Look up existing Stripe customer for this user
  const subResult = await pool.query(
    'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL LIMIT 1',
    [userId],
  );

  let customerId: string | undefined = (subResult.rows[0] as { stripe_customer_id: string } | undefined)
    ?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { nightcall_user_id: userId },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: config.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { nightcall_user_id: userId },
  });

  return session.url ?? '';
}

export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  if (!config.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const stripe = getStripe();
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err }, 'Stripe webhook signature verification failed');
    throw err;
  }

  if (event.type === 'checkout.session.completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any;
    const userId = (session.metadata?.nightcall_user_id as string | undefined);
    const customerId: string | undefined =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subId: string | undefined =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

    if (!userId) return;

    await pool.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_sub_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_customer_id) DO UPDATE
         SET stripe_sub_id = EXCLUDED.stripe_sub_id, cancelled_at = NULL`,
      [userId, customerId, subId],
    );
    await pool.query(
      "UPDATE users SET tier = 'premium', updated_at = NOW() WHERE id = $1",
      [userId],
    );
    logger.info({ userId }, 'User upgraded to premium');
  }

  if (event.type === 'customer.subscription.deleted') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = event.data.object as any;
    const customerId: string =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    await pool.query(
      'UPDATE subscriptions SET cancelled_at = NOW() WHERE stripe_customer_id = $1',
      [customerId],
    );
    const userRow = await pool.query(
      'SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1',
      [customerId],
    );
    if (userRow.rows[0]) {
      await pool.query(
        "UPDATE users SET tier = 'free', updated_at = NOW() WHERE id = $1",
        [(userRow.rows[0] as { user_id: string }).user_id],
      );
    }
  }
}
