import rateLimit from 'express-rate-limit';

export const callRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many call attempts — slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const wallRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many wall posts — wait a while' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
