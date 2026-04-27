import { FastifyPluginAsync } from 'fastify';
import { IDocumentFileRevision } from '@revdoku/lib';
import { IModelConfig, IReply, IPageInfoExtended, EAIImageAnalysisMode, EGridMode } from '../../schemas/common-server';
import { enrichAndRenderFilesRelatedToEnvelopeRevision } from '../../lib/document-utils';
import { ai } from '../../lib/ai';
import { friendlyAIErrorMessage, isAuthAIError } from '../../lib/ai-utils';

/**
 * POST /api/v1/file/normalize
 *
 * Rails NormalizeDocumentFileRevisionJob calls this at upload time for
 * png / jpg / pdf reference files attached to rules via `#file` markers.
 * The goal: turn an image or PDF into plain text (and rendered page
 * images) exactly the way the main /report/create pipeline does, so the
 * OCR fidelity is identical to what a normal inspection sees.
 *
 * Implementation note: everything heavy is delegated to existing helpers.
 * We wrap the single uploaded file in a minimal IDocumentFileRevision[]
 * and hand it to `enrichAndRenderFilesRelatedToEnvelopeRevision` — the
 * same call `/report/create` uses. Then `ai.extractPageTexts` runs with
 * the supplied cheap `text_extraction_model_config` (Gemini Light by
 * default). No bespoke PDF / sharp logic.
 */
interface IFileNormalizeBody {
  name: string;
  mime_type: string;
  /** Raw file data, base64-encoded. Rails sends DocumentFileRevision#file.download. */
  data: string;
  /**
   * Cheap vision model to use for extractPageTexts. Falls back to the
   * supplied model_config. The shape matches what Rails sends to
   * /report/create under the same name.
   */
  text_extraction_model_config?: IModelConfig;
  /** Only used as a fallback when text_extraction_model_config is absent. */
  model_config?: IModelConfig;
}

interface IFileNormalizeReply extends IReply {
  message?: string;
  page_texts?: Array<{ page: number; text: string }>;
  rendered_pages?: Array<{ page: number; image: string; mime_type: string; width: number; height: number }>;
}

const fileNormalizeRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: IFileNormalizeBody; Reply: IFileNormalizeReply }>(
    '/normalize',
    async (request, reply) => {
      const { name, mime_type, data, text_extraction_model_config, model_config } = request.body;

      if (!name || !mime_type || !data) {
        reply.code(400).send({ success: false, message: 'name, mime_type, and data are required' });
        return;
      }

      const modelForExtraction = text_extraction_model_config || model_config;
      if (!modelForExtraction) {
        reply.code(400).send({ success: false, message: 'text_extraction_model_config (or model_config) is required' });
        return;
      }

      // Wrap the single upload in the same IDocumentFileRevision shape
      // that /report/create uses. enrichAndRenderFilesRelatedToEnvelopeRevision
      // will detect the mime type, count pages, render, and fill `pages`
      // with IPageInfoExtended entries carrying pageAsImage /
      // pageAsImageWithGrid — exactly what ai.extractPageTexts expects.
      const wrapped: IDocumentFileRevision[] = [{
        id: 'normalize-0',
        name,
        mime_type,
        data,
        revision_number: 0,
      } as IDocumentFileRevision];

      try {
        const enriched = await enrichAndRenderFilesRelatedToEnvelopeRevision(
          wrapped,
          false,                // forcedUpdate
          undefined,            // debugFolder
          EAIImageAnalysisMode.AUTO,
          EGridMode.NONE,
          false,                // skipGrid — keep the label overlay so extractPageTexts behaves like inspection
          0,                    // aiCoordScale — irrelevant for text extraction
          0,                    // pageNumberOffset
          null,                 // requestedPages (null = all pages)
        );

        const sourcePages: IPageInfoExtended[] = enriched.flatMap(f => f.pages || []) as IPageInfoExtended[];
        if (sourcePages.length === 0) {
          reply.code(422).send({ success: false, message: 'file produced zero pages' });
          return;
        }

        const pageTexts = await ai.extractPageTexts({
          sourcePages,
          model_config: modelForExtraction,
          ai_mode: EAIImageAnalysisMode.AUTO,
        });

        const renderedPages = sourcePages.map((p, idx) => ({
          page: idx + 1,
          image: p.pageAsImage || '',
          mime_type: 'image/jpeg',
          width: Math.round((p.original_width || 0) * (p.scaling_factor || 1)),
          height: Math.round((p.original_height || 0) * (p.scaling_factor || 1)),
        }));

        reply.send({
          success: true,
          pages_processed: sourcePages.length,
          page_texts: pageTexts,
          rendered_pages: renderedPages,
        });
      } catch (err: any) {
        app.log.error({ err }, 'file/normalize failed');
        // Auth errors get HTTP 401 with the friendly "Provider rejected the
        // API key" message so Rails surfaces them verbatim instead of
        // collapsing to the generic sanitised error.
        if (isAuthAIError(err)) {
          reply.code(401).send({
            success: false,
            message: friendlyAIErrorMessage(err),
            pages_processed: 0,
          });
          return;
        }
        reply.code(500).send({
          success: false,
          message: err?.message || 'file normalization failed',
          pages_processed: 0,
        });
      }
    }
  );
};

export default fileNormalizeRoute;
