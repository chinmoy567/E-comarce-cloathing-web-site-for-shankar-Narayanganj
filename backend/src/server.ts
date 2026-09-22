import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './lib/logger.js';

/**
 * Process entry point. Environment validation happens before the port is bound,
 * so a misconfigured process never starts listening (spec 01 acceptance 3).
 */
function start(): void {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    // Names the offending variable; never prints its value.
    console.error(err instanceof Error ? err.message : 'Invalid environment configuration');
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'API listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
