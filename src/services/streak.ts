import { pool } from '../db/pool';
import { sendToUser } from '../ws/server';

const BADGE_MILESTONES: Record<number, string> = {
  7:   'Night Owl 🦉',
  14:  'Midnight Wanderer 🌌',
  30:  'Insomniac 🖤',
  60:  'Ghost Hour 👻',
  100: 'The Regular ✦',
};

export async function updateStreak(userId: string): Promise<void> {
  const user = await pool.query(
    `SELECT streak, streak_last_called, badges FROM users WHERE id = $1`, [userId],
  );
  if (!user.rows[0]) return;

  const { streak, streak_last_called, badges } = user.rows[0];
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (streak_last_called === today) return;

  const newStreak = streak_last_called === yesterday ? streak + 1 : 1;

  await pool.query(
    `UPDATE users SET streak = $1, streak_last_called = $2 WHERE id = $3`,
    [newStreak, today, userId],
  );

  const milestone = BADGE_MILESTONES[newStreak];
  if (milestone && !badges.includes(milestone)) {
    await pool.query(
      `UPDATE users SET badges = array_append(badges, $1) WHERE id = $2`,
      [milestone, userId],
    );
    sendToUser(userId, { type: 'badge:unlocked', payload: { badge: milestone, streak: newStreak } });
  }
}

export async function detectMissedStreaks(): Promise<Array<{ id: string; streak: number; push_endpoint: string | null; push_keys: unknown }>> {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT id, streak, push_endpoint, push_keys
     FROM users
     WHERE streak > 0
       AND (streak_last_called IS NULL OR streak_last_called < $1)`,
    [yesterday],
  );
  for (const user of result.rows) {
    await pool.query(`UPDATE users SET streak = 0 WHERE id = $1`, [user.id]);
  }
  return result.rows;
}
