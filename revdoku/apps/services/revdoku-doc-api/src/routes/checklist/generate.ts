import { FastifyPluginAsync } from 'fastify';
import { ai } from '../../lib/ai';
import {
  IChecklist,
  IRule,
} from '@revdoku/lib';

import { IReply, IModelConfig } from '../../schemas/common-server';
import { withAIRetry, friendlyAIErrorMessage, isTransientAIError, isAuthAIError } from '../../lib/ai-utils';
import { scanAndLogInjectionAttempts } from '../../lib/prompt-guard';

interface IChecklistGenerateBody {
  text: string;
  system_prompt?: string;      // Existing checklist context
  existing_rules?: IRule[];    // Rules to avoid duplicating
  checklist_name?: string;     // Topic context
  model_config: IModelConfig;  // Required — model configuration sent by Rails per-request
}

interface IChecklistGenerateSuccess extends IReply {
  checklist: IChecklist; 
}

interface IChecklistGenerateError extends IReply{
  success: false;
  message: string;
}

type IChecklistGenerateReply = IChecklistGenerateSuccess | IChecklistGenerateError;

/* ────────────────────────────────────────────────────────────────
   Route plugin
   ──────────────────────────────────────────────────────────────── */

const checklistGeneratePlugin: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: IChecklistGenerateBody;
    Reply: IChecklistGenerateReply;
  }>(
    '/generate',
    {
      /* Validate content-type before we hit the handler */
      preValidation: async (request, reply) => {
        if (request.headers['content-type'] !== 'application/json') {
          reply.code(415);
          throw new Error('Must be application/json');
        }
      },
    },
    async (request, reply) => {
      try {
        /* 1️⃣  Extract and sanity-check body */
        const {
          text,
          system_prompt,
          existing_rules,
          checklist_name,
          model_config
        } = request.body;

        if (!text) {
          reply.code(400).send({
            success: false,
            message: 'Non-empty text is required!',
            pages_processed: 0
          });
          return;
        }

        // Scan user inputs for injection patterns (log only)
        scanAndLogInjectionAttempts({
          text,
          system_prompt,
          checklist_name,
          ...(existing_rules ? Object.fromEntries(existing_rules.map((r, i) => [`rule_${i}`, r.prompt])) : {}),
        }, 'checklist/generate');

        if (!model_config || !model_config.id || !model_config.provider) {
          reply.code(400).send({
            success: false,
            message: 'model_config is required (must include id, provider, base_url, api_key_env_var, temperature, options)',
            pages_processed: 0
          });
          return;
        }

        // Process the checklist using the AI service
        // Pass context parameters if provided (for adding rules to existing checklists)
        const result: IChecklist = await withAIRetry(
          () => ai.getChecksFromText({
            source_text: text,
            system_prompt,
            existing_rules,
            checklist_name,
            model_config
          }),
          'checklist/generate'
        );

        /* 4️⃣  All good — send the report */
        reply.code(200).send({
          success: true,
          checklist: result,
          pages_processed: 1
        });
      } catch (err: any) {
        /* 5️⃣  Unhandled exception */
        const errMsg = friendlyAIErrorMessage(err);
        // Auth errors (401/403) get their own status so Rails surfaces them
        // verbatim instead of running them through sanitize_error_for_user.
        const statusCode = isAuthAIError(err) ? 401 : (isTransientAIError(err) ? 503 : 500);
        reply.code(statusCode).send({
          success: false,
          message: isAuthAIError(err) ? errMsg : `Server error during checklist generation: ${errMsg}`,
          pages_processed: 0
        });
      }
    },
  );
};

export default checklistGeneratePlugin;
