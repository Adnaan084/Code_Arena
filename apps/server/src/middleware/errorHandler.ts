/** Central error handler → { error: { code, message, details? } } with HTTP status. */
import { Request, Response, NextFunction } from 'express';
import { AppError, isAppError } from '../lib/errors';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isAppError(err)) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}