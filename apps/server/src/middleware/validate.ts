/**
 * Zod validation middleware.
 * On failure the wrapped schema's ZodError flows to the central error handler,
 * which renders the single standardized shape:
 *   { error: { code: 'VALIDATION_ERROR', message, details } }
 * On success, req.body is replaced with the parsed/transformed data so
 * downstream handlers always receive typed input.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(result.error); // ZodError → centralized errorHandler
    }
    req.body = result.data as T;
    next();
  };
}