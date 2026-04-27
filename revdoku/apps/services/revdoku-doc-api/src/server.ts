import Fastify from 'fastify';
import AutoLoad from '@fastify/autoload';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import fastifyCors from '@fastify/cors';
import elapsedTimePlugin from './plugins/elapsed-time';
import authPlugin from './plugins/auth.js';
import { PINO_REDACT_PATHS } from './lib/log-utils';

// Load the monorepo-root .env.local shared with Rails. This matches the
// production Docker single-container pattern where one env file feeds both
// services, so dev and prod read the same layout. __dirname when compiled
// sits at .../apps/services/revdoku-doc-api/build/ → four levels up is the
// repo root; in dev (tsx) it's .../src/ → still four levels up.
const __dirname_here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname_here, '../../../../.env.local') });

// Note: empty-env-key warnings are emitted by the Rails-side initializer at
// apps/web/config/initializers/01_ai_provider_keys_audit.rb against the same
// .env.local both processes share. That audit is catalog-driven via
// AiModelResolver.providers_hash so it auto-discovers new providers added
// to ai_models.yml. doc-api is intentionally stateless about the catalog
// (Rails sends model_config.api_key_env_var per-request, see lib/ai.ts) so
// duplicating the audit here would just be drift waiting to happen.

// Suppress verbose logging in production — Fastify uses pino, not console
if (process.env.NODE_ENV === 'production') {
  console.log = () => {};
  console.debug = () => {};
}

// Maximum accepted payload size for request bodies. Increase this value
// if larger documents need to be uploaded. The numbers below are derived
// from roughly 2–2.4 MB per PDF page when base64-encoded, which covers
// image-heavy scans. They include around 20% overhead for metadata.
//   10 pages  → ≈ 24MB
//   25 pages  → ≈ 60MB
//   50 pages  → ≈ 120MB
//   100 pages → ≈ 240MB
const MAX_PAYLOAD_SIZE = 120 * 1024 * 1024; // allow up to ~50 pages
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = process.env.NODE_ENV === 'development';
function buildServer() {
  const server = Fastify({
    logger: {
      level: isDev ? 'debug' : 'warn',
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      // BYOK key scrubbing for every Fastify log line. pino's built-in
      // `redact` engine replaces the listed paths with "[REDACTED]" before
      // JSON serialization — applies to req/res auto-logging, manual
      // `req.log.info(obj)` calls, and the default error trace on 4xx/5xx.
      // Keep PINO_REDACT_PATHS as the single source of truth; add new
      // sensitive fields there instead of here.
      redact: {
        paths: [...PINO_REDACT_PATHS],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: MAX_PAYLOAD_SIZE,
    connectionTimeout: 0,        // disabled — processing takes 10-300s, requestTimeout handles stuck clients
    requestTimeout: 300_000,     // 5 min — aligned with Rails RevdokuDocApiClient read_timeout
  });

  // registering time elapsed plugin to add elapsed time to the response
  // Register *before* routes
  server.register(elapsedTimePlugin);
  server.register(authPlugin);

  if (isDev) {
    // Enable CORS for development
    console.debug(`DEVELOPMENT MODE: Registering CORS headers plugin for localhost:3000`);
    server.register(fastifyCors, {
      origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ],
      methods: ['GET','POST','OPTIONS'],
      credentials: false,
    });
  }

  console.debug("Auto-loading routes");
  server.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),   // walk `routes/**`
    forceESM: true,                        // for TS ➜ ESM output
    options: { prefix: '/api/v1' }            // every route now lives under /api/*
  });

  server.get('/api/v1/health', () => ({
    status: 'ok'
  })); // top-level

  return server;
}

if (process.env.NODE_ENV !== 'test' && process.env.FASTIFY_AUTOSTART !== 'false') {
  const start = () => {
    // running server on port 4001
    const server = buildServer();
    server.listen({ port: 4001, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.debug(`Server listening at ${address}`);
    });
  };

  start();
}

export default buildServer;
