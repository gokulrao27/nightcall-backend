import { redis } from '../redis/client';
import { NightSocket, sendToUser } from './server';

export async function handleSignaling(ws: NightSocket, msg: Record<string, unknown>): Promise<void> {
  const roomId = await redis.get(`user:${ws.uid}:room`);
  if (!roomId) return;

  const usersJson = await redis.get(`room:${roomId}:users`);
  if (!usersJson) return;

  const users = JSON.parse(usersJson) as string[];
  const peerId = users.find((id) => id !== ws.uid);
  if (!peerId) return;

  // Relay SDP offer, SDP answer, or ICE candidate to peer
  sendToUser(peerId, { ...msg, from: ws.uid });
}
