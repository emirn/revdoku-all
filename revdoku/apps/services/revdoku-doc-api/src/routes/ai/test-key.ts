import { FastifyPluginAsync } from 'fastify';
import { createOpenAIClient, getModelNameForAPI } from '../../lib/ai';
import { friendlyAIErrorMessage, isAuthAIError } from '../../lib/ai-utils';
import { IModelConfig, IReply } from '../../schemas/common-server';

interface ITestKeyBody {
  model_config: IModelConfig;
}

interface ITestKeyReply extends IReply {
  served_model?: string;
  message?: string;
}

const TEST_TIMEOUT_MS = 15_000;

/**
 * POST /api/v1/ai/test-key
 *
 * User-triggered probe (called from Settings → AI's "Test" button) that
 * fires one minimum-cost AI call against the supplied model_config to
 * verify the API key + model id. Reuses the same createOpenAIClient code
 * path /report/create uses, so what the user sees here is what they'd see
 * from a real review.
 *
 * Cost: ≤1 token in/out for non-reasoning models. For o-series we set
 * max_completion_tokens=16 — reasoning tokens are charged but the call
 * itself still aborts after 15s if anything stalls.
 *
 * Auth (401/403) responds HTTP 401 with the friendly "Provider rejected
 * the API key" message; everything else responds HTTP 200 with
 * { success: false, message } so the UI gets a uniform success/failure
 * shape.
 */
const testKeyRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ITestKeyBody; Reply: ITestKeyReply }>(
    '/test-key',
    async (request, reply) => {
      const { model_config } = request.body || ({} as ITestKeyBody);

      if (!model_config || !model_config.id || !model_config.provider) {
        reply.code(400).send({
          success: false,
          message: 'model_config is required (must include id, provider, base_url, api_key_env_var)',
          pages_processed: 0,
        });
        return;
      }

      const actualModelName = getModelNameForAPI(model_config.id);
      const isOpenAIReasoning =
        model_config.provider === 'openai' && /^o[0-9]/i.test(actualModelName);

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

      try {
        const client = createOpenAIClient(model_config);

        const requestData: any = {
          model: actualModelName,
          messages: [{ role: 'user', content: 'ok' }],
        };
        // o-series rejects max_tokens; everything else accepts it (the
        // OpenAI-compat clones used by Anthropic / Gemini / LM Studio /
        // Ollama all take max_tokens). Reasoning tokens count against
        // max_completion_tokens so we leave a small headroom.
        if (isOpenAIReasoning) {
          requestData.max_completion_tokens = 16;
        } else {
          requestData.max_tokens = 1;
        }

        console.log(
          `[AI][TestKey] Calling model="${actualModelName}" at baseURL="${model_config.base_url}" (provider: ${model_config.provider})`,
        );

        const response = await client.chat.completions.create(requestData, {
          signal: controller.signal,
        });

        reply.code(200).send({
          success: true,
          pages_processed: 0,
          served_model: response.model || actualModelName,
        });
      } catch (err: any) {
        const aborted = err?.name === 'AbortError' || controller.signal.aborted;
        if (aborted) {
          reply.code(200).send({
            success: false,
            pages_processed: 0,
            message: `Test timed out after ${TEST_TIMEOUT_MS / 1000}s. The endpoint may be unreachable or unresponsive.`,
          });
          return;
        }

        const message = friendlyAIErrorMessage(err);
        // Match the rest of the AI routes: auth failures get HTTP 401 so
        // Rails surfaces them verbatim. Other failures stay HTTP 200 with
        // success: false so the UI's normal { ok, message } handling works.
        if (isAuthAIError(err)) {
          reply.code(401).send({
            success: false,
            pages_processed: 0,
            message,
          });
          return;
        }
        reply.code(200).send({
          success: false,
          pages_processed: 0,
          message,
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  );
};

export default testKeyRoute;
