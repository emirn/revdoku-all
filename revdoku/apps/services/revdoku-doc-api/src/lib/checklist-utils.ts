import { ICheck, IRule, IChecklist, IReport, createNewRule, IEnvelope, IPageText } from "@revdoku/lib";
import { safeStringify } from './logger';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeUserInput } from './prompt-sanitizer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __checklist_filename = fileURLToPath(import.meta.url);
const __checklist_dirname = path.dirname(__checklist_filename);
const PROMPTS_DIR = path.join(__checklist_dirname, "prompts");

// Description format spec: see prompts/catch-changes_README.md
const CATCH_CHANGES_PROMPT_FILE = "catch-changes.md";
const CATCH_CHANGES_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, CATCH_CHANGES_PROMPT_FILE), 'utf8').trim();

// TEMPLATES for checklist generatin for AI prompt for inspection
// now we also adding ISimplifiedRule based prev failed Checks which are not related to any rule
const FAILED_CHECK_ADDON_TEMPLATE =
  "IMPORTANT: In the previous version of this document, this rule FAILED at the following locations. " +
  "For EACH location below, you MUST add a SEPARATE entry to the checks array for this rule, " +
  "verifying whether the issue is now fixed. Prefix each such entry's description with '#recheck '. " +
  "Previously failed: {{LOCATION}}.";
const PASSED_CHECK_ADDON_TEMPLATE = "Also, please review these locations that previously passed: {{LOCATION}}.";

const PASSED_CHECK_SINGLE_LOCATION_TEMPLATE = "page #{{PAGE_NUMBER}} at x1={{X1}},y1={{Y1}},x2={{X2}},y2={{Y2}} was marked as passed with the message: <msg>{{MESSAGE}}</msg>";
const FAILED_CHECK_SINGLE_LOCATION_TEMPLATE = "page #{{PAGE_NUMBER}} at x1={{X1}},y1={{Y1}},x2={{X2}},y2={{Y2}} failed with the message: <msg>{{MESSAGE}}</msg>";


export function mergeRulePromptWithChecks(
  {
    rule
  }: {
    rule: IRule,
  }): string {
  // externding prompt with failed checks for the rule
  if (!rule.checks || rule.checks.length == 0) {
    return rule.prompt;
  }

  // generating prompt addon for the rule that includes failed checks for this rule in previous revision
  const promptAddon = rule.checks.map((check: ICheck) => {
    return (check.passed ? PASSED_CHECK_ADDON_TEMPLATE : FAILED_CHECK_ADDON_TEMPLATE)
      .replace(
        '{{LOCATION}}',
        // collect all locations that previously failed for the rule
        rule.checks.map(
          (check: ICheck) =>
            (check.passed ? PASSED_CHECK_SINGLE_LOCATION_TEMPLATE : FAILED_CHECK_SINGLE_LOCATION_TEMPLATE)
              .replace('{{X1}}', check.x1.toString())
              .replace('{{Y1}}', check.y1.toString())
              .replace('{{X2}}', check.x2.toString())
              .replace('{{Y2}}', check.y2.toString())
              .replace('{{PAGE_NUMBER}}', (check.page + 1).toString())
              .replace('{{MESSAGE}}', sanitizeUserInput(check.description))
        )
          .join(', ') // join with comma to make it more readable
      );
  }).join(', ');

  if (promptAddon.length > 0 && promptAddon.includes('{{') && promptAddon.includes('}}')) {
    const msg = `Prompt addon contains unreplaced variables. Prompt addon: ${promptAddon}. Source rule: ${JSON.stringify(rule, null, 2)}`;
    throw new Error(msg);
  }

  // finally extending the original prompt 
  return `${rule.prompt}. ${promptAddon}`;

}

// templates for creating rules from manual checks
const MANUAL_FAILED_CHECK_PROMPT_TEMPLATE = `Ensure that this issue was fixed: {{MESSAGE}}`;
const MANUAL_PASSED_CHECK_PROMPT_TEMPLATE = `Ensure that this issue stays fixed: {{MESSAGE}}`;


function getChecksGroupedByRuleExternalId(checks: ICheck[]): Record<string, ICheck[]> {
  const groupedChecks: Record<string, ICheck[]> = {};
  for (const check of checks) {
    if (!check.rule_id) {
      continue;
    }
    if (!groupedChecks[check.rule_id]) {
      groupedChecks[check.rule_id] = [];
    }
    groupedChecks[check.rule_id].push(check);
  }

  console.debug("groupedChecks", safeStringify(groupedChecks));
  return groupedChecks;
}

function getOrphanedChecks(checks: ICheck[]): ICheck[] {
  const orphanedChecks: ICheck[] = [];


  for (const check of checks) {
    if (!check.rule_id) {
      orphanedChecks.push(check);
    }
  }

  return orphanedChecks;
}

