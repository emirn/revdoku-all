import React, { useMemo } from "react";
import type { IChecklist, IReport, IEnvelope, IEnvelopeRevision, IDocumentFileRevision } from "@revdoku/lib";
import { getModelDisplayName, getModelConfig } from "@/lib/ai-model-utils";
import { Copy } from "lucide-react";
import { showToast } from "@/lib/toast";
import { computePageDiffs } from "@/lib/diff-utils";

interface DebugPanelProps {
  currentChecklist: IChecklist | null;
  currentEnvelope: IEnvelope | null;
  currentEnvelopeRevision: IEnvelopeRevision | null;
  currentReport: IReport | null;
  previousReport: IReport | null;
  inspectionReportChecklist: IChecklist | null;
  isReadOnlyRevision: boolean;
  debugInfoData: string | null;
  revdokuDocApiElapsedMs: number | null;
}

function DebugImage({ base64, index }: { base64: string; index: number }) {
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const dataSize = Math.round(base64.length * 3 / 4 / 1024); // approx KB

  return (
    <div className="mb-4">
      <h5 className="text-sm font-medium text-yellow-700 mb-1">
        Page {index + 1}
        {dims && <span className="font-normal ml-2">({dims.w}x{dims.h}px, ~{dataSize}KB)</span>}
      </h5>
      <img
        src={`data:image/png;base64,${base64}`}
        alt={`Debug Page ${index + 1}`}
        className="border border-border rounded-lg shadow-sm max-w-full"
        onLoad={(e) => {
          const img = e.currentTarget;
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
    </div>
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => showToast("Copied to clipboard", "success"),
    () => showToast("Failed to copy", "error"),
  );
}

function CopyButton({ getText, className = "" }: { getText: () => string; className?: string }) {
  return (
    <button
      type="button"
      className={`p-1 rounded hover:bg-yellow-200 text-yellow-600 hover:text-yellow-800 transition-colors ${className}`}
      title="Copy to clipboard"
      onClick={(e) => {
        e.stopPropagation();
        copyToClipboard(getText());
      }}
    >
      <Copy size={14} />
    </button>
  );
}

function formatAllDebugData(props: DebugPanelProps): string {
  const { currentChecklist, currentEnvelope, currentEnvelopeRevision, currentReport, inspectionReportChecklist, isReadOnlyRevision, debugInfoData, revdokuDocApiElapsedMs } = props;
  const sections: string[] = [];

  sections.push("=== Debug Information ===\n");

  if (currentChecklist) {
    sections.push("--- Current Checklist ---");
    sections.push(JSON.stringify(currentChecklist, null, 2));
    sections.push("");
  }

  if (currentEnvelope) {
    sections.push("--- Envelope Status ---");
    sections.push(`External ID: ${currentEnvelope.id}`);
    sections.push(`Total Revisions: ${currentEnvelope.envelope_revisions?.length || 0}`);
    sections.push(`Current Revision Index: ${currentEnvelope.current_revision_index}`);
    sections.push(`Current Revision Number: ${currentEnvelopeRevision?.revision_number || 'N/A'}`);
    sections.push(`Is Read-Only: ${isReadOnlyRevision ? 'Yes' : 'No'}`);
    sections.push("");
  }

  if (currentReport) {
    sections.push("--- Review Report ---");
    sections.push(`Total Checks: ${currentReport.checks.length}`);
    sections.push(`Passed: ${currentReport.checks.filter(c => c.passed).length}`);
    sections.push(`Failed: ${currentReport.checks.filter(c => !c.passed).length}`);

    const modelConfig = getModelConfig(currentReport.ai_model);
    if (modelConfig) {
      sections.push("");
      sections.push("AI Model Config:");
      sections.push(`  id: ${modelConfig.id}`);
      sections.push(`  name: ${modelConfig.name}`);
      sections.push(`  provider: ${modelConfig.provider ?? 'N/A'}`);
      sections.push(`  grid_mode: ${modelConfig.grid_mode ?? 'N/A'}`);
      sections.push(`  ai_coord_scale: ${modelConfig.ai_coord_scale ?? 'N/A'}`);
      sections.push(`  max_tokens: ${modelConfig.max_tokens ?? 'N/A'}`);
      sections.push(`  temperature: ${modelConfig.temperature ?? 'N/A'}`);
      sections.push(`  response_format: ${modelConfig.response_format ?? 'N/A'}`);
      sections.push(`  credits_per_page: ${modelConfig.credits_per_page ?? 'N/A'}`);
      sections.push(`  hipaa: ${modelConfig.hipaa ?? false}`);
    }
    sections.push("");

    if (currentReport.page_texts && currentReport.page_texts.length > 0) {
      sections.push("--- Extracted Page Texts ---");
      currentReport.page_texts.forEach(pt => {
        sections.push(`--- Page ${pt.page} ---`);
        sections.push(pt.text);
        sections.push("");
      });
    } else {
      sections.push("--- Extracted Page Texts ---");
      sections.push("No page_texts in report (field missing or empty)");
      sections.push("");
    }

    const failedChecks = currentReport.checks.filter(c => !c.passed);
    const passedChecks = currentReport.checks.filter(c => c.passed);

    if (failedChecks.length > 0) {
      sections.push("--- Failed Checks ---");
      sections.push(JSON.stringify(failedChecks, null, 2));
      sections.push("");
    }
    if (passedChecks.length > 0) {
      sections.push("--- Passed Checks ---");
      sections.push(JSON.stringify(passedChecks, null, 2));
      sections.push("");
    }
  }

  if (debugInfoData && currentReport) {
    let debugData: any;
    try { debugData = JSON.parse(debugInfoData); } catch { debugData = null; }
    if (!debugData) { sections.push("--- Debug info is not valid JSON ---"); }
    const pagesInfo = debugData?.pages_info || [];
    if (pagesInfo.length > 0) {
      sections.push("--- Pages Info ---");
      pagesInfo.forEach((p: any) => {
        sections.push(`Page ${p.page_index + 1}: ${p.width}x${p.height} (original: ${p.original_width}x${p.original_height}), scale: ${p.scaling_factor?.toFixed(2)}, ${p.content_boxes_count} content boxes`);
      });
      sections.push("");
    }
    if (debugData.checks_with_positions?.length > 0) {
      const enriched = debugData.checks_with_positions;
      const failedPos = enriched.filter((c: any) => !c.passed);
      const passedPos = enriched.filter((c: any) => c.passed);
      if (failedPos.length > 0) {
        sections.push("--- Failed Checks with Positions ---");
        sections.push(JSON.stringify(failedPos, null, 2));
        sections.push("");
      }
      if (passedPos.length > 0) {
        sections.push("--- Passed Checks with Positions ---");
        sections.push(JSON.stringify(passedPos, null, 2));
        sections.push("");
      }
    }
  }

  if (revdokuDocApiElapsedMs != null) {
    sections.push(`doc-api processing time: ${(revdokuDocApiElapsedMs / 1000).toFixed(2)}s (${revdokuDocApiElapsedMs}ms)`);
  }

  return sections.join("\n");
}

export default function DebugPanel({
  currentChecklist,
  currentEnvelope,
  currentEnvelopeRevision,
  currentReport,
  previousReport,
  inspectionReportChecklist,
  isReadOnlyRevision,
  debugInfoData,
  revdokuDocApiElapsedMs,
}: DebugPanelProps) {
  const pageDiffs = useMemo(() => {
    if (currentReport?.page_texts?.length && previousReport?.page_texts?.length) {
      return computePageDiffs(previousReport.page_texts!, currentReport.page_texts!);
    }
    return null;
  }, [currentReport?.page_texts, previousReport?.page_texts]);

  return (
    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <CopyButton getText={() => formatAllDebugData({ currentChecklist, currentEnvelope, currentEnvelopeRevision, currentReport, previousReport, inspectionReportChecklist, isReadOnlyRevision, debugInfoData, revdokuDocApiElapsedMs })} />
        <h3 className="text-lg font-semibold text-yellow-800">Debug Information</h3>
      </div>

      {/* checklist and checks */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <CopyButton getText={() => JSON.stringify(currentChecklist, null, 2)} />
          <h4 className="text-md font-medium text-yellow-700">Current Checklist:</h4>
        </div>
        <div className="text-sm text-yellow-700 space-y-1">
          <pre>{JSON.stringify(currentChecklist, null, 2)}</pre>
        </div>
      </div>

      {/* Envelope Information */}
      <div className="mb-4">
        <h4 className="text-md font-medium text-yellow-700 mb-2">Envelope Status:</h4>
        {currentEnvelope ? (
          <div className="text-sm text-yellow-700 space-y-1">
            <div><strong>External ID:</strong> {currentEnvelope.id}</div>
            {currentEnvelope.created_at && <div><strong>Created:</strong> {new Date(currentEnvelope.created_at).toLocaleString()}</div>}
            {currentEnvelope.updated_at && <div><strong>Updated:</strong> {new Date(currentEnvelope.updated_at).toLocaleString()}</div>}
            <div><strong>Total Revisions:</strong> {currentEnvelope.envelope_revisions?.length || 0}</div>
            <div><strong>Current Revision Index:</strong> {currentEnvelope.current_revision_index}</div>
            <div><strong>Current Revision Number:</strong> {currentEnvelopeRevision?.revision_number || 'N/A'}</div>
            <div><strong>Is Read-Only Revision:</strong> {isReadOnlyRevision ? 'Yes' : 'No'}</div>
            <div className="mt-2 p-2 bg-card rounded border border-border">
              <strong>Revision Toolbar Visibility Check:</strong>
              <div className="ml-2">
                <div>• currentEnvelope exists: {currentEnvelope ? '✅' : '❌'}</div>
                <div>• revisions.length &gt; 1: {currentEnvelope.envelope_revisions?.length > 1 ? '✅' : '❌'} (currently {currentEnvelope.envelope_revisions?.length || 0})</div>
                <div>• Should show toolbar: {(currentEnvelope && currentEnvelope.envelope_revisions && currentEnvelope.envelope_revisions.length > 1) ? '✅ YES' : '❌ NO'}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-yellow-700">No envelope exists
            <div className="mt-2 p-2 bg-card rounded border border-border">
              <strong>Revision Toolbar Visibility Check:</strong>
              <div className="ml-2">
                <div>• currentEnvelope exists: ❌</div>
                <div>• Should show toolbar: ❌ NO</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Revisions List */}
      {currentEnvelope && currentEnvelope.envelope_revisions && currentEnvelope.envelope_revisions.length > 0 && (
        <div className="mb-4">
          <h4 className="text-md font-medium text-yellow-700 mb-2">Revisions:</h4>
          <div className="text-sm text-yellow-700 space-y-2">
            {currentEnvelope.envelope_revisions?.map((revision, index) => (
              <div key={revision.id} className={`p-2 border rounded ${index === currentEnvelope.current_revision_index ? 'bg-yellow-100 dark:bg-yellow-900/50 border-yellow-400' : 'bg-card border-yellow-200 dark:border-yellow-800'}`}>
                <div><strong>Rev #{revision.revision_number}</strong> {index === currentEnvelope.current_revision_index && <span className="text-xs bg-yellow-300 px-1 rounded">(CURRENT)</span>}</div>
                <div><strong>External ID:</strong> {revision.id}</div>
                {revision.created_at && <div><strong>Created:</strong> {new Date(revision.created_at).toLocaleString()}</div>}
                <div><strong>Comment:</strong> {revision.comment || 'No comment'}</div>
                <div><strong>Files:</strong> {revision?.document_file_revision_links?.length || 0}</div>
                <div><strong>Report Checks:</strong> {revision.report?.checks?.length || 0}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source Document Information */}
      <div className="mb-4">
        <h4 className="text-md font-medium text-yellow-700 mb-2">Source Document:</h4>
        {currentEnvelopeRevision ? (
          <div className="text-sm text-yellow-700 space-y-1">
            <div><strong>File Links Count:</strong> {currentEnvelopeRevision.document_file_revision_links?.length || 0}</div>
            {currentEnvelopeRevision.document_file_revision_links?.map((link, index) => {
              const file = currentEnvelope?.document_files.find(f => f.id === link.document_file_id);
              const revision: IDocumentFileRevision | undefined = file?.document_file_revisions.find(r => r.revision_number === link.revision_number);
              return (
                <div key={index} className="ml-4">
                  <div><strong>Link {index + 1}:</strong> File ID: {link.document_file_id}, Revision: {link.revision_number}</div>
                  {revision && (
                    <div className="ml-4">
                      <div><strong>Name:</strong> {revision.name}</div>
                      <div><strong>Type:</strong> {revision.mime_type}</div>
                      <div><strong>Pages:</strong> {revision.pages?.length || 0}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-yellow-700">No source document</div>
        )}
      </div>

      {/* Inspection Report Information */}
      {currentReport && (
        <div className="mb-4">
          <h4 className="text-md font-medium text-yellow-700 mb-2">Review Report:</h4>
          <div className="text-sm text-yellow-700 space-y-1">
            {currentReport.created_at && <div><strong>Created:</strong> {new Date(currentReport.created_at).toLocaleString()}</div>}
            {currentReport.updated_at && <div><strong>Updated:</strong> {new Date(currentReport.updated_at).toLocaleString()}</div>}
            <div><strong>Checklist:</strong> {inspectionReportChecklist?.name || 'N/A'}</div>
            <div><strong>Total Checks:</strong> {currentReport.checks.length}</div>
            <div><strong>Passed Checks:</strong> {currentReport.checks.filter(c => c.passed).length}</div>
            <div><strong>Failed Checks:</strong> {currentReport.checks.filter(c => !c.passed).length}</div>
          </div>
          {/* AI Model & Checklist Details */}
          <div className="mt-2 text-sm text-yellow-700 space-y-1 border-t border-yellow-300 pt-2">
            {/* Full AI Model Config */}
            {(() => {
              const modelConfig = getModelConfig(currentReport.ai_model);
              if (modelConfig) {
                return (
                  <div className="mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <CopyButton getText={() => `id: ${modelConfig.id}\nname: ${modelConfig.name}\nprovider: ${modelConfig.provider ?? 'N/A'}\ngrid_mode: ${modelConfig.grid_mode ?? 'N/A'}\nai_coord_scale: ${modelConfig.ai_coord_scale ?? 'N/A'}\nmax_tokens: ${modelConfig.max_tokens ?? 'N/A'}\ntemperature: ${modelConfig.temperature ?? 'N/A'}\nresponse_format: ${modelConfig.response_format ?? 'N/A'}\ncredits_per_page: ${modelConfig.credits_per_page ?? 'N/A'}\nhipaa: ${modelConfig.hipaa ?? false}`} />
                      <div className="font-medium">AI Model Config:</div>
                    </div>
                    <pre className="text-xs text-yellow-600 bg-yellow-100 p-2 rounded ml-2">
{`id: ${modelConfig.id}
name: ${modelConfig.name}
provider: ${modelConfig.provider ?? 'N/A'}
grid_mode: ${modelConfig.grid_mode ?? 'N/A'}
ai_coord_scale: ${modelConfig.ai_coord_scale ?? 'N/A'}
max_tokens: ${modelConfig.max_tokens ?? 'N/A'}
temperature: ${modelConfig.temperature ?? 'N/A'}
response_format: ${modelConfig.response_format ?? 'N/A'}
credits_per_page: ${modelConfig.credits_per_page ?? 'N/A'}
hipaa: ${modelConfig.hipaa ?? false}`}
                    </pre>
                  </div>
                );
              }
              return <div><strong>AI Model:</strong> {currentReport.ai_model || 'N/A'}</div>;
            })()}
            {inspectionReportChecklist?.ai_model && (
              <div><strong>Checklist Model:</strong> {inspectionReportChecklist.ai_model} ({getModelDisplayName(inspectionReportChecklist.ai_model)})</div>
            )}
            {inspectionReportChecklist?.ai_model && currentReport.ai_model &&
              inspectionReportChecklist.ai_model !== currentReport.ai_model && (
                <div className="text-orange-600 font-medium">
                  Note: Checklist model ({inspectionReportChecklist.ai_model}) differs from report model ({currentReport.ai_model})
                </div>
              )}
            <div><strong>Checklist ID:</strong> {currentReport.checklist_id || 'N/A'}</div>
            <div><strong>Checklist Type:</strong> {inspectionReportChecklist?.checklist_type || 'N/A'}</div>
            <div><strong>Checklist Revision:</strong> {currentReport.checklist_revision_number ?? 'N/A'}</div>
            {inspectionReportChecklist?.source_checklist_id && (
              <div><strong>Source Checklist ID:</strong> {inspectionReportChecklist.source_checklist_id}</div>
            )}
            {inspectionReportChecklist?.rules && (() => {
              const total = inspectionReportChecklist.rules.length;
              const checklistRules = inspectionReportChecklist.rules.filter((r: any) => r.origin === 'checklist' || !r.origin).length;
              const userRules = inspectionReportChecklist.rules.filter((r: any) => r.origin === 'user').length;
              return (
                <div><strong>Rules:</strong> {total} total ({checklistRules} checklist, {userRules} user)</div>
              );
            })()}
          </div>
        </div>
      )}

      {/* pages_layout_json (page_coordinate_spaces, content_bounding_boxes, etc.) */}
      {currentReport && (currentReport as any)?.pages_layout_json && (
        <div className="mb-4">
          <details>
            <summary className="text-md font-medium text-yellow-700 mb-2 cursor-pointer hover:text-yellow-800 flex items-center gap-2">
              <CopyButton getText={() => {
                const raw = (currentReport as any).pages_layout_json;
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return JSON.stringify(parsed, null, 2);
              }} />
              <span>pages_layout_json</span>
            </summary>
            <pre className="text-xs text-yellow-600 bg-yellow-100 p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(
                typeof (currentReport as any).pages_layout_json === 'string'
                  ? JSON.parse((currentReport as any).pages_layout_json)
                  : (currentReport as any).pages_layout_json,
                null, 2
              )}
            </pre>
          </details>
        </div>
      )}

      {/* Extracted Page Texts */}
      {currentReport && (
        <div className="mb-4">
          {currentReport.page_texts && currentReport.page_texts.length > 0 ? (
            <details>
              <summary className="text-md font-medium text-yellow-700 mb-2 cursor-pointer hover:text-yellow-800 flex items-center gap-2">
                <CopyButton getText={() => currentReport.page_texts!.map(pt => `--- Page ${pt.page} ---\n${pt.text}`).join("\n\n")} />
                <span>Extracted Page Texts ({currentReport.page_texts.length} pages)</span>
              </summary>
              <div className="space-y-2">
                {currentReport.page_texts.map((pt, i) => (
                  <div key={i}>
                    <div className="text-sm font-medium text-yellow-700">Page {pt.page}</div>
                    <pre className="text-xs text-yellow-600 bg-yellow-100 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">{pt.text}</pre>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <div className="text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded p-2">
              <strong>Warning:</strong> No extracted page texts (page_texts) in this report. Change detection across revisions will not work without page texts. This field is populated during inspection by AI text extraction.
            </div>
          )}
        </div>
      )}

      {/* Page Diffs (computed from page_texts) */}
      {pageDiffs && pageDiffs.some(d => d.has_changes) && (
        <div className="mb-3">
          <details>
            <summary className="text-md font-medium text-blue-700 mb-2 cursor-pointer hover:text-blue-800">
              Page Diffs ({pageDiffs.filter(d => d.has_changes).length} changed)
            </summary>
            <div className="space-y-2">
              {pageDiffs.map(pd => (
                <details key={pd.page} open={pd.has_changes}>
                  <summary className={`text-sm font-medium cursor-pointer px-2 py-1 rounded ${
                    pd.has_changes ? "text-orange-700 bg-orange-50" : "text-gray-500"
                  }`}>
                    Page {pd.page} {!pd.has_changes && "(no changes)"}
                  </summary>
                  {pd.has_changes && (
                    <pre className="text-xs mt-1 p-2 bg-gray-50 rounded overflow-auto max-h-48 whitespace-pre-wrap">{pd.diff}</pre>
                  )}
                </details>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Full Check Details — Failed */}
      {currentReport && currentReport.checks.length > 0 && (() => {
        const failedChecks = currentReport.checks.filter(c => !c.passed);
        const passedChecks = currentReport.checks.filter(c => c.passed);
        return (
          <>
            {failedChecks.length > 0 && (
              <div className="mb-3">
                <details>
                  <summary className="text-md font-medium text-red-700 mb-2 cursor-pointer hover:text-red-800 flex items-center gap-2">
                    <CopyButton getText={() => JSON.stringify(failedChecks, null, 2)} />
                    <span>Failed Checks ({failedChecks.length})</span>
                  </summary>
                  <pre className="text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto max-h-96">
                    {JSON.stringify(failedChecks, null, 2)}
                  </pre>
                </details>
              </div>
            )}
            {passedChecks.length > 0 && (
              <div className="mb-3">
                <details>
                  <summary className="text-md font-medium text-green-700 mb-2 cursor-pointer hover:text-green-800 flex items-center gap-2">
                    <CopyButton getText={() => JSON.stringify(passedChecks, null, 2)} />
                    <span>Passed Checks ({passedChecks.length})</span>
                  </summary>
                  <pre className="text-xs text-green-600 bg-green-50 p-2 rounded overflow-auto max-h-96">
                    {JSON.stringify(passedChecks, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </>
        );
      })()}

      {/* Document Pages Debug Images */}
      {currentReport && debugInfoData && (
        (() => {
          let debugData: any;
          try {
            debugData = JSON.parse(debugInfoData);
          } catch {
            return <div className="mb-4 text-sm text-muted-foreground">Debug info is not valid JSON.</div>;
          }
          const overlayImages = debugData.debug_overlay_images || debugData.pagesAsImagesWithGrid || [];
          const pagesInfo = debugData.pages_info || [];
          return (
            <div className="mb-4">
              {/* Pages Info Summary */}
              {pagesInfo.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CopyButton getText={() => pagesInfo.map((p: any) => `Page ${p.page_index + 1}: ${p.width}x${p.height} (original: ${p.original_width}x${p.original_height}), scale: ${p.scaling_factor?.toFixed(2)}, ${p.content_boxes_count} content boxes`).join("\n")} />
                    <h4 className="text-md font-medium text-yellow-700">
                      Debug: Pages Info (content box detection)
                    </h4>
                  </div>
                  <div className="text-xs text-yellow-600 space-y-1 bg-yellow-100 p-2 rounded">
                    {pagesInfo.map((p: any, i: number) => (
                      <div key={i}>
                        Page {p.page_index + 1}: {p.width}x{p.height} (original: {p.original_width}x{p.original_height}),
                        scale: {p.scaling_factor?.toFixed(2)},
                        <strong> {p.content_boxes_count} content boxes</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Checks with Positions JSON — split by passed/failed */}
              {debugData.checks_with_positions && debugData.checks_with_positions.length > 0 && (() => {
                const enriched = debugData.checks_with_positions;
                const failedPos = enriched.filter((c: any) => !c.passed);
                const passedPos = enriched.filter((c: any) => c.passed);
                return (
                  <>
                    {failedPos.length > 0 && (
                      <div className="mb-3">
                        <details>
                          <summary className="text-md font-medium text-red-700 mb-2 cursor-pointer hover:text-red-800 flex items-center gap-2">
                            <CopyButton getText={() => JSON.stringify(failedPos, null, 2)} />
                            <span>Debug: Failed Checks with Positions ({failedPos.length})</span>
                          </summary>
                          <pre className="text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto max-h-96">
                            {JSON.stringify(failedPos, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                    {passedPos.length > 0 && (
                      <div className="mb-3">
                        <details>
                          <summary className="text-md font-medium text-green-700 mb-2 cursor-pointer hover:text-green-800 flex items-center gap-2">
                            <CopyButton getText={() => JSON.stringify(passedPos, null, 2)} />
                            <span>Debug: Passed Checks with Positions ({passedPos.length})</span>
                          </summary>
                          <pre className="text-xs text-green-600 bg-green-50 p-2 rounded overflow-auto max-h-96">
                            {JSON.stringify(passedPos, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </>
                );
              })()}
              {/* doc-api elapsed time */}
              {revdokuDocApiElapsedMs != null && (
                <div className="mb-3 text-sm text-yellow-700">
                  <strong>doc-api processing time:</strong> {(revdokuDocApiElapsedMs / 1000).toFixed(2)}s ({revdokuDocApiElapsedMs}ms)
                </div>
              )}
              {/* Grid Overlay Images */}
              {overlayImages.length > 0 && (
                <>
                  <h4 className="text-md font-medium text-yellow-700 mb-2">
                    Debug: Grid overlay images (mode: {debugData.grid_mode || 'unknown'})
                  </h4>
                  {overlayImages.map((pageData: any, index: number) => {
                    // Support both old format (string) and new format ({ failed, passed })
                    if (typeof pageData === 'string') {
                      return <DebugImage key={index} base64={pageData} index={index} />;
                    }
                    return (
                      <div key={index} className="mb-4">
                        <h5 className="text-sm font-semibold text-yellow-700 mb-2">Page {index + 1}</h5>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <h6 className="text-xs font-medium text-red-600 mb-1">Failed Checks</h6>
                            {pageData.failed && <DebugImage base64={pageData.failed} index={index} />}
                          </div>
                          <div>
                            <h6 className="text-xs font-medium text-green-600 mb-1">Passed Checks</h6>
                            {pageData.passed && <DebugImage base64={pageData.passed} index={index} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
