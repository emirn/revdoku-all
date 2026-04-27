import { useNavigate } from "react-router-dom";
import {
  EllipsisVertical, Archive, ArchiveRestore, Copy, ScrollText,
  GitCompare, Trash2, Download, Upload, Check, FilePlus, Pencil, FilePenLine,
  SlidersHorizontal, GalleryVertical, ArrowUpToLine, Code, FileSpreadsheet,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  REVDOKU_HIGHLIGHT_MODES_CONFIG, REVDOKU_LABEL_FONT_FAMILIES,
  type HighlightMode, type LabelFontFamily,
} from "@revdoku/lib";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { IReport, IEnvelopePermissions } from "@revdoku/lib";
import { getHighlightModeIcon } from "./HighlightModeSelect";

interface EnvelopeKebabMenuProps {
  // Display settings
  highlightMode: HighlightMode;
  onHighlightModeChange: (mode: HighlightMode) => void;
  fontFamily: LabelFontFamily;
  onFontFamilyChange: (family: LabelFontFamily) => void;
  labelFontScale: number;
  onFontScaleReset: () => void;
  currentReport: IReport | null;

  // Envelope actions
  currentEnvelope: { id?: string; archived_at?: string; permissions?: IEnvelopePermissions } | null;
  onArchiveToggle: () => void;
  onDuplicateEnvelope: () => void;
  onDeleteEnvelope: () => void;
  isInspecting: boolean;

  // Revision diff
  showPageDiffs: boolean;
  setShowPageDiffs: (show: boolean) => void;
  previousReport: IReport | null;

  // View mode
  viewMode: 'single_page' | 'continuous_scroll';
  onViewModeChange: (mode: 'single_page' | 'continuous_scroll') => void;
  alignLabelsToTop: boolean;
  onAlignLabelsToTopChange: (value: boolean) => void;

  // Dev tools
  showDebug: boolean;
  setShowDebug: (show: boolean) => void;
  debugSkipAI: boolean;
  setSkipAI: (skip: boolean) => void;
  debugForceInspection: boolean;
  setDebugForceInspection: (force: boolean) => void;
  debugGridMode: string;
  setDebugGridMode: (mode: string) => void;
  debugPages: string;
  setDebugPages: (pages: string) => void;
  onDownloadEnvelopePdf?: () => void;
  onExportSampleEnvelope?: () => void;
  onLoadFixture?: () => void;

  // Revision actions
  onRenameEnvelope?: () => void;
  onCreateRevision?: () => void;
  onEditRevision?: () => void;
  isEditingDisabled?: boolean;
  onEditUserScript1?: () => void;
  onExportChecksCsv?: () => void;
}

