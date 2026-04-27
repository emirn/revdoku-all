import { IRule, IEnvelopeRevision } from '@revdoku/lib';
import { Mail } from 'lucide-react';
import { getRevisionInfoForRule, isRuleFromPreviousRevision } from '@/lib/rule-utils';

interface EnvelopeRuleBadgeProps {
  rule: IRule;
  envelopeRevisions?: IEnvelopeRevision[];
  currentRevisionId?: string;
  /**
   * When true, shows only the icon with a tooltip.
   * When false (default), shows full badge with "Rev N (X ago)" text.
   */
  compact?: boolean;
  /**
   * When true, shows time ago in the badge.
   * Default is true.
   */
  showTimeAgo?: boolean;
  /**
   * Additional CSS classes to apply to the badge.
   */
  className?: string;
}

/**
 * EnvelopeRuleBadge displays an envelope icon with revision info for user-created rules
 * (envelope rules) from previous revisions.
 *
 * Display logic:
 * - Only shows for rules with origin === 'user'
 * - Only shows for rules from PREVIOUS revisions (not current)
 * - Current revision rules should show "NEW" badge instead (handled elsewhere)
 *
 * Visual design:
 * - Uses Mail icon to indicate envelope rule
 * - Teal color scheme to distinguish from other badges
 * - Shows "Rev N" with optional "(X ago)" suffix
 */
export function EnvelopeRuleBadge({
  rule,
  envelopeRevisions,
  currentRevisionId,
  compact = false,
  showTimeAgo = true,
  className = '',
}: EnvelopeRuleBadgeProps) {
  // Only show badge for user rules from previous revisions
  if (!isRuleFromPreviousRevision(rule, currentRevisionId)) {
    return null;
  }

  const revisionInfo = getRevisionInfoForRule(rule, envelopeRevisions);

  // If we can't determine revision info, don't show the badge
  if (!revisionInfo) {
    return null;
  }

  const { revisionNumber, timeAgo } = revisionInfo;

  // Build the display text
  const revText = `Rev ${revisionNumber}`;
  const fullText = showTimeAgo && timeAgo ? `${revText} (${timeAgo})` : revText;
  const tooltipText = `User-added rule from Revision ${revisionNumber}${timeAgo ? ` (${timeAgo})` : ''}`;

  if (compact) {
    // Compact mode: icon only with tooltip
    return (
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 ${className}`}
        title={tooltipText}
      >
        <Mail className="w-3 h-3" />
      </span>
    );
  }

  // Full badge with text
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-700 ${className}`}
      title={tooltipText}
    >
      <Mail className="w-3 h-3" />
      <span>{fullText}</span>
    </span>
  );
}

export default EnvelopeRuleBadge;
