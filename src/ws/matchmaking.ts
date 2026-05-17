import { redis } from '../redis/client';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { sendToUser, NightSocket } from './server';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_KEY = 'nightcall:queue';
const CALL_DURATION = 600; // 10 minutes in seconds

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function handleMatchmaking(
  ws: NightSocket,
  action: 'join' | 'leave' | 'pass',
): Promise<void> {
  if (action === 'leave' || action === 'pass') {
    await redis.lrem(QUEUE_KEY, 0, ws.uid);
    if (action === 'pass') {
      sendToUser(ws.uid, { type: 'queue:pass_used' });
    }
    return;
  }

  // Fetch user — check ban status and timezone
  const userResult = await pool.query(
    'SELECT timezone, tier, is_banned FROM users WHERE id = $1',
    [ws.uid],
  );

  const user = userResult.rows[0] as { timezone: string; tier: string; is_banned: boolean } | undefined;

  if (!user || user.is_banned) {
    sendToUser(ws.uid, { type: 'error', message: 'Account suspended' });
    return;
  }

  if (!isWindowOpen(user.timezone)) {
    sendToUser(ws.uid, { type: 'queue:closed', message: 'Line is not open yet' });
    return;
  }

  // Enforce daily call limit (free: 1, premium: 5)
  const limit = user.tier === 'premium' ? 5 : 1;
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM calls
     WHERE (user_a = $1 OR user_b = $1)
       AND started_at > NOW() - INTERVAL '24 hours'`,
    [ws.uid],
  );
  const todayCount = (countResult.rows[0] as { count: number }).count;

  if (todayCount >= limit) {
    sendToUser(ws.uid, { type: 'queue:limit_reached' });
    return;
  }

  // Deduplicate — don't add if already queued
  const queueList = await redis.lrange(QUEUE_KEY, 0, -1);
  if (queueList.includes(ws.uid)) return;

  // Try to match with someone already waiting
  let peerId: string | null = null;

  while (true) {
    peerId = await redis.lpop(QUEUE_KEY);
    if (!peerId) break;
    if (peerId !== ws.uid) break; // valid match found
    // was self somehow — discard and continue
  }

  if (!peerId) {
    // No one waiting — join the queue
    await redis.rpush(QUEUE_KEY, ws.uid);
    await redis.expire(QUEUE_KEY, 3600);
    sendToUser(ws.uid, { type: 'queue:waiting' });
    return;
  }

  // Match found — create a room
  const roomId = uuidv4();

  const promptResult = await pool.query(
    'SELECT id, body FROM conversation_prompts WHERE active = TRUE ORDER BY RANDOM() LIMIT 1',
  );
  const prompt = promptResult.rows[0] as { id: number; body: string } | undefined;

  await pool.query(
    'INSERT INTO calls (user_a, user_b, room_id, prompt_id) VALUES ($1, $2, $3, $4)',
    [peerId, ws.uid, roomId, prompt?.id ?? null],
  );

  // Store room → users mapping and user → room mapping in Redis
  await Promise.all([
    redis.setex(`room:${roomId}:users`, CALL_DURATION + 60, JSON.stringify([peerId, ws.uid])),
    redis.setex(`user:${peerId}:room`, CALL_DURATION + 60, roomId),
    redis.setex(`user:${ws.uid}:room`, CALL_DURATION + 60, roomId),
  ]);

  const matchPayload = {
    type: 'queue:matched',
    roomId,
    prompt: prompt?.body ?? null,
  };

  sendToUser(peerId, matchPayload);
  sendToUser(ws.uid, matchPayload);

  logger.info({ roomId, userA: peerId, userB: ws.uid }, 'Call matched');

  // Server-enforced 10-minute timer
  const timer = setTimeout(() => {
    endCall(roomId, 'timer').catch((err) => logger.error(err, 'endCall timer error'));
  }, CALL_DURATION * 1_000);

  activeTimers.set(roomId, timer);
}

export async function endCall(roomId: string, reason: string): Promise<void> {
  const timer = activeTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(roomId);
  }

  const usersJson = await redis.get(`room:${roomId}:users`);
  if (!usersJson) return;

  const [userA, userB] = JSON.parse(usersJson) as string[];

  await pool.query(
    `UPDATE calls
     SET ended_at = NOW(),
         duration_secs = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
         ended_by = $1
     WHERE room_id = $2`,
    [reason, roomId],
  );

  await redis.del(
    `room:${roomId}:users`,
    `user:${userA}:room`,
    `user:${userB}:room`,
  );

  const endPayload = { type: 'call:ended', reason };
  sendToUser(userA, endPayload);
  sendToUser(userB, endPayload);

  logger.info({ roomId, reason }, 'Call ended');
}

function isWindowOpen(timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hourPart = parts.find((p) => p.type === 'hour');
  const minutePart = parts.find((p) => p.type === 'minute');
  if (!hourPart || !minutePart) return false;
  const h = parseInt(hourPart.value, 10);
  const m = parseInt(minutePart.value, 10);
  return h === 2 && m < 50;
}