export default function EnvelopeKebabMenu({
  highlightMode, onHighlightModeChange,
  fontFamily, onFontFamilyChange,
  labelFontScale, onFontScaleReset,
  currentReport,
  currentEnvelope, onArchiveToggle, onDuplicateEnvelope, onDeleteEnvelope, isInspecting,
  showPageDiffs, setShowPageDiffs, previousReport,
  viewMode, onViewModeChange,
  alignLabelsToTop, onAlignLabelsToTopChange,
  showDebug, setShowDebug,
  debugSkipAI, setSkipAI,
  debugForceInspection, setDebugForceInspection,
  debugGridMode, setDebugGridMode,
  debugPages, setDebugPages,
  onDownloadEnvelopePdf, onExportSampleEnvelope, onLoadFixture,
  onRenameEnvelope, onCreateRevision, onEditRevision, isEditingDisabled,
  onEditUserScript1,
  onExportChecksCsv,
}: EnvelopeKebabMenuProps) {
  const navigate = useNavigate();
  const features = useFeatureFlags();
  const hasChecks = !!(currentReport && currentReport.checks?.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="More options"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Envelope & revision actions */}
        <DropdownMenuItem onClick={onRenameEnvelope} disabled={isEditingDisabled}>
          <Pencil className="w-4 h-4 mr-2" />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateRevision} disabled={isEditingDisabled}>
          <FilePlus className="w-4 h-4 mr-2" />
          Create New Revision…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEditRevision} disabled={isEditingDisabled}>
          <FilePenLine className="w-4 h-4 mr-2" />
          Edit Revision…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Page View Options — gated by per_page_view feature flag */}
        {features.per_page_view && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Page View Options
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuCheckboxItem
                checked={viewMode === 'continuous_scroll'}
                onCheckedChange={(checked) => onViewModeChange(checked ? 'continuous_scroll' : 'single_page')}
              >
                <GalleryVertical className="w-4 h-4 mr-2" />
                Continuous Page View
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={alignLabelsToTop}
                onCheckedChange={(checked) => onAlignLabelsToTopChange(!!checked)}
              >
                <ArrowUpToLine className="w-4 h-4 mr-2" />
                Align Labels To Top
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {/* Display settings — only when report has checks */}
        {hasChecks && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {(() => {
                  const current = REVDOKU_HIGHLIGHT_MODES_CONFIG.find(m => m.mode === highlightMode);
                  const Icon = current ? getHighlightModeIcon(current.icon) : null;
                  return (
                    <>
                      {Icon && <Icon className="w-4 h-4 mr-2" />}
                      Highlight: {current?.label ?? 'Default'}
                    </>
                  );
                })()}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {REVDOKU_HIGHLIGHT_MODES_CONFIG.map((m) => {
                  const Icon = getHighlightModeIcon(m.icon);
                  return (
                    <DropdownMenuItem key={m.mode} onClick={() => onHighlightModeChange(m.mode)}>
                      <span className="w-4 h-4 mr-2 flex items-center justify-center">
                        {highlightMode === m.mode && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <Icon className="w-4 h-4 mr-2" />
                      {m.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="mr-2 text-sm font-medium" style={{ fontFamily: fontFamily }}>A</span>
                Font: {REVDOKU_LABEL_FONT_FAMILIES.find(f => f.key === fontFamily)?.label ?? fontFamily}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {REVDOKU_LABEL_FONT_FAMILIES.map((f) => (
                  <DropdownMenuItem key={f.key} onClick={() => onFontFamilyChange(f.key as LabelFontFamily)}>
                    <span className="w-4 h-4 mr-2 flex items-center justify-center">
                      {fontFamily === f.key && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span style={{ fontFamily: f.key }}>{f.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem disabled={labelFontScale === 1.0} onClick={onFontScaleReset}>
              Reset Label Font Size {labelFontScale !== 1.0 ? `(${labelFontScale.toFixed(2)}x)` : ''}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Envelope scripts */}
        <DropdownMenuItem onClick={onEditUserScript1}>
          <Code className="w-4 h-4 mr-2" />
          Edit Envelope Scripts
        </DropdownMenuItem>
        {hasChecks && (
          <DropdownMenuItem onClick={onExportChecksCsv}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export Checks to CSV
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* Envelope actions */}
        <DropdownMenuItem onClick={onArchiveToggle} disabled={isInspecting}>
          {currentEnvelope?.archived_at ? (
            <><ArchiveRestore className="w-4 h-4 mr-2" />Unarchive Envelope</>
          ) : (
            <><Archive className="w-4 h-4 mr-2" />Archive Envelope</>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDuplicateEnvelope} disabled={isInspecting}>
          <Copy className="w-4 h-4 mr-2" />
          Duplicate Envelope
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/logs?envelope_id=${currentEnvelope?.id}`)}>
          <ScrollText className="w-4 h-4 mr-2" />
          View Audit Log
        </DropdownMenuItem>
        {features.diff_viewer && (
          <DropdownMenuItem onClick={() => setShowPageDiffs(!showPageDiffs)}>
            <GitCompare className="w-4 h-4 mr-2" />
            {showPageDiffs ? "Hide" : previousReport ? "Compare" : "View"} revision changes
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          onClick={onDeleteEnvelope}
          disabled={isInspecting}
        >
          <Trash2 className="w-4 h-4 mr-2" />Delete Envelope
        </DropdownMenuItem>

        {/* Dev tools */}
        {import.meta.env.DEV && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowDebug(!showDebug)}>
              {showDebug ? "Hide" : "Show"} debug info
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSkipAI(!debugSkipAI)}>
              {debugSkipAI ? "✓ " : ""}Skip AI
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDebugForceInspection(!debugForceInspection)}>
              {debugForceInspection ? "✓ " : ""}Force AI
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDownloadEnvelopePdf}>
              <Download className="w-4 h-4 mr-2" />
              Download Envelope as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportSampleEnvelope}>
              <Download className="w-4 h-4 mr-2" />
              (DEV) Export to JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLoadFixture}>
              <Upload className="w-4 h-4 mr-2" />
              Load Sample Fixture from File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              if (!currentEnvelope?.id) return;
              try {
                const { ApiClient } = await import('@/lib/api-client');
                const result = await ApiClient.clearEnvelopeCaches(currentEnvelope.id);
                alert(result.message);
              } catch (e) {
                alert('Failed to clear caches: ' + (e instanceof Error ? e.message : String(e)));
              }
            }}>
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Rendered Caches
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDebugGridMode('')}>
              {debugGridMode === '' && '✓ '}Grid: default
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDebugGridMode('overlay-with-rulers')}>
              {debugGridMode === 'overlay-with-rulers' && '✓ '}Grid: overlay-with-rulers
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDebugGridMode('rulers-external-with-subtle-grid')}>
              {debugGridMode === 'rulers-external-with-subtle-grid' && '✓ '}Grid: rulers-external-with-subtle-grid
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDebugGridMode('rulers-external')}>
              {debugGridMode === 'rulers-external' && '✓ '}Grid: rulers-external
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDebugGridMode('overlay')}>
              {debugGridMode === 'overlay' && '✓ '}Grid: overlay
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => {
              const pages = prompt('Pages to review (e.g. "1,3,5-8"):', debugPages);
              if (pages !== null) setDebugPages(pages);
            }}>
              Pages: {debugPages || 'all'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
