import { IRule, IEnvelopeRevision, getDateTimeAgoAsHumanString, REVDOKU_CATCH_CHANGES_RULE_ID, REVDOKU_CATCH_ALL_RULE_ID, CheckType, getCheckTypes } from '@revdoku/lib';

export { REVDOKU_CATCH_CHANGES_RULE_ID, REVDOKU_CATCH_ALL_RULE_ID };

/** Display metadata for the catch-changes rule when it's not in the snapshot checklist */
export const CATCH_CHANGES_RULE_DISPLAY: IRule = {
  id: REVDOKU_CATCH_CHANGES_RULE_ID,
  prompt: 'Document Change Review: Flag document changes not covered by other rules',
  origin: 'system',
  order: 9999,
};

/** Display metadata for the catch-all fallback rule (orphaned checks with no matching rule) */
export const CATCH_ALL_RULE_DISPLAY: IRule = {
  id: REVDOKU_CATCH_ALL_RULE_ID,
  prompt: 'Additional findings not matched to a specific rule',
  origin: 'system',
  order: 10000,
};

/** Check if a check belongs to the catch-changes change detection rule */
export function isCatchChangesCheck(check: { passed: boolean; rule_id?: string }): boolean {
  return getCheckTypes(check).has(CheckType.CHANGE);
}

export interface RevisionInfo {
  revisionNumber: number;
  timeAgo: string | null;
}

/**
 * Gets revision info for a user-created rule (envelope rule).
 * Returns revision number and time ago, or null if not applicable.
 *
 * @param rule - The rule to check
 * @param envelopeRevisions - Array of envelope revisions to lookup the source revision
 * @returns RevisionInfo with revisionNumber (1-indexed) and timeAgo, or null if:
 *          - Rule is not a user rule (origin !== 'user')
 *          - Rule has no source_envelope_revision_id
 *          - Source revision not found
 */
export function getRevisionInfoForRule(
  rule: IRule,
  envelopeRevisions?: IEnvelopeRevision[]
): RevisionInfo | null {
  // Only show for user-created rules (envelope rules)
  if (rule.origin !== 'user') {
    return null;
  }

  // Must have a source envelope revision ID
  const sourceRevisionId = (rule as any).source_envelope_revision_id;
  if (!sourceRevisionId) {
    return null;
  }

  // Try to find the source revision
  const sourceRevision = envelopeRevisions?.find(
    (rev) => rev.id === sourceRevisionId
  );

  if (!sourceRevision) {
    return null;
  }

  // Calculate 1-indexed revision number (revision_number is 0-indexed)
  const revisionNumber = (sourceRevision.revision_number ?? 0) + 1;

  // Calculate time ago from rule creation or revision creation
  let timeAgo: string | null = null;
  const dateToUse = rule.created_at || sourceRevision.created_at;
  if (dateToUse) {
    timeAgo = getDateTimeAgoAsHumanString(dateToUse);
  }

  return {
    revisionNumber,
    timeAgo,
  };
}

/**
 * Checks if a rule is from the current revision.
 * Used to determine if "NEW" badge should be shown instead of revision badge.
 *
 * @param rule - The rule to check
 * @param currentRevisionId - The current envelope revision ID
 * @returns true if rule is a user rule from the current revision
 */
export function isRuleFromCurrentRevision(
  rule: IRule,
  currentRevisionId?: string
): boolean {
  if (rule.origin !== 'user') {
    return false;
  }
  const sourceRevisionId = (rule as any).source_envelope_revision_id;
  return sourceRevisionId === currentRevisionId;
}

/**
 * Checks if a rule is a user-created rule (envelope rule) from a previous revision.
 * This is the primary condition for showing the EnvelopeRuleBadge.
 *
 * @param rule - The rule to check
 * @param currentRevisionId - The current envelope revision ID
 * @returns true if rule is a user rule NOT from the current revision
 */
export function isRuleFromPreviousRevision(
  rule: IRule,
  currentRevisionId?: string
): boolean {
  if (rule.origin !== 'user') {
    return false;
  }
  const sourceRevisionId = (rule as any).source_envelope_revision_id;
  // Must have a source revision ID and it must be different from current
  return !!sourceRevisionId && sourceRevisionId !== currentRevisionId;
}
