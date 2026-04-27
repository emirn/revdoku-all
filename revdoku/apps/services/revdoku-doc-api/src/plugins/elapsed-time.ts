// plugins/elapsed-time.ts
import { FastifyPluginAsync } from 'fastify';

const elapsedTimePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.log.info('PLUGIN: Registering elapsed-time plugin');

  // Hook to capture start time when request begins
  fastify.addHook('onRequest', (request, reply) => {
    request.startTime = Date.now();
  });

  fastify.addHook('preSerialization', (request, reply, payload) => {
    fastify.log.info('PLUGIN: preSerialization hook firing');

    if (payload !== null && typeof payload === 'object') {
      const elapsedMs = Date.now() - (request.startTime || Date.now());
      reply.header('X-Response-Time', `${elapsedMs}`);
      (payload as any).elapsed_time = elapsedMs;
      return payload;
    }

    return payload;
  });
};

// Extend FastifyRequest interface to include startTime
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}

export default elapsedTimePlugin;
