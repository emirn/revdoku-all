import { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'crypto';

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const authPlugin: FastifyPluginAsync = async (server) => {
  const secret = process.env.REVDOKU_DOC_API_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REVDOKU_DOC_API_KEY is required in production');
    }
    server.log.warn('REVDOKU_DOC_API_KEY not set — auth disabled (dev mode)');
    return;
  }

  server.addHook('onRequest', async (request, reply) => {
    // Health check is unauthenticated (Docker health-cmd uses it)
    if (request.url === '/api/v1/health') return;

    const token = request.headers['x-revdoku-doc-api-auth'];
    if (typeof token !== 'string' || !constantTimeEqual(token, secret)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
};

export default authPlugin;
