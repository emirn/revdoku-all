import { FastifyPluginAsync } from 'fastify';
import { IReply } from '../../schemas/common-server';

interface IModelsListSuccess extends IReply {
  success: true;
  models: Array<{ id: string; name: string }>;
}

type IModelsListReply = IModelsListSuccess;

/* ────────────────────────────────────────────────────────────────
   Route plugin - GET /api/v1/models
   DEPRECATED: Rails is now the single source of truth for AI models.
   This endpoint returns an empty list. Frontend fetches from Rails directly.
   ──────────────────────────────────────────────────────────────── */

const modelsListPlugin: FastifyPluginAsync = async (app) => {
  app.get<{
    Reply: IModelsListReply;
  }>(
    '/',
    async (_request, reply) => {
      reply.code(200).send({
        success: true,
        models: [],
        pages_processed: 0,
      });
    }
  );
};

export default modelsListPlugin;
