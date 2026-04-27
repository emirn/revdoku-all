import { FastifyPluginAsync } from 'fastify';
import { ICheckForReindex } from '@revdoku/lib';
import { sortAndAssignCheckIndices } from '../../lib/ai';

interface IReindexBody {
  checks: ICheckForReindex[];
  reserved_check_indices?: number[];
}

interface IReindexReply {
  success: boolean;
  indices: Array<{ id: string; check_index: number }>;
}

const checksReindexPlugin: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: IReindexBody;
    Reply: IReindexReply;
  }>(
    '/reindex',
    async (request, reply) => {
      const { checks, reserved_check_indices = [] } = request.body;

      if (!Array.isArray(checks)) {
        reply.code(400).send({ success: false, indices: [] });
        return;
      }

      const indices = sortAndAssignCheckIndices(checks, reserved_check_indices);
      reply.code(200).send({ success: true, indices });
    },
  );
};

export default checksReindexPlugin;
