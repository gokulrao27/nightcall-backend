import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  uid: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { uid: string };
    (req as AuthRequest).uid = payload.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
