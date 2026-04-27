"use client";

import { useState, useEffect, useRef } from "react";
import { ICheck, IRule, IEnvelopeRevision } from "@revdoku/lib";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FilePromptEditor, { type FileDescriptor } from "@/components/FilePromptEditor";
import { Button } from "@/components/ui/button";
import { EnvelopeRuleBadge } from "@/components/ui/EnvelopeRuleBadge";
import { isRuleFromCurrentRevision, REVDOKU_CATCH_CHANGES_RULE_ID, REVDOKU_CATCH_ALL_RULE_ID } from "@/lib/rule-utils";
import { GripHorizontal, X, Trash2, ClipboardCheck, Mail, GitCompareArrows, Sparkles, User } from "lucide-react";

interface InlineCheckEditorProps {
  check: ICheck;
  checkNumber: number;
  mode?: 'edit' | 'create';
  rules: IRule[];
  isReadOnly: boolean;
  getCheckRuleId: (check: ICheck) => string | null;
  currentRevisionId?: string;
  envelopeRevisions?: IEnvelopeRevision[];
  onSave: (checkId: string, updates: { description?: string; rule_key?: string; passed?: boolean; rule_prompt?: string; data?: Record<string, unknown> }) => Promise<void>;
  onCancel: () => void;
  onDelete: (checkId: string) => void;
  onCreateSave?: (data: {
    description: string;
    passed: boolean;
    rule_key?: string;
    new_rule_text?: string;
  }) => Promise<void>;
  onEditRule?: (ruleId: string) => void;
  /** Jump to the rule inside the SOURCE checklist (for checklist-origin rules). */
  onEditChecklistRule?: (ruleId: string) => void;
  onViewRevisionChanges?: () => void;
  checkColor?: string;
  /** All existing data.val values from the report for autocomplete dropdown */
  existingValValues?: string[];
  /** prefix_id → descriptor lookup so ref chips inside the message render the
   *  actual filename instead of the raw dfrev_xxx id. */
  fileLookup?: Map<string, FileDescriptor>;
}

const NEW_RULE_VALUE = '__new_rule__';

