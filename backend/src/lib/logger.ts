import pino, { type Logger as PinoLogger } from 'pino';
import { getEnv } from '../config/env.js';

/**
 * Structured logger with secret redaction (11-security-hardening §11.9).
 *
 * Secrets are never logged. The redaction paths cover the headers and body
 * fields that carry credentials anywhere in this system.
 *
 * Construction is lazy: reading the environment at import time would throw
 * before `server.ts` can report a configuration error cleanly.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.password',
  '*.token',
  '*.service_role',
  '*.serviceRoleKey',
  'password',
  'token',
  'authorization',
  'service_role',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
];

let instance: PinoLogger | undefined;

function build(): PinoLogger {
  return pino({
    level: getEnv().LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Proxy so `import { logger }` keeps working while construction stays deferred
 * until the first log call.
 */
export const logger = new Proxy({} as PinoLogger, {
  get(_target, prop, receiver) {
    instance ??= build();
    return Reflect.get(instance, prop, receiver);
  },
}) as PinoLogger;

export type Logger = PinoLogger;
