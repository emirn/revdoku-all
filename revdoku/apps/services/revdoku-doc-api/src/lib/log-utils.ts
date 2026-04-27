// Log / dump redaction for BYOK-sensitive fields.
//
// When Rails sends a model_config with `api_key` (BYOK), the key flows through
// doc-api on every AI call. Several log surfaces can accidentally capture it:
//   1. Fastify request log — pino serialises the body when log level is debug
//      OR when the reply is 4xx/5xx (built-in error trace).
//   2. Provider-SDK errors — OpenAI's APIError surfaces request headers
//      (including the Authorization header) on its .headers field.
//
// `redactSensitive` takes any object and returns a deep-cloned copy where all
// sensitive fields are replaced with "[REDACTED]". Used at every log site.
// No dependency on lodash — plain recursive clone.

const SENSITIVE_KEYS = new Set<string>([
  "api_key",
  "apikey",
  "apiKey",
  "authorization",
  "Authorization",
  "x-api-key",
  "X-Api-Key",
  "base_url",
  "baseUrl",
  "baseURL",
]);

const REDACTED = "[REDACTED]";

export function redactSensitive<T>(value: T): T {
  return _redact(value, new WeakSet<object>()) as T;
}

function _redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  // Avoid cycles (rare in JSON but possible in Error.cause chains).
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => _redact(v, seen));
  }

  // Preserve known prototypes that we shouldn't deep-clone into a plain object
  // (Buffer, Uint8Array, Date, RegExp, etc. pass through unchanged).
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array
  ) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = _redact((value as Record<string, unknown>)[key], seen);
    }
  }
  return out;
}

// Fastify/pino `logger.redact` uses a path-based API rather than a key-matcher.
// These are the known paths where BYOK material can reach the request logger.
// Additions go here when new callsites are added (e.g. a new route that accepts
// a model_config).
export const PINO_REDACT_PATHS: readonly string[] = [
  // POST /api/v1/report/create, /api/v1/report/export, etc. — model_config
  "req.body.model_config.api_key",
  "req.body.model_config.base_url",
  "req.body.text_extraction_model_config.api_key",
  "req.body.text_extraction_model_config.base_url",
  // BYOK validate endpoint (PR 3)
  "req.body.api_key",
  "req.body.base_url",
  // Inbound headers when the SDK surfaces a request back into an error trace
  "req.headers.authorization",
  'req.headers["x-api-key"]',
  // Response body doesn't carry keys in happy-path, but surface errors sometimes
  // do via provider SDK re-raise.
  "err.headers.authorization",
  'err.headers["x-api-key"]',
];
