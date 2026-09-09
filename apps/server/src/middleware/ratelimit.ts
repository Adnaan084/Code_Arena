/** Rate limiting per IP / token, keyed by route. */
import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

export const joinLimiter = rateLimit({
  windowMs: 60_000,
  max: isTest ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many join attempts. Please wait a minute.' } },
});

export const actionLimiter = rateLimit({
  windowMs: 10_000,
  max: isTest ? 10_000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: isTest ? 10_000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'API rate limit exceeded.' } },
});