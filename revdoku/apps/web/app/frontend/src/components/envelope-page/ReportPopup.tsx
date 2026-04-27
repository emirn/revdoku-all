import React, { useRef, useState, useEffect, useCallback } from "react";
import type { ICheck, IReport, ReportLayoutMode, LabelFontFamily } from "@revdoku/lib";
import { REVDOKU_LABEL_FONT_FAMILIES, REVDOKU_HIGHLIGHT_MODES_CONFIG, CheckFilterType, REVDOKU_CHECK_FILTER_LABELS, CheckType, getCheckTypes, HighlightMode, getFontFamilyCss } from "@revdoku/lib";
import { getHighlightModeIcon } from "@/components/envelope-page/HighlightModeSelect";
import type { CheckFilter } from "@/components/envelope-page/CheckNavigator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { EllipsisVertical, Check, ArrowUpToLine } from "lucide-react";
import { showToast } from "@/lib/toast";
import { ApiClient } from "@/lib/api-client";
// REVDOKU_CATCH_CHANGES_RULE_ID replaced by CheckType.CHANGE via getCheckTypes()

interface ReportPopupProps {
  currentReport: IReport | null;
  reportContent: string;
  reportLoading: boolean;
  checkFilter: CheckFilter;
  setCheckFilter: (filter: CheckFilter) => void;
  hasPreviousReport?: boolean;
  reportLayoutMode: ReportLayoutMode;
  setReportLayoutMode: (mode: ReportLayoutMode) => void;
  showAnnotations: boolean;
  setShowAnnotations: (val: boolean) => void;
  generateReport: (
    customLayoutMode?: ReportLayoutMode,
    overrideCheckFilter?: CheckFilter,
    overrideShowAnnotations?: boolean,
    overrideFontScale?: number,
    overrideFontFamily?: LabelFontFamily,
    overrideHighlightMode?: HighlightMode,
  ) => Promise<any>;
  fontScale: number;
  setFontScale: (scale: number) => void;
  fontFamily?: LabelFontFamily;
  setFontFamily?: (family: LabelFontFamily) => void;
  highlightMode?: HighlightMode;
  formatReportAsText: () => string;
  onClose: () => void;
  showOnboardingHints?: boolean;
  envelopeId?: string;
  envelopeTitle?: string;
  alignLabelsToTop?: boolean;
  onAlignLabelsToTopChange?: (value: boolean) => void;
  onExportChecksCsv?: () => void;
}

/** Build clean HTML from the live iframe DOM, baking in all user's current settings.
 *  Strips toolbar, options panel, scripts, hidden checks/sections, and inactive highlight modes.
 *  Uses cloneNode instead of DOMParser to preserve SVG foreignObject namespaces. */
