import React from "react";
import type { IChecklist, IRule, ITypedRule, IEnvelope, IEnvelopeRevision, ERuleSource } from "@revdoku/lib";
import { EnvelopeRuleBadge } from "@/components/ui/EnvelopeRuleBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const CREATE_NEW_RULE_OPTION = "-- create new envelope rule --";

interface ManualCheckDialogProps {
  open: boolean;
  inspectionReportChecklist: IChecklist | null;
  currentEnvelope: IEnvelope | null;
  currentEnvelopeRevision: IEnvelopeRevision | null;
  selectedManualCheckRule: ITypedRule | null;
  setSelectedManualCheckRule: (rule: ITypedRule | null) => void;
  isRuleDropdownOpen: boolean;
  setIsRuleDropdownOpen: (open: boolean) => void;
  newRuleText: string;
  setNewRuleText: (text: string) => void;
  manualCheckMessage: string;
  setManualCheckMessage: (message: string) => void;
  isMessageManuallyEdited: boolean;
  setIsMessageManuallyEdited: (edited: boolean) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function ManualCheckDialog({
  open,
  inspectionReportChecklist,
  currentEnvelope,
  currentEnvelopeRevision,
  selectedManualCheckRule,
  setSelectedManualCheckRule,
  isRuleDropdownOpen,
  setIsRuleDropdownOpen,
  newRuleText,
  setNewRuleText,
  manualCheckMessage,
  setManualCheckMessage,
  isMessageManuallyEdited,
  setIsMessageManuallyEdited,
  onSubmit,
  onClose,
}: ManualCheckDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="w-[500px] max-w-[95%]">
        <DialogHeader>
          <DialogTitle>Add Envelope Check</DialogTitle>
          <DialogDescription className="sr-only">
            Select a rule and provide a message for the envelope check
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="space-y-4">
            {/* Rule Selection */}
            <div>
              <label
                htmlFor="ruleSelect"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Rule <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsRuleDropdownOpen(!isRuleDropdownOpen)}
                  className="w-full p-2 border border-border rounded-md text-sm text-left bg-card text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {selectedManualCheckRule
                    ? (() => {
                      const manualRule: IRule | undefined =
                        inspectionReportChecklist?.rules?.find(
                          (r) => r.id === selectedManualCheckRule.id,
                        );
                      if (manualRule) {
                        return `#${manualRule.order + 1}: ${manualRule.prompt.length > 50 ? manualRule.prompt.substring(0, 50) + "..." : manualRule.prompt}`;
                      }
                      return CREATE_NEW_RULE_OPTION;
                    })()
                    : CREATE_NEW_RULE_OPTION}
                  <svg
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {isRuleDropdownOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {/* Create New Rule Option - First */}
                    <button
                      type="button"
                      className={`w-full p-2 hover:bg-accent cursor-pointer border-b border-border text-left ${!selectedManualCheckRule ? 'bg-accent' : ''}`}
                      onClick={() => {
                        setSelectedManualCheckRule(null);
                        setIsRuleDropdownOpen(false);
                        // Reset message auto-population when switching to new rule
                        if (!isMessageManuallyEdited) {
                          setManualCheckMessage(newRuleText ? `violates the rule: ${newRuleText}` : "");
                        }
                      }}
                    >
                      <div className="text-sm font-medium text-foreground flex items-center">
                        <span className="mr-2">+</span>
                        {CREATE_NEW_RULE_OPTION}
                      </div>
                    </button>

                    {/* Checklist Rules */}
                    {inspectionReportChecklist?.rules?.map((rule) => (
                      <button
                        type="button"
                        key={rule.id}
                        className={`w-full p-2 hover:bg-accent cursor-pointer border-b border-border last:border-b-0 text-left ${selectedManualCheckRule?.id === rule.id ? 'bg-accent' : ''}`}
                        onClick={() => {
                          setSelectedManualCheckRule({
                            ...rule,
                            type: 'checklist' as any
                          } as ITypedRule);
                          setIsRuleDropdownOpen(false);
                          // Clear message when selecting existing rule (unless manually edited)
                          if (!isMessageManuallyEdited) {
                            setManualCheckMessage("");
                          }
                        }}
                      >
                        <div className="text-sm font-medium text-foreground mb-1 flex items-center justify-between">
                          <span>Rule #{rule.order + 1}</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            Checklist
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground break-words leading-relaxed">
                          {rule.prompt}
                        </div>
                      </button>
                    ))}

                    {/* User-Created (Manual) Rules */}
                    {inspectionReportChecklist?.rules?.filter((r: any) => r.origin === 'user').map((rule) => (
                      <button
                        type="button"
                        key={rule.id}
                        className={`w-full p-2 hover:bg-accent cursor-pointer border-b border-border last:border-b-0 text-left ${selectedManualCheckRule?.id === rule.id ? 'bg-accent' : ''}`}
                        onClick={() => {
                          setSelectedManualCheckRule({
                            ...rule,
                            type: 'envelope' as any
                          } as ITypedRule);
                          setIsRuleDropdownOpen(false);
                          // Clear message when selecting existing rule (unless manually edited)
                          if (!isMessageManuallyEdited) {
                            setManualCheckMessage("");
                          }
                        }}
                      >
                        <div className="text-sm font-medium text-foreground mb-1 flex items-center justify-between">
                          <span>Rule #{rule.order + 1}</span>
                          <div className="flex items-center gap-1">
                            <EnvelopeRuleBadge
                              rule={rule}
                              envelopeRevisions={currentEnvelope?.envelope_revisions}
                              currentRevisionId={currentEnvelopeRevision?.id}
                            />
                            {/* Show NEW badge for current revision rules (EnvelopeRuleBadge returns null for these) */}
                            {rule.origin === 'user' && (rule as any).source_envelope_revision_id === currentEnvelopeRevision?.id && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                NEW
                              </span>
                            )}
                            {/* Fallback: Show "Envelope" badge when source_envelope_revision_id is missing */}
                            {rule.origin === 'user' && !(rule as any).source_envelope_revision_id && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-700">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                </svg>
                                Envelope
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground break-words leading-relaxed">
                          {rule.prompt}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* New Rule Text - Only shown when creating new rule */}
            {!selectedManualCheckRule && (
              <div>
                <label
                  htmlFor="newRuleText"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  New Envelope Rule Text <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="newRuleText"
                  rows={2}
                  className="w-full p-2 border border-border rounded-md bg-background text-foreground"
                  placeholder="e.g., Document must have valid signature"
                  value={newRuleText}
                  onChange={(e) => {
                    setNewRuleText(e.target.value);
                    // Auto-populate message unless manually edited
                    if (!isMessageManuallyEdited && e.target.value) {
                      setManualCheckMessage(`violates the rule: ${e.target.value}`);
                    }
                  }}
                  autoFocus
                />
              </div>
            )}

            {/* Message Field */}
            <div>
              <label
                htmlFor="message"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Message {selectedManualCheckRule ? <span className="text-red-500">*</span> : "(auto-generated / editable)"}
              </label>
              <textarea
                id="message"
                rows={3}
                className="w-full p-2 border border-border rounded-md bg-background text-foreground"
                placeholder={selectedManualCheckRule
                  ? "Describe what's wrong at this location..."
                  : "Auto-generated from rule text (click to customize)"}
                value={manualCheckMessage}
                onChange={(e) => {
                  setManualCheckMessage(e.target.value);
                }}
                onFocus={() => {
                  // Mark as manually edited when user focuses the field
                  setIsMessageManuallyEdited(true);
                }}
              />
              {!selectedManualCheckRule && !isMessageManuallyEdited && (
                <p className="text-xs text-muted-foreground mt-1">
                  Click to customize the message
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <button
              type="button"
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-accent"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              disabled={
                !manualCheckMessage.trim() ||
                (!selectedManualCheckRule && !newRuleText.trim())
              }
            >
              Add Check
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
