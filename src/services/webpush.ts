import webpush from 'web-push';
import { pool } from '../db/pool';
import { config } from '../config';
import { logger } from '../logger';

export function configureWebPush(): void {
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_EMAIL) {
    webpush.setVapidDetails(
      config.VAPID_EMAIL,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY,
    );
  }
}

export async function sendWindowOpenNotifications(): Promise<void> {
  const users = await pool.query(
    'SELECT push_endpoint, push_keys FROM users WHERE push_endpoint IS NOT NULL',
  );

  const payload = JSON.stringify({
    title: 'NightCall',
    body: 'The line opens in 5 minutes. Are you ready?',
  });

  const results = await Promise.allSettled(
    users.rows.map((u: { push_endpoint: string; push_keys: webpush.PushSubscription['keys'] }) =>
      webpush.sendNotification(
        { endpoint: u.push_endpoint, keys: u.push_keys },
        payload,
      ),
    ),
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  logger.info({ sent: results.length - failed, failed }, 'Push notifications dispatched');
}
