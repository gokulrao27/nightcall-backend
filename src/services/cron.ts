import cron from 'node-cron';
import webpush from 'web-push';
import { pool } from '../db/pool';
import { detectMissedStreaks } from './streak';
import { logger } from '../logger';

async function pushToUser(userId: string, title: string, body: string): Promise<void> {
  const user = await pool.query(
    `SELECT push_endpoint, push_keys FROM users WHERE id = $1 AND push_endpoint IS NOT NULL`,
    [userId],
  );
  if (!user.rows[0]) return;
  const { push_endpoint, push_keys } = user.rows[0];
  await webpush.sendNotification(
    { endpoint: push_endpoint, keys: push_keys },
    JSON.stringify({ title, body }),
  ).catch(() => { /* stale endpoint */ });
}

export function startCronJobs(): void {
  // 2:40 AM UTC — "10 minutes left" warning
  cron.schedule('40 2 * * *', async () => {
    logger.info('Cron: sending closes-soon push');
    const users = await pool.query(`SELECT id FROM users WHERE push_endpoint IS NOT NULL`);
    await Promise.allSettled(
      users.rows.map((u: { id: string }) =>
        pushToUser(u.id, '⏱ 10 minutes left.', 'The line closes at 2:50am. Last chance tonight.'),
      ),
    );
  });

  // 8:00 AM — Morning report
  cron.schedule('0 8 * * *', async () => {
    logger.info('Cron: sending morning report push');
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const stats = await pool.query(
      `SELECT total_calls, most_common_word FROM nightly_stats WHERE stat_date = $1`,
      [yesterday],
    );
    if (!stats.rows[0]) return;
    const { total_calls, most_common_word } = stats.rows[0];
    const body = `${Number(total_calls).toLocaleString()} calls last night. Most common word: "${most_common_word ?? '—'}"`;
    const users = await pool.query(`SELECT id FROM users WHERE push_endpoint IS NOT NULL`);
    await Promise.allSettled(
      users.rows.map((u: { id: string }) =>
        pushToUser(u.id, '☀️ Last night on NightCall', body),
      ),
    );
  });

  // 9:00 PM — Streak at risk
  cron.schedule('0 21 * * *', async () => {
    logger.info('Cron: sending streak-at-risk push');
    const today = new Date().toISOString().split('T')[0];
    const users = await pool.query(
      `SELECT id, streak FROM users
       WHERE streak > 0
         AND (streak_last_called IS NULL OR streak_last_called < $1)
         AND push_endpoint IS NOT NULL`,
      [today],
    );
    await Promise.allSettled(
      users.rows.map((u: { id: string; streak: number }) =>
        pushToUser(
          u.id,
          '🔥 Don\'t break your streak.',
          `You've called ${u.streak} nights in a row. Tonight is the night.`,
        ),
      ),
    );
  });

  // Midnight — detect missed streaks + send "streak lost" push
  cron.schedule('0 0 * * *', async () => {
    logger.info('Cron: detecting missed streaks');
    const missed = await detectMissedStreaks();
    await Promise.allSettled(
      missed.filter((u) => u.push_endpoint).map((u) =>
        pushToUser(
          u.id,
          '💔 Streak lost.',
          `You missed last night. Your ${u.streak}-night streak is gone. Start again tonight.`,
        ),
      ),
    );
  });

  // 8:30 AM — "Someone liked your post"
  cron.schedule('30 8 * * *', async () => {
    logger.info('Cron: sending wall likes notifications');
    const results = await pool.query(`
      SELECT
        wp.user_id,
        COUNT(wl.id)::int AS new_likes,
        u.push_endpoint,
        u.push_keys
      FROM wall_likes wl
      JOIN wall_posts wp ON wp.id = wl.post_id
      JOIN users u ON u.id = wp.user_id
      WHERE wl.created_at > NOW() - INTERVAL '24 hours'
        AND u.push_endpoint IS NOT NULL
        AND wp.user_id != wl.user_id
      GROUP BY wp.user_id, u.push_endpoint, u.push_keys
      HAVING COUNT(wl.id) > 0
    `);
    await Promise.allSettled(
      results.rows.map((r: { push_endpoint: string; push_keys: { p256dh: string; auth: string }; new_likes: number }) =>
        webpush.sendNotification(
          { endpoint: r.push_endpoint, keys: r.push_keys },
          JSON.stringify({
            title: 'Your Wall post got noticed.',
            body: `${r.new_likes} ${r.new_likes === 1 ? 'person' : 'people'} connected with what you wrote last night.`,
          }),
        ).catch(() => {}),
      ),
    );
  });

  logger.info('Cron jobs started');
}