function getUniqueChecks(checks: ICheck[]): ICheck[] {
  const uniqueChecks: ICheck[] = [];

  for (const check of checks) {
    // A check is considered a duplicate if either:
    // 1. It has the same id as an existing check, OR
    // 2. It has the same location (page + coordinates) and message as an existing check
    const isDuplicate = uniqueChecks.some(existingCheck =>
      // Same id = definitely duplicate
      existingCheck.id === check.id ||
      // Same location + message = likely duplicate (e.g., manual checks, regenerated checks)
      (existingCheck.page === check.page &&
        existingCheck.x1 === check.x1 &&
        existingCheck.y1 === check.y1 &&
        existingCheck.x2 === check.x2 &&
        existingCheck.y2 === check.y2 &&
        existingCheck.description === check.description)
    );

    if (!isDuplicate) {
      uniqueChecks.push(check);
    }
  }

  return uniqueChecks;
}


// Re-exported from shared schemas — single source of truth
import { REVDOKU_CATCH_CHANGES_RULE_ID, REVDOKU_CATCH_ALL_RULE_ID } from '@revdoku/lib';
export { REVDOKU_CATCH_CHANGES_RULE_ID, REVDOKU_CATCH_ALL_RULE_ID };

export function createVirtualChecklistForAI(
  {
    checklist,
    previous_report_checks,
    envelope_checklist,
    previous_page_texts,
  }: {
    checklist?: IChecklist,
    previous_report_checks?: ICheck[],
    envelope_checklist?: IChecklist,
    previous_page_texts?: IPageText[],
  }): IChecklist {
  // Filter out catch-changes checks from previous report — they reference a stale diff
  // and will be regenerated fresh from previous_page_texts vs current document
  if (previous_report_checks && previous_report_checks.length > 0) {
    previous_report_checks = previous_report_checks.filter(
      c => c.rule_id !== REVDOKU_CATCH_CHANGES_RULE_ID
    );
  }

  // Add a null check for previousReport and previousReport.checks
  if (
    !previous_report_checks || previous_report_checks.length === 0
  ) {
    console.debug('No previous report or checks found, returning checklist if available');

    const effectiveChecklist = checklist || envelope_checklist;
    if (!effectiveChecklist) {
      throw new Error('No checklist or envelope_checklist provided');
    }

    // Still need to append catch-changes change detection rule when track_changes is on
    // and previous page texts are available (e.g., empty checklist used for change-only inspection)
    const trackChanges = effectiveChecklist.track_changes === true;
    if (trackChanges && previous_page_texts && previous_page_texts.length > 0) {
      const todayDateString = new Date().toISOString().split('T')[0];
      const catchAllRule: IRule = {
        id: REVDOKU_CATCH_CHANGES_RULE_ID,
        prompt: CATCH_CHANGES_PROMPT,
        order: effectiveChecklist.rules?.length || 0,
        origin: 'system',
        created_at: todayDateString,
        updated_at: todayDateString,
      };
      console.debug(`createVirtualChecklistForAI: appended catch-changes rule to early return (${previous_page_texts.length} previous pages)`);
      return {
        ...effectiveChecklist,
        rules: [...(effectiveChecklist.rules || []), catchAllRule],
      };
    }

    return effectiveChecklist;
  }

  console.debug('checklist', safeStringify(checklist));

  /* // commented out because we now use all checks including passed + failed from previous reports

  // get all checks we should use from the previous report
  const previous_report_checks: ICheck[] = previousReport?.checks.filter(
    (c: ICheck) => 
      // always include all non-manual failed checks
      (!c.passed && !isManualRuleExternalId(c.rule_id)) 
     // include manual checks all (includePassedManualChecks) or only failed (includePassedManualChecks === false but check is failed)
    || (isManualRuleExternalId(c.rule_id) && (recheckPassedManualChecks || !c.passed))
  );

  */

  console.debug('previous_report_checks', safeStringify(previous_report_checks));

  // now we group all checks by rule_id
  const previous_report_checksGroupedByRuleId: Record<string, ICheck[]> = getChecksGroupedByRuleExternalId(
    previous_report_checks
  );

  // checks without rule_id are orphaned checks
  const orphanedChecks: ICheck[] = getOrphanedChecks(previous_report_checks);


  // return original checklist if we have no previous failed checks
  if (Object.keys(previous_report_checksGroupedByRuleId).length === 0 && orphanedChecks.length === 0) {
    console.debug('No previous failed checks found, returning original checklist');

    // If we have a checklist, return it
    if (checklist) {
      return checklist;
    }

    // If no checklist but we have envelope_checklist, return it
    if (envelope_checklist) {
      return envelope_checklist;
    }

    // If we don't have either, throw an error
    throw new Error('No checklist or envelope_checklist provided');
  }

  // making a copy of the original rules
  const newRules: IRule[] = [
    ...(checklist?.rules || []),
    ...(envelope_checklist?.rules || []) // Convert envelope rules to checklist rules
  ];

  const todayDateString = new Date().toISOString();

  // Track which rule_ids from previous report were matched (consumed)
  const consumedRuleIds = new Set<string>();

  // process every of the previously failed checks
  // we go from the last to the first to avoid duplicates
  for (const rule of newRules) {

    // checks grouped by the original rule id from the previous revision
    // Primary match: by rule.id; fallback: by rule.source_rule_id (cross-snapshot matching)
    const matchedById = previous_report_checksGroupedByRuleId[rule.id];
    const matchedBySourceId = rule.source_rule_id
      ? previous_report_checksGroupedByRuleId[rule.source_rule_id]
      : undefined;
    const checks = matchedById || matchedBySourceId;

    // externding prompt with failed checks for the rule
    if (checks && checks.length > 0) {
      // adding new checks to the previous checks
      rule.checks = getUniqueChecks([...(rule.checks || []), ...checks]);
      if (matchedById) consumedRuleIds.add(rule.id);
      if (matchedBySourceId && rule.source_rule_id) consumedRuleIds.add(rule.source_rule_id);
    }

    // now set parentId as previous id
    //rule.previous_revision_id = rule.id;
    // update id to the new one
    //rule.id = uuidv4();
    // set new created and updated dates
    rule.created_at = todayDateString;
    rule.updated_at = todayDateString;
  } // for

  // Collect unmatched checks: have rule_id but didn't match any current rule by ID or source_rule_id
  const unmatchedChecks: ICheck[] = [];
  for (const [ruleId, checks] of Object.entries(previous_report_checksGroupedByRuleId)) {
    if (!consumedRuleIds.has(ruleId)) {
      unmatchedChecks.push(...checks);
    }
  }

  // Combine orphaned checks (no rule_id) and unmatched checks (have rule_id but no matching rule)
  // Both need to become new rules for continuous inspection
  const allChecksNeedingNewRules: ICheck[] = [...orphanedChecks, ...unmatchedChecks];

  // now adding orphaned/unmatched checks as new rules
  // for each check we add a separate new rule
  for (let ii: number = allChecksNeedingNewRules.length - 1; ii >= 0; ii--) {
    const check = allChecksNeedingNewRules[ii];

    // Use the check's rule_prompt if available (from unmatched checks that had a rule),
    // otherwise generate a prompt from the check message
    const prompt: string = check.rule_prompt
      ? sanitizeUserInput(check.rule_prompt)
      : check.passed
        ? MANUAL_PASSED_CHECK_PROMPT_TEMPLATE.replace('{{MESSAGE}}', sanitizeUserInput(check.description))
        : MANUAL_FAILED_CHECK_PROMPT_TEMPLATE.replace('{{MESSAGE}}', sanitizeUserInput(check.description));

    // Get the checklist prefix ID for generating proper rule ID
    const checklistPrefixId = newRules.length > 0 && newRules[0].id ?
      newRules[0].id.split('_rule_')[0] : 'unknown_checklist';

    const newRule: IRule = createNewRule(checklistPrefixId, newRules.length);
    newRule.prompt = prompt;
    newRule.order = newRules.length;

    // now we set rule_id to the new rule
    check.rule_id = newRule.id;
    // now we set checks to the new rule
    newRule.checks = [check];
    // finally adding new rule to the merged checklist
    newRules.push(newRule);
  } // for



  // Append synthetic catch-changes change detection rule when:
  // 1. track_changes is enabled on the checklist (default true)
  // 2. previous_page_texts are available (meaning revision N>0)
  const trackChanges = checklist?.track_changes === true;
  if (trackChanges && previous_page_texts && previous_page_texts.length > 0) {
    const catchAllRule: IRule = {
      id: REVDOKU_CATCH_CHANGES_RULE_ID,
      prompt: CATCH_CHANGES_PROMPT,
      order: newRules.length,
      origin: 'system',
      created_at: todayDateString,
      updated_at: todayDateString,
    };
    newRules.push(catchAllRule);
    console.debug(`createVirtualChecklistForAI: appended catch-changes rule (${previous_page_texts.length} previous pages)`);
  }

  // create new merged checklist
  const todayDate = new Date().toISOString();
  const mergedChecklist: IChecklist = {
    id: uuidv4(),
    name: `${checklist?.name || envelope_checklist?.name || 'Checklist'} (merged)`,
    created_at: checklist?.created_at || envelope_checklist?.created_at || todayDate,
    updated_at: todayDate,
    rules: [...newRules],
    track_changes: trackChanges,
  };

  console.debug("mergedChecklist", safeStringify(mergedChecklist));

  // return the merged checklist
  return mergedChecklist;
}