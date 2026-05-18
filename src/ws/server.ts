import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../logger';
import { handleSignaling } from './signaling';
import { handleMatchmaking, endCall } from './matchmaking';
import { redis } from '../redis/client';

export interface NightSocket extends WebSocket {
  uid: string;
  roomId?: string;
  isAlive: boolean;
}

// Global registry: uid → socket
export const sockets = new Map<string, NightSocket>();

export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat — detect dead connections every 30 s
  const interval = setInterval(() => {
    wss.clients.forEach((rawWs) => {
      const ws = rawWs as NightSocket;
      if (!ws.isAlive) {
        if (ws.uid) sockets.delete(ws.uid);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (rawWs, req) => {
    const ws = rawWs as NightSocket;
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Authenticate via token in query string
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'No token');
      return;
    }

    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as { uid: string };
      ws.uid = payload.uid;
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    sockets.set(ws.uid, ws);
    logger.debug({ uid: ws.uid }, 'WebSocket connected');

    ws.on('message', (raw) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      switch (msg.type) {
        case 'queue:join':
          handleMatchmaking(ws, 'join').catch((err) => logger.error(err, 'matchmaking error'));
          break;
        case 'queue:leave':
          handleMatchmaking(ws, 'leave').catch((err) => logger.error(err, 'matchmaking error'));
          break;
        case 'queue:pass':
          handleMatchmaking(ws, 'pass').catch((err) => logger.error(err, 'matchmaking error'));
          break;
        case 'sdp:offer':
        case 'sdp:answer':
        case 'ice':
          handleSignaling(ws, msg).catch((err) => logger.error(err, 'signaling error'));
          break;
        default:
          logger.warn({ type: msg.type }, 'Unknown WS message type');
      }
    });

    ws.on('close', () => {
      sockets.delete(ws.uid);
      // End any active call this user was in so the peer isn't stranded
      redis.get(`user:${ws.uid}:room`).then((roomId) => {
        if (roomId) endCall(roomId, 'system').catch((err) => logger.error(err, 'room cleanup on disconnect error'));
      }).catch((err) => logger.error(err, 'redis lookup on disconnect error'));
      handleMatchmaking(ws, 'leave').catch((err) => logger.error(err, 'cleanup error'));
      logger.debug({ uid: ws.uid }, 'WebSocket disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ uid: ws.uid, err }, 'WebSocket error');
    });
  });

  logger.info('WebSocket server ready at /ws');
}

export function sendToUser(uid: string, msg: object): void {
  const ws = sockets.get(uid);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