export default function InlineCheckEditor({
  check,
  checkNumber,
  mode = 'edit',
  rules,
  isReadOnly,
  getCheckRuleId,
  currentRevisionId,
  envelopeRevisions,
  onSave,
  onCancel,
  onDelete,
  onCreateSave,
  onEditRule,
  onEditChecklistRule,
  onViewRevisionChanges,
  checkColor,
  existingValValues,
  fileLookup,
}: InlineCheckEditorProps) {
  const [status, setStatus] = useState<"passed" | "failed">(check.passed ? "passed" : "failed");
  const [message, setMessage] = useState(check.description || "");
  // Normalize rule key: find the rule by id or source_rule_id, then use its actual id
  // (handles cross-snapshot matching where check.rule_key is a source rule ID)
  const [selectedRuleKey, setSelectedRuleKey] = useState(() => {
    const rawKey = getCheckRuleId(check) || "";
    const matchedRule = rules.find(r => r.id === rawKey || (r as any).source_rule_id === rawKey);
    return matchedRule?.id || rawKey;
  });
  const [dataVal, setDataVal] = useState(check.data?.val || '');
  const [valDropdownOpen, setValDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isNewRule, setIsNewRule] = useState(mode === 'create');
  const [newRuleText, setNewRuleText] = useState('');
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const newRuleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const userEditedMessageRef = useRef(false);
  const [messageManuallyEdited, setMessageManuallyEdited] = useState(false);

  // Auto-focus textarea on mount
  useEffect(() => {
    setTimeout(() => {
      if (isNewRule) {
        newRuleTextareaRef.current?.focus();
      } else {
        textareaRef.current?.focus();
      }
    }, 50);
  }, []);

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // Auto-populate message from rule text in create mode
  useEffect(() => {
    if (mode === 'create' && isNewRule && !userEditedMessageRef.current) {
      if (newRuleText.trim()) {
        setMessage(`violates: ${newRuleText.trim()}`);
      } else {
        setMessage('');
      }
    }
  }, [mode, isNewRule, newRuleText]);

  // Clear transform on unmount so label returns to natural position
  useEffect(() => {
    const ref = containerRef.current;
    return () => {
      const labelEl = ref?.closest('[data-label-id]') as HTMLElement;
      if (labelEl) labelEl.style.transform = '';
    };
  }, []);

  const parseTranslate = (el: HTMLElement): { x: number; y: number } => {
    const m = el.style.transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
    if (m) return { x: parseFloat(m[1]) || 0, y: parseFloat(m[2]) || 0 };
    const mx = el.style.transform.match(/translateX\(([^)]+)px\)/);
    if (mx) return { x: parseFloat(mx[1]) || 0, y: 0 };
    return { x: 0, y: 0 };
  };

  const handleTitleBarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const labelEl = containerRef.current?.closest('[data-label-id]') as HTMLElement | null;
    if (!labelEl) return;
    const existing = parseTranslate(labelEl);
    dragStartRef.current = { x: e.clientX, y: e.clientY, tx: existing.x, ty: existing.y };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    const handleMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = ev.clientX - dragStartRef.current.x;
      const dy = ev.clientY - dragStartRef.current.y;
      labelEl.style.transform = `translate(${dragStartRef.current.tx + dx}px, ${dragStartRef.current.ty + dy}px)`;
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      dragStartRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const getRuleDisplayText = (rule: IRule) => {
    if (rule.id === REVDOKU_CATCH_CHANGES_RULE_ID) {
      return `CHANGES: ${rule.prompt || 'Document Change Review'}`;
    }
    if (rule.id === REVDOKU_CATCH_ALL_RULE_ID) {
      return rule.prompt || 'Additional findings not matched to a specific rule';
    }
    const orderNum = (rule.order ?? 0) + 1;
    const text = rule.prompt || "";
    return `${orderNum}: ${text}`;
  };

  const getRuleIcon = (rule: IRule) => {
    if (rule.id === REVDOKU_CATCH_CHANGES_RULE_ID) return GitCompareArrows;
    if (rule.id === REVDOKU_CATCH_ALL_RULE_ID) return Sparkles;
    return rule.origin === 'user' ? Mail : ClipboardCheck;
  };

  const selectedRule = rules.find(r => r.id === selectedRuleKey);
  const isSelectedRuleEnvelopeRule = selectedRule?.origin === 'user';

  const handleSave = async () => {
    if (!message.trim()) return;
    setIsSaving(true);
    try {
      if (mode === 'create' && onCreateSave) {
        if (!isNewRule && !selectedRuleKey) return;
        if (isNewRule && !newRuleText.trim()) return;

        await onCreateSave({
          description: message.trim(),
          passed: status === 'passed',
          ...(isNewRule
            ? { new_rule_text: newRuleText.trim() }
            : { rule_key: selectedRuleKey }),
        });
      } else {
        const updates: { description?: string; rule_key?: string; passed?: boolean; rule_prompt?: string; data?: Record<string, unknown> } = {};

        if (message.trim() !== check.description) {
          updates.description = message.trim();
        }

        const originalRuleKey = getCheckRuleId(check);
        const ruleChanged = selectedRuleKey !== originalRuleKey;

        if (ruleChanged) {
          updates.rule_key = selectedRuleKey;
          const newRule = rules.find(r => r.id === selectedRuleKey);
          if (newRule) {
            updates.rule_prompt = newRule.prompt;
          }
        }

        if ((status === "passed") !== check.passed) {
          updates.passed = status === "passed";
        }

        // Check if data.val changed
        if (dataVal !== (check.data?.val || '')) {
          updates.data = { ...(check.data || {}), val: dataVal || undefined };
        }

        if (Object.keys(updates).length > 0) {
          await onSave(check.id, updates);
        }
        onCancel();
      }
    } catch (error) {
      console.error("Failed to save check:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = containerRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex flex-col gap-3 p-4 w-full flex-1"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleContainerKeyDown}
    >
      {/* Title bar with drag handle and close */}
      <div
        tabIndex={-1}
        className="flex items-center justify-between px-2 py-1.5 bg-muted rounded select-none"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleTitleBarMouseDown}
      >
        <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: checkColor || 'hsl(var(--foreground))' }}>
          <GripHorizontal className="w-4 h-4 opacity-50" />
          {checkColor && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: checkColor }} />}
          {mode === 'create' ? 'New Check' : `Check #${checkNumber}${check.page != null ? ` (Page ${check.page + 1})` : ''}`}
          {mode !== 'create' && (
            check.source === 'user'
              ? <User className="w-3.5 h-3.5 opacity-60" />
              : <Sparkles className="w-3.5 h-3.5 opacity-60" />
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Status select */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Status:</label>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as "passed" | "failed")}
          disabled={isReadOnly || isSaving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[10001]">
            <SelectItem value="passed">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                Passed
              </span>
            </SelectItem>
            <SelectItem value="failed">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Failed
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Rule select */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground">Rule:</label>
          {selectedRule && (() => {
            // User-origin rules live in the envelope's rule list — the existing
            // `onEditRule` flow opens the ChecklistDialog on the envelope tab.
            // Checklist-origin rules came from the source template — jump into
            // that template with the specific rule scrolled into view.
            const isUserRule = selectedRule.origin === 'user';
            const handler = isUserRule ? onEditRule : onEditChecklistRule;
            if (!handler) return null;
            return (
              <button
                onClick={(e) => { e.stopPropagation(); handler(selectedRuleKey); }}
                className="text-xs text-primary underline hover:text-primary/80"
              >
                {isUserRule ? 'Edit Rule' : 'Edit in source checklist'}
              </button>
            );
          })()}
        </div>
        {(rules.length > 0 || mode === 'create') && (
          <Select
            value={isNewRule ? NEW_RULE_VALUE : selectedRuleKey}
            onValueChange={(v) => {
              if (v === NEW_RULE_VALUE) {
                setIsNewRule(true);
                setSelectedRuleKey('');
                userEditedMessageRef.current = false;
                setMessageManuallyEdited(false);
              } else {
                setIsNewRule(false);
                setSelectedRuleKey(v);
              }
            }}
            disabled={isReadOnly || isSaving}
          >
            <SelectTrigger className="h-auto min-h-10 [&>span]:line-clamp-2">
              <SelectValue placeholder="Select rule" />
            </SelectTrigger>
            <SelectContent className="z-[10001]">
              <SelectItem value={NEW_RULE_VALUE} className="whitespace-normal items-start">
                <span className="line-clamp-2 text-left font-medium">+ Create New Envelope Rule:</span>
              </SelectItem>
              {rules.map((rule) => {
                const Icon = getRuleIcon(rule);
                return (
                  <SelectItem key={rule.id} value={rule.id} className="whitespace-normal items-start">
                    <span className="line-clamp-2 text-left inline-flex items-start gap-1">
                      <Icon className="w-3 h-3 shrink-0 mt-0.5 opacity-60" />
                      <span>{getRuleDisplayText(rule)}</span>
                      <EnvelopeRuleBadge
                        rule={rule}
                        envelopeRevisions={envelopeRevisions}
                        currentRevisionId={currentRevisionId}
                        compact={true}
                        className="ml-1 inline-flex align-middle"
                      />
                      {isRuleFromCurrentRevision(rule, currentRevisionId) && (
                        <span className="ml-1 inline-flex items-center px-1 py-0 text-[9px] font-semibold bg-green-100 text-green-700 rounded border border-green-200 align-middle">
                          NEW
                        </span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* View revision changes link for catch-changes checks */}
      {selectedRuleKey === REVDOKU_CATCH_CHANGES_RULE_ID && onViewRevisionChanges && (
        <button
          onClick={(e) => { e.stopPropagation(); onViewRevisionChanges(); }}
          className="text-xs text-primary inline-flex items-center gap-1"
        >
          <GitCompareArrows className="w-3.5 h-3.5" />
          View revision changes
        </button>
      )}

      {/* New rule text input — shown when isNewRule in any mode */}
      {isNewRule && (
        <textarea
          ref={newRuleTextareaRef}
          value={newRuleText}
          onChange={(e) => setNewRuleText(e.target.value)}
          placeholder="Describe the rule, e.g., Document must have valid signature"
          disabled={isReadOnly || isSaving}
          rows={2}
          className="text-sm leading-relaxed p-2 w-full border border-input rounded-md resize-none outline-none font-inherit bg-background focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
      )}

      {/* Message — uses FilePromptEditor so `#ref[...]` markers in the
          check description render as inline chips instead of raw text. */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Message:</label>
        <FilePromptEditor
          value={message}
          onChange={(v) => {
            if (mode === 'create' && isNewRule) {
              userEditedMessageRef.current = true;
              setMessageManuallyEdited(true);
            }
            setMessage(v);
          }}
          fileLookup={fileLookup}
          placeholder={isNewRule ? 'Message (auto-filled from rule)' : ''}
          readOnly={isReadOnly || isSaving}
          minHeightPx={80}
          className={mode === 'create' && isNewRule && !messageManuallyEdited && message ? 'opacity-60' : ''}
        />
      </div>

      {/* data.val input — shown when check has an extracted value */}
      {check.data?.val != null && (
        <div className="flex flex-col gap-1 relative">
          <label className="text-xs font-medium text-muted-foreground font-mono">val</label>
          <div className="relative">
            <input
              type="text"
              value={dataVal}
              onChange={(e) => setDataVal(e.target.value)}
              disabled={isReadOnly || isSaving}
              className="text-sm font-mono p-2 w-full border border-input rounded-md outline-none bg-background focus:border-ring focus:ring-1 focus:ring-ring/40 pr-7"
              onFocus={() => setValDropdownOpen(true)}
              onBlur={() => setTimeout(() => setValDropdownOpen(false), 150)}
            />
            {existingValValues && existingValValues.length > 1 && (
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                onMouseDown={(e) => { e.preventDefault(); setValDropdownOpen(!valDropdownOpen); }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5l3 3 3-3" /></svg>
              </button>
            )}
            {valDropdownOpen && existingValValues && existingValValues.length > 1 && (
              <div className="absolute left-0 top-full mt-1 w-full max-h-40 overflow-y-auto rounded-md border border-border bg-popover shadow-md z-[10002] py-1">
                {existingValValues
                  .filter(v => v !== dataVal)
                  .map(v => (
                    <button
                      key={v}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-muted text-foreground"
                      onMouseDown={(e) => { e.preventDefault(); setDataVal(v); setValDropdownOpen(false); }}
                    >
                      {v}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action row */}
      <div className={`flex items-center ${mode === 'create' ? 'justify-end' : 'justify-between'} gap-2 pt-3 border-t border-border`}>
        {mode !== 'create' && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(check.id); }}
            className="p-1 text-destructive hover:text-destructive/80"
            title="Delete check"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={(e) => { e.stopPropagation(); handleSave(); }}
            disabled={
              isReadOnly || isSaving || !message.trim() ||
              (mode === 'create' && isNewRule && !newRuleText.trim()) ||
              (mode === 'create' && !isNewRule && !selectedRuleKey)
            }
          >
            {isSaving ? "..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