function getCleanReportHtml(
  reportContent: string,
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  toggleToSectionMap: Record<string, { attr: string; value: string }>,
): string {
  let iframeDoc: Document | null = null;
  try {
    const iframe = iframeRef.current;
    iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document || null;
  } catch { /* cross-origin guard */ }

  if (!iframeDoc) {
    // Fallback: strip from raw content
    const doc = new DOMParser().parseFromString(reportContent, 'text/html');
    doc.querySelectorAll('#revdoku-toolbar, #revdoku-panel, .revdoku-panel-overlay, .revdoku-gear, script').forEach(el => el.remove());
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  // Deep clone the live DOM — preserves SVG namespaces and all JS-applied inline styles
  const clone = iframeDoc.documentElement.cloneNode(true) as HTMLElement;

  // Strip interactive elements (toolbar, options panel, scripts)
  clone.querySelectorAll('#revdoku-toolbar, #revdoku-panel, .revdoku-panel-overlay, .revdoku-gear, script').forEach(el => el.remove());

  // Strip hidden checks (filtered out by check filter or annotations toggle)
  clone.querySelectorAll('g[data-check-id]').forEach(el => {
    if ((el as HTMLElement).style.display === 'none') el.remove();
  });
  clone.querySelectorAll('div[data-check-id]').forEach(el => {
    if ((el as HTMLElement).style.display === 'none') el.remove();
  });

  // Strip inactive highlight modes (only keep the visible one)
  clone.querySelectorAll('.revdoku-hl').forEach(el => {
    if ((el as HTMLElement).style.display === 'none') el.remove();
  });

  // Strip hidden sections (from Options toggles)
  for (const [toggleId, { attr, value }] of Object.entries(toggleToSectionMap)) {
    const checkbox = iframeDoc.getElementById(toggleId) as HTMLInputElement | null;
    if (checkbox && !checkbox.checked) {
      clone.querySelectorAll(`[${attr}="${value}"]`).forEach(el => el.remove());
    }
  }

  const timestamp = new Date().toISOString();
  return `<!DOCTYPE html>\n<!-- GENERATED WITH REVDOKU ON ${timestamp} -->\n` + clone.outerHTML;
}

export default function ReportPopup({
  currentReport,
  reportContent,
  reportLoading,
  checkFilter,
  setCheckFilter,
  reportLayoutMode,
  setReportLayoutMode,
  showAnnotations,
  setShowAnnotations,
  generateReport,
  fontScale,
  setFontScale,
  fontFamily,
  setFontFamily,
  highlightMode,
  formatReportAsText,
  onClose,
  showOnboardingHints,
  envelopeId,
  envelopeTitle,
  hasPreviousReport,
  alignLabelsToTop,
  onAlignLabelsToTopChange,
  onExportChecksCsv,
}: ReportPopupProps) {
  const reportIframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeContentHeight, setIframeContentHeight] = useState<number | null>(null);

  // Local highlight mode state — independent from envelope viewer
  const [localHighlightMode, setLocalHighlightMode] = useState<HighlightMode>(highlightMode ?? 0);

  const measureIframeHeight = () => {
    const iframe = reportIframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc?.body) {
        setIframeContentHeight(doc.body.scrollHeight);
      }
    } catch { /* cross-origin guard */ }
  };

  // Reset measured height when report content changes so re-measure occurs
  useEffect(() => { setIframeContentHeight(null); }, [reportContent]);

  // Debounced report regeneration for font/highlight controls (1s delay so rapid clicks coalesce)
  const fontRegenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateReportRef = useRef(generateReport);
  generateReportRef.current = generateReport;
  const debouncedRegenerate = useCallback((overrideFontScale?: number, overrideFontFamily?: LabelFontFamily, overrideHighlightMode?: HighlightMode) => {
    if (fontRegenTimerRef.current) clearTimeout(fontRegenTimerRef.current);
    fontRegenTimerRef.current = setTimeout(() => {
      fontRegenTimerRef.current = null;
      generateReportRef.current(undefined, undefined, undefined, overrideFontScale, overrideFontFamily, overrideHighlightMode);
    }, 1000);
  }, []);
  // Clean up timer on unmount
  useEffect(() => () => { if (fontRegenTimerRef.current) clearTimeout(fontRegenTimerRef.current); }, []);

  const handleFontScale = (direction: 'in' | 'out') => {
    const step = 0.25;
    const next = direction === 'in'
      ? Math.min(3.0, Math.round((fontScale + step) * 100) / 100)
      : Math.max(0.25, Math.round((fontScale - step) * 100) / 100);
    setFontScale(next);
    // Client-side font scale — no server request needed
    const cw = reportIframeRef.current?.contentWindow as any;
    if (cw?.revdokuApplyFontScale) { cw.revdokuApplyFontScale(next); }
    else { cw?.postMessage({ type: 'revdoku-font-scale', scale: next }, '*'); }
  };

  /** Set up gear-button and toggle interactivity inside the iframe's contentDocument.
   *  This bypasses CSP restrictions on inline scripts/onclick handlers. */
  const setupIframeInteractivity = () => {
    const iframe = reportIframeRef.current;
    if (!iframe) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument || iframe.contentWindow?.document || null;
    } catch { return; }
    if (!doc) return;

    const btn = doc.getElementById('revdoku-gear-btn');
    const panel = doc.getElementById('revdoku-panel');
    if (!btn || !panel) return;

    let isOpen = false;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isOpen = !isOpen;
      panel.style.display = isOpen ? 'block' : 'none';
    });

    doc.addEventListener('click', (e) => {
      if (isOpen && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) {
        isOpen = false;
        panel.style.display = 'none';
      }
    });

    // Section toggles — all section IDs that use data-section attribute.
    // 'default-footer' intentionally omitted: the branding footer is always
    // visible (no data-section attribute, no toggle checkbox) and must stay
    // that way.
    const sectionIds = [
      'envelope-title', 'envelope-datetime', 'envelope-revisions-info',
      'checklist-ai-model', 'checklist-name', 'compliance-summary', 'compliance-percent',
      'revision-comparison', 'rules', 'technical-info',
      'page-images', 'page-filenames', 'check-details', 'extracted-data', 'page-summary-icons',
      'check-attribution', 'checklist-info', 'checklist-general-prompt',
      'checklist-rules-summary', 'checklist-rules-details',
      'checklist-envelope-rules', 'show-timezone', 'checklist-ai-model-details',
      'document-history', 'tags', 'user-js-output',
    ];
    sectionIds.forEach((name) => {
      const cb = doc!.getElementById('toggle-' + name) as HTMLInputElement | null;
      if (!cb) return;
      cb.addEventListener('change', () => {
        const vis = cb.checked;
        doc!.querySelectorAll(`[data-section="${name}"]`).forEach((el) => {
          if (name === 'checklist-name') {
            (el as HTMLElement).style.display = vis ? 'inline' : 'none';
          } else if (name === 'checklist-ai-model' || name === 'tags') {
            (el as HTMLElement).style.display = vis ? 'inline-flex' : 'none';
          } else {
            (el as HTMLElement).style.display = vis ? '' : 'none';
          }
        });
        try { window.parent.postMessage({ type: 'revdoku-toggle', section: name, visible: vis }, '*'); } catch (e) { }
        measureIframeHeight();
      });
    });

    // Section group toggles — also disable/enable child checkboxes
    const groupChildren: Record<string, string[]> = {
      'group-header': ['envelope-title', 'envelope-datetime', 'envelope-revisions-info', 'compliance-percent', 'checklist-ai-model', 'checklist-ai-model-details', 'checklist-name', 'compliance-summary', 'revision-comparison', 'tags'],
      'group-checklist': ['checklist-info', 'checklist-general-prompt', 'checklist-rules-summary', 'checklist-rules-details', 'checklist-envelope-rules'],
      'group-pages': ['pages-with-checks', 'pages-without-checks', 'page-images', 'page-filenames', 'check-details', 'extracted-data', 'rules', 'page-summary-icons', 'check-attribution'],
      'group-footer': ['technical-info', 'document-history'],
    };
    const setGroupChildrenDisabled = (children: string[], disabled: boolean) => {
      children.forEach((child) => {
        const childCb = doc!.getElementById('toggle-' + child) as HTMLInputElement | null;
        if (!childCb) return;
        childCb.disabled = disabled;
        const lbl = childCb.closest('label') as HTMLElement | null;
        if (lbl) lbl.style.opacity = disabled ? '0.4' : '1';
      });
    };
    ['group-header', 'group-checklist', 'group-pages', 'group-footer'].forEach((name) => {
      const cb = doc!.getElementById('toggle-' + name) as HTMLInputElement | null;
      if (!cb) return;
      // Apply initial disabled state
      if (!cb.checked) setGroupChildrenDisabled(groupChildren[name], true);
      cb.addEventListener('change', () => {
        const vis = cb.checked;
        doc!.querySelectorAll(`[data-section-group="${name}"]`).forEach((el) => {
          (el as HTMLElement).style.display = vis ? '' : 'none';
        });
        setGroupChildrenDisabled(groupChildren[name], !vis);
        try { window.parent.postMessage({ type: 'revdoku-toggle', section: name, visible: vis }, '*'); } catch (e) { }
        measureIframeHeight();
      });
    });

    // Page-level toggles (pages with/without checks)
    ['pages-with-checks', 'pages-without-checks'].forEach((name) => {
      const cb = doc!.getElementById('toggle-' + name) as HTMLInputElement | null;
      if (!cb) return;
      cb.addEventListener('change', () => {
        const vis = cb.checked;
        const attr = name === 'pages-with-checks' ? 'true' : 'false';
        doc!.querySelectorAll(`[data-page-has-checks="${attr}"]`).forEach((el) => {
          (el as HTMLElement).style.display = vis ? '' : 'none';
        });
        try { window.parent.postMessage({ type: 'revdoku-toggle', section: name, visible: vis }, '*'); } catch (e) { }
        measureIframeHeight();
      });
    });

    // ---- In-report toolbar controls (revdoku-toolbar) ----

    // Check filter — custom button + popover dropdown (replaces native <select>)
    const filterBtn = doc.getElementById('revdoku-filter-btn') as HTMLButtonElement | null;
    const filterMenu = doc.getElementById('revdoku-filter-menu') as HTMLDivElement | null;
    const filterLabel = doc.getElementById('revdoku-filter-label') as HTMLSpanElement | null;
    if (filterBtn && filterMenu && filterLabel) {
      const applyFilter = (filter: string) => {
        // Mirror the chosen item's content into the button label
        const item = filterMenu.querySelector<HTMLDivElement>(`[data-filter-value="${filter}"]`);
        if (item) filterLabel.innerHTML = item.innerHTML;
        const isVisible = (type: string | null, passed: boolean): boolean => {
          switch (filter) {
            case 'all': return true;
            case 'passed': return passed;
            case 'failed': return !passed;
            case 'failed_only': return !passed && type !== 'changes';
            case 'changes': return type === 'changes';
            case 'rechecks': return type === 'recheck';
            default: return !passed;
          }
        };
        doc!.querySelectorAll('g[data-check-id]').forEach(el => {
          (el as HTMLElement).style.display = isVisible(el.getAttribute('data-check-filter-type'), el.getAttribute('data-check-passed') === 'true') ? '' : 'none';
        });
        doc!.querySelectorAll('div[data-check-id]').forEach(el => {
          (el as HTMLElement).style.display = isVisible(el.getAttribute('data-check-filter-type'), el.getAttribute('data-check-passed') === 'true') ? '' : 'none';
        });
        measureIframeHeight();
      };

      // Initialize button label from `initial_check_filter` set by handlebars (data attr on body or default 'failed')
      const initial = doc.body?.getAttribute('data-initial-check-filter') || 'failed';
      const initialItem = filterMenu.querySelector<HTMLDivElement>(`[data-filter-value="${initial}"]`)
        ?? filterMenu.querySelector<HTMLDivElement>('[data-filter-value]');
      if (initialItem) filterLabel.innerHTML = initialItem.innerHTML;

      let menuOpen = false;
      const closeMenu = () => { menuOpen = false; filterMenu.style.display = 'none'; };
      filterBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        menuOpen = !menuOpen;
        filterMenu.style.display = menuOpen ? 'block' : 'none';
      });
      filterMenu.querySelectorAll<HTMLDivElement>('[data-filter-value]').forEach(item => {
        item.addEventListener('mouseenter', () => { item.style.background = '#f1f5f9'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
          const v = item.getAttribute('data-filter-value');
          if (v) applyFilter(v);
          closeMenu();
        });
      });
      doc.addEventListener('click', (e) => {
        if (menuOpen && !filterMenu.contains(e.target as Node) && !filterBtn.contains(e.target as Node)) closeMenu();
      });
    }

    // Capture original label positions at scale=1.0 for restore on font changes
    type OrigLabel = { bgY: number; bgH: number; borderY1: number; borderY2: number; textY: number; leaderY1s: number[] };
    let origLabelPositions: Record<string, OrigLabel> | null = null;
    const captureOrigLabelPositions = () => {
      if (origLabelPositions) return;
      origLabelPositions = {};
      doc!.querySelectorAll('g[data-check-id]').forEach(g => {
        const id = g.getAttribute('data-check-id')!;
        const bg = g.querySelector('.revdoku-label-bg');
        const border = g.querySelector('.revdoku-label-border');
        const text = g.querySelector('.revdoku-label-text');
        if (!bg) return;
        origLabelPositions![id] = {
          bgY: parseFloat(bg.getAttribute('y') || '0'),
          bgH: parseFloat(bg.getAttribute('data-base-height') || bg.getAttribute('height') || '30'),
          borderY1: border ? parseFloat(border.getAttribute('y1') || '0') : 0,
          borderY2: border ? parseFloat(border.getAttribute('y2') || '0') : 0,
          textY: text ? parseFloat(text.getAttribute('y') || '0') : 0,
          leaderY1s: Array.from(g.querySelectorAll('.revdoku-leader')).map(l =>
            parseFloat(l.getAttribute('y1') || l.getAttribute('cy') || '0')
          ),
        };
      });
    };

    // Restore original positions, apply scaled heights, then push overlapping labels down
    const restackLabelsFromOriginals = (scale: number) => {
      captureOrigLabelPositions();
      const gap = 8;
      doc!.querySelectorAll('svg').forEach(svgEl => {
        const groups = Array.from(svgEl.querySelectorAll('g[data-check-id]'));
        const labelGroups = groups.filter(g => g.querySelector('.revdoku-label-bg') && (g as HTMLElement).style.display !== 'none');
        if (labelGroups.length === 0) return;

        // First: restore all to original Y, apply scaled height
        labelGroups.forEach(g => {
          const id = g.getAttribute('data-check-id')!;
          const orig = origLabelPositions?.[id];
          if (!orig) return;
          const bg = g.querySelector('.revdoku-label-bg')!;
          const border = g.querySelector('.revdoku-label-border');
          const text = g.querySelector('.revdoku-label-text');
          const scaledH = orig.bgH * scale * scale; // quadratic: larger fonts wrap to more lines
          bg.setAttribute('y', String(orig.bgY));
          bg.setAttribute('height', String(scaledH));
          if (text) { text.setAttribute('y', String(orig.textY)); text.setAttribute('height', String(scaledH)); }
          if (border) { border.setAttribute('y1', String(orig.borderY1)); border.setAttribute('y2', String(orig.borderY1 + scaledH)); }
          const leaders = Array.from(g.querySelectorAll('.revdoku-leader'));
          leaders.forEach((l, i) => {
            if (i < orig.leaderY1s.length) {
              if (l.tagName === 'line') l.setAttribute('y1', String(orig.leaderY1s[i]));
              else if (l.tagName === 'circle') l.setAttribute('cy', String(orig.leaderY1s[i]));
            }
          });
        });

        // Push overlapping labels down — process left and right sides independently
        for (const side of ['left', 'right']) {
          const sideGroups = labelGroups.filter(g => {
            const bg = g.querySelector('.revdoku-label-bg');
            return bg?.getAttribute('data-label-side') === side;
          });
          if (sideGroups.length === 0) continue;
          sideGroups.sort((a, b) => {
            const ay = parseFloat(a.querySelector('.revdoku-label-bg')!.getAttribute('y') || '0');
            const by = parseFloat(b.querySelector('.revdoku-label-bg')!.getAttribute('y') || '0');
            return ay - by;
          });
          let minNextY = 0;
          sideGroups.forEach(g => {
            const bg = g.querySelector('.revdoku-label-bg')!;
            const border = g.querySelector('.revdoku-label-border');
            const text = g.querySelector('.revdoku-label-text');
            const currentY = parseFloat(bg.getAttribute('y') || '0');
            const labelH = parseFloat(bg.getAttribute('height') || '30');
            const newY = Math.max(currentY, minNextY);
            if (newY !== currentY) {
              const dy = newY - currentY;
              bg.setAttribute('y', String(newY));
              if (text) text.setAttribute('y', String(newY));
              if (border) {
                border.setAttribute('y1', String(parseFloat(border.getAttribute('y1') || '0') + dy));
                border.setAttribute('y2', String(parseFloat(border.getAttribute('y2') || '0') + dy));
              }
              g.querySelectorAll('.revdoku-leader').forEach(l => {
                if (l.tagName === 'line') l.setAttribute('y1', String(parseFloat(l.getAttribute('y1') || '0') + dy));
                else if (l.tagName === 'circle') l.setAttribute('cy', String(parseFloat(l.getAttribute('cy') || '0') + dy));
              });
            }
            minNextY = newY + labelH + gap;
          });
        }
      });
    };

    // Font scale A-/A+
    let currentFontScale = 1.0;
    const fontDown = doc.getElementById('revdoku-font-down');
    const fontUp = doc.getElementById('revdoku-font-up');
    const applyFontScale = (scale: number) => {
      currentFontScale = scale;
      // Scale label text font size
      doc!.querySelectorAll('foreignObject div[data-base-font-size]').forEach(el => {
        const base = parseFloat(el.getAttribute('data-base-font-size') || '14');
        (el as HTMLElement).style.fontSize = `${base * scale}px`;
      });
      // Scale badge size
      doc!.querySelectorAll('span[data-base-badge-size]').forEach(el => {
        const base = parseFloat(el.getAttribute('data-base-badge-size') || '20');
        const scaled = base * scale;
        const s = el as HTMLElement;
        s.style.width = `${scaled}px`;
        s.style.height = `${scaled}px`;
        s.style.fontSize = `${scaled * 0.45}px`;
      });
      // Restore original positions, apply scaled heights, and restack
      restackLabelsFromOriginals(scale);
    };
    if (fontDown) fontDown.addEventListener('click', () => applyFontScale(Math.max(0.25, Math.round((currentFontScale - 0.25) * 100) / 100)));
    if (fontUp) fontUp.addEventListener('click', () => applyFontScale(Math.min(3.0, Math.round((currentFontScale + 0.25) * 100) / 100)));

    // Checks toggle
    const checksToggle = doc.getElementById('revdoku-checks-toggle') as HTMLInputElement | null;
    if (checksToggle) {
      checksToggle.addEventListener('change', () => {
        const show = checksToggle.checked;
        doc!.querySelectorAll('g[data-check-id]').forEach(el => {
          (el as HTMLElement).style.display = show ? '' : 'none';
        });
        measureIframeHeight();
      });
    }

    // Highlight mode
    const hlSelect = doc.getElementById('revdoku-highlight-select') as HTMLSelectElement | null;
    if (hlSelect) {
      hlSelect.addEventListener('change', () => {
        const mode = parseInt(hlSelect.value, 10);
        const modes = ['rectangle', 'dot', 'underline', 'bracket'];
        const activeClass = `revdoku-hl-${modes[mode] || 'rectangle'}`;
        doc!.querySelectorAll('.revdoku-hl').forEach(el => {
          (el as HTMLElement).style.display = el.classList.contains(activeClass) ? '' : 'none';
        });
      });
    }

    // Font family
    const fontFamilySelect = doc.getElementById('revdoku-font-family-select') as HTMLSelectElement | null;
    const fontFamilyMap: Record<string, string> = {
      'sans-serif': 'Arial, "Liberation Sans", Helvetica, sans-serif',
      'serif': '"Times New Roman", "Liberation Serif", Georgia, serif',
      'monospace': '"Courier New", "Liberation Mono", Consolas, monospace',
    };
    if (fontFamilySelect) {
      fontFamilySelect.addEventListener('change', () => {
        const css = fontFamilyMap[fontFamilySelect.value] || fontFamilySelect.value;
        doc!.body.style.fontFamily = css;
        doc!.querySelectorAll('foreignObject div').forEach(el => {
          (el as HTMLElement).style.fontFamily = css;
        });
      });
    }

    // Align labels to top
    const alignTopCb = doc.getElementById('revdoku-align-top') as HTMLInputElement | null;
    if (alignTopCb) {
      let originalPositions: Record<string, { bgY: number; borderY1: number | null; borderY2: number | null; textY: number; leaders: { y1: number }[] }> | null = null;
      alignTopCb.addEventListener('change', () => {
        const alignToTop = alignTopCb.checked;
        const gap = 8;
        // Capture original positions on first use
        if (!originalPositions) {
          originalPositions = {};
          doc!.querySelectorAll('g[data-check-id]').forEach(g => {
            const id = g.getAttribute('data-check-id')!;
            const bg = g.querySelector('.revdoku-label-bg') as SVGElement | null;
            const border = g.querySelector('.revdoku-label-border') as SVGElement | null;
            const text = g.querySelector('.revdoku-label-text') as SVGElement | null;
            const leaders = Array.from(g.querySelectorAll('.revdoku-leader'));
            if (!bg || !text) return;
            originalPositions![id] = {
              bgY: parseFloat(bg.getAttribute('y') || '0'),
              borderY1: border ? parseFloat(border.getAttribute('y1') || '0') : null,
              borderY2: border ? parseFloat(border.getAttribute('y2') || '0') : null,
              textY: parseFloat(text.getAttribute('y') || '0'),
              leaders: leaders.map(l => ({ y1: parseFloat(l.getAttribute('y1') || l.getAttribute('cy') || '0') })),
            };
          });
        }
        // Process each page SVG independently
        doc!.querySelectorAll('svg').forEach(svgEl => {
          const groups = Array.from(svgEl.querySelectorAll('g[data-check-id]'));
          const labelGroups = groups.filter(g => g.querySelector('.revdoku-label-bg'));
          if (labelGroups.length === 0) return;
          if (alignToTop) {
            // Process left and right side labels independently
            const sides = ['left', 'right'] as const;
            for (const side of sides) {
              const sideGroups = labelGroups.filter(g => {
                const bg = g.querySelector('.revdoku-label-bg');
                return bg?.getAttribute('data-label-side') === side;
              });
              if (sideGroups.length === 0) continue;
              sideGroups.sort((a, b) => parseFloat(a.getAttribute('data-highlight-cy') || '0') - parseFloat(b.getAttribute('data-highlight-cy') || '0'));
              let currentY = 5;
              sideGroups.forEach(g => {
                const bg = g.querySelector('.revdoku-label-bg')!;
                const border = g.querySelector('.revdoku-label-border');
                const text = g.querySelector('.revdoku-label-text');
                const labelH = parseFloat(bg.getAttribute('height') || '30');
                const oldY = parseFloat(bg.getAttribute('y') || '0');
                const dy = currentY - oldY;
                bg.setAttribute('y', String(currentY));
                if (text) text.setAttribute('y', String(currentY));
                if (border) { border.setAttribute('y1', String(currentY)); border.setAttribute('y2', String(currentY + labelH)); }
                g.querySelectorAll('.revdoku-leader').forEach(l => {
                  if (l.tagName === 'line') { const ly = parseFloat(l.getAttribute('y1') || '0'); l.setAttribute('y1', String(ly + dy)); }
                  else if (l.tagName === 'circle') { const cy = parseFloat(l.getAttribute('cy') || '0'); l.setAttribute('cy', String(cy + dy)); }
                });
                currentY += labelH + gap;
              });
            }
          } else {
            labelGroups.forEach(g => {
              const id = g.getAttribute('data-check-id')!;
              const orig = originalPositions?.[id];
              if (!orig) return;
              const bg = g.querySelector('.revdoku-label-bg')!;
              const border = g.querySelector('.revdoku-label-border');
              const text = g.querySelector('.revdoku-label-text');
              bg.setAttribute('y', String(orig.bgY));
              if (text) text.setAttribute('y', String(orig.textY));
              if (border && orig.borderY1 !== null) { border.setAttribute('y1', String(orig.borderY1)); border.setAttribute('y2', String(orig.borderY2)); }
              const leaders = Array.from(g.querySelectorAll('.revdoku-leader'));
              leaders.forEach((l, i) => {
                if (i < orig.leaders.length) {
                  if (l.tagName === 'line') l.setAttribute('y1', String(orig.leaders[i].y1));
                  else if (l.tagName === 'circle') l.setAttribute('cy', String(orig.leaders[i].y1));
                }
              });
            });
          }
        });
        measureIframeHeight();
      });
    }
  };

  const handleIframeLoad = () => {
    measureIframeHeight();
    setupIframeInteractivity();
  };

  // Listen for revdoku-resize messages from the iframe's inline script to re-measure height
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'revdoku-resize') measureIframeHeight();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const rpAllChecks = currentReport?.checks || [];
  const rpFailedChecks = rpAllChecks.filter(c => !c.passed).length;
  const rpPassedChecks = rpAllChecks.filter(c => c.passed).length;
  const rpTotalChecks = rpAllChecks.length;
  const rpChangesChecks = rpAllChecks.filter(c => getCheckTypes(c).has(CheckType.CHANGE)).length;
  const rpRecheckChecks = rpAllChecks.filter(c => c.description?.startsWith('#recheck ')).length;
  const rpFailedOnlyChecks = rpAllChecks.filter(c => { const t = getCheckTypes(c); return t.has(CheckType.FAILED) && !t.has(CheckType.CHANGE); }).length;

  // Auto-switch to "All" when selected filter has 0 matching checks
  useEffect(() => {
    if (!currentReport) return;
    if (checkFilter === CheckFilterType.FAILED_AND_CHANGES && rpFailedChecks === 0 && rpTotalChecks > 0) {
      setCheckFilter(CheckFilterType.ALL);
      generateReport(undefined, CheckFilterType.ALL);
    } else if (checkFilter === CheckFilterType.PASSED && rpPassedChecks === 0 && rpTotalChecks > 0) {
      setCheckFilter(CheckFilterType.ALL);
      generateReport(undefined, CheckFilterType.ALL);
    } else if (checkFilter === CheckFilterType.CHANGES && rpChangesChecks === 0 && rpTotalChecks > 0) {
      setCheckFilter(CheckFilterType.ALL);
      generateReport(undefined, CheckFilterType.ALL);
    } else if (checkFilter === CheckFilterType.RECHECKS && rpRecheckChecks === 0 && rpTotalChecks > 0) {
      setCheckFilter(CheckFilterType.ALL);
      generateReport(undefined, CheckFilterType.ALL);
    } else if (checkFilter === CheckFilterType.FAILED && rpFailedOnlyChecks === 0 && rpTotalChecks > 0) {
      setCheckFilter(CheckFilterType.ALL);
      generateReport(undefined, CheckFilterType.ALL);
    }
  }, [currentReport, rpFailedChecks, rpPassedChecks, rpTotalChecks, rpChangesChecks, rpRecheckChecks, rpFailedOnlyChecks]);

  // Esc key: listen on iframe's contentDocument (iframe steals focus from parent)
  useEffect(() => {
    const iframe = reportIframeRef.current;
    if (!iframe) return;

    let iframeCleanup: (() => void) | undefined;

    const attachListener = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
          };
          iframeDoc.addEventListener('keydown', handler);
          iframeCleanup = () => iframeDoc.removeEventListener('keydown', handler);
        }
      } catch { /* cross-origin guard */ }
    };

    const onLoad = () => attachListener();
    iframe.addEventListener('load', onLoad);
    // Also try immediately (if already loaded)
    attachListener();

    return () => {
      iframe.removeEventListener('load', onLoad);
      iframeCleanup?.();
    };
  }, [reportContent, onClose]);

  const copyReportAsHtml = () => {
    const cleanHtml = getCleanReportHtml(reportContent, reportIframeRef, toggleToSectionMap);
    if (navigator.clipboard && window.ClipboardItem) {
      const htmlBlob = new Blob([cleanHtml], { type: "text/html" });
      navigator.clipboard
        .write([new ClipboardItem({ "text/html": htmlBlob })])
        .then(() => showToast('Copied!'))
        .catch(() =>
          navigator.clipboard.writeText(cleanHtml)
            .then(() => showToast('Copied!')),
        );
    } else {
      navigator.clipboard.writeText(cleanHtml)
        .then(() => showToast('Copied!'));
    }
  };

  const downloadHtmlFile = (html: string) => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = envelopeTitle ? `Report - ${envelopeTitle.replace(/[.\s]+/g, '-')}.html` : `report.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Report saved!');
  };

  /** Toggle checkbox ID → data-section or data-page-has-checks selector */
  const toggleToSectionMap: Record<string, { attr: string; value: string }> = {
    'toggle-envelope-title': { attr: 'data-section', value: 'envelope-title' },
    'toggle-envelope-datetime': { attr: 'data-section', value: 'envelope-datetime' },
    'toggle-envelope-revisions-info': { attr: 'data-section', value: 'envelope-revisions-info' },
    'toggle-checklist-ai-model': { attr: 'data-section', value: 'checklist-ai-model' },
    'toggle-checklist-name': { attr: 'data-section', value: 'checklist-name' },
    'toggle-compliance-summary': { attr: 'data-section', value: 'compliance-summary' },
    'toggle-compliance-percent': { attr: 'data-section', value: 'compliance-percent' },
    'toggle-revision-comparison': { attr: 'data-section', value: 'revision-comparison' },
    'toggle-rules': { attr: 'data-section', value: 'rules' },
    'toggle-technical-info': { attr: 'data-section', value: 'technical-info' },
    'toggle-page-images': { attr: 'data-section', value: 'page-images' },
    'toggle-page-filenames': { attr: 'data-section', value: 'page-filenames' },
    'toggle-check-details': { attr: 'data-section', value: 'check-details' },
    'toggle-page-summary-icons': { attr: 'data-section', value: 'page-summary-icons' },
    'toggle-check-attribution': { attr: 'data-section', value: 'check-attribution' },
    'toggle-checklist-info': { attr: 'data-section', value: 'checklist-info' },
    'toggle-checklist-general-prompt': { attr: 'data-section', value: 'checklist-general-prompt' },
    'toggle-checklist-rules-summary': { attr: 'data-section', value: 'checklist-rules-summary' },
    'toggle-checklist-rules-details': { attr: 'data-section', value: 'checklist-rules-details' },
    'toggle-checklist-envelope-rules': { attr: 'data-section', value: 'checklist-envelope-rules' },
    'toggle-show-timezone': { attr: 'data-section', value: 'show-timezone' },
    'toggle-checklist-ai-model-info': { attr: 'data-section', value: 'checklist-ai-model-info' },
    'toggle-group-header': { attr: 'data-section-group', value: 'group-header' },
    'toggle-group-checklist': { attr: 'data-section-group', value: 'group-checklist' },
    'toggle-group-pages': { attr: 'data-section-group', value: 'group-pages' },
    'toggle-group-footer': { attr: 'data-section-group', value: 'group-footer' },
    'toggle-pages-with-checks': { attr: 'data-page-has-checks', value: 'true' },
    'toggle-pages-without-checks': { attr: 'data-page-has-checks', value: 'false' },
    'toggle-user-js-output': { attr: 'data-section', value: 'user-js-output' },
  };

  /** Save clean HTML matching what the user currently sees (hidden sections stripped from DOM) */
  const saveCleanReportAsHtml = () => {
    downloadHtmlFile(getCleanReportHtml(reportContent, reportIframeRef, toggleToSectionMap));
  };

  /** Dev-only: save the full HTML with interactive options panel intact */
  const saveReportAsHtmlWithOptions = () => {
    downloadHtmlFile(reportContent);
  };

  const handlePrintPdf = () => {
    const iframe = document.querySelector('iframe[title="Report Preview"]') as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div
        className="bg-card rounded-lg shadow-lg border border-border p-1 w-full sm:w-[900px] max-w-[98%] max-h-[100dvh] sm:max-h-[90vh] flex flex-col"
        style={{
          height: iframeContentHeight ? `min(${iframeContentHeight + 100}px, 90vh)` : '90vh',
          minHeight: '300px',
          transition: 'height 0.2s ease-out',
        }}
      >
        {/* Row 1: Title + Close */}
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b border-border rounded-t-lg">
          <h2 className="text-sm font-semibold text-foreground shrink-0">Report</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Row 2: Layout mode only — all other controls are in the report's sticky toolbar */}
        <div className="flex items-center gap-2 px-2 sm:px-4 py-1.5 border-b border-border bg-muted/30 flex-wrap">

          {/* Page Previews */}
          <select
            value={reportLayoutMode}
            onChange={async (e) => {
              const newValue = e.target.value as ReportLayoutMode;
              setReportLayoutMode(newValue);
              await generateReport(newValue);
            }}
            className="h-7 px-2 py-0 text-xs border border-border rounded-md bg-card text-foreground"
          >
            <option value="full">Full</option>
            <option value="compact">Compact</option>
          </select>
        </div>

        <div className="flex-1 overflow-auto border-0 rounded-md">
          {reportLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                <span className="text-sm text-muted-foreground">Generating report...</span>
              </div>
            </div>
          ) : (
            <iframe
              ref={reportIframeRef}
              title="Report Preview"
              srcDoc={reportContent}
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-modals allow-scripts"
              onLoad={handleIframeLoad}
            />
          )}
        </div>

        {/* Footer - Action Buttons */}
        <div className="flex items-center justify-end px-2 sm:px-4 py-2 border-t border-border gap-2">
          {/* Copy split button */}
          <div className="inline-flex rounded-lg shadow-sm">
            <button
              disabled={reportLoading}
              className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-secondary-foreground bg-card border border-border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 ${reportLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:border-muted-foreground hover:shadow-md'}`}
              onClick={copyReportAsHtml}
            >
              <svg className="w-4 h-4 sm:mr-1.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">Copy</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={reportLoading}
                  className={`self-stretch inline-flex items-center justify-center px-2.5 text-sm text-secondary-foreground bg-card border border-l-0 border-border rounded-r-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 ${reportLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:border-muted-foreground'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={copyReportAsHtml}>
                  Copy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  const text = formatReportAsText();
                  if (text) {
                    navigator.clipboard.writeText(text)
                      .then(() => showToast('Copied as text!'));
                  }
                }}>
                  Copy As Text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Save split button */}
          <div className="inline-flex rounded-lg shadow-sm">
            <button
              disabled={reportLoading}
              className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-indigo-600 border border-transparent rounded-l-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 ${reportLoading ? 'opacity-50 cursor-not-allowed' : 'hover:from-indigo-600 hover:to-indigo-700 hover:shadow-md'}`}
              onClick={handlePrintPdf}
            >
              <svg className="w-4 h-4 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">Save</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={reportLoading}
                  className={`self-stretch inline-flex items-center justify-center px-2.5 text-sm text-white bg-gradient-to-r from-indigo-500 to-indigo-600 border border-transparent border-l border-l-indigo-400/30 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 ${reportLoading ? 'opacity-50 cursor-not-allowed' : 'hover:from-indigo-600 hover:to-indigo-700'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handlePrintPdf}>
                  Print / PDF...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={saveCleanReportAsHtml}>
                  Save as HTML
                </DropdownMenuItem>
                {onExportChecksCsv && (
                  <DropdownMenuItem onClick={onExportChecksCsv}>
                    Export Checks to CSV
                  </DropdownMenuItem>
                )}
                {import.meta.env.DEV && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={saveReportAsHtmlWithOptions}>
                      Save as HTML (dev)
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-secondary-foreground bg-card border border-border rounded-lg shadow-sm hover:bg-accent hover:border-muted-foreground hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
