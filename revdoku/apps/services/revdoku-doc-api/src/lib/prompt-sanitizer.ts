/**
 * Sanitizes user-supplied input before it is inserted into AI prompts.
 * Defense-in-depth: strips template variable patterns and XML-style tags
 * that could be used to escape delimiter boundaries or inject fake sections.
 *
 * Applied to: rule prompts, check descriptions, source_text, document metadata,
 * checklist system_prompt, checklist_name.
 */
export function sanitizeUserInput(text: string): string {
  if (!text) return text;
  let sanitized = text;

  // Strip template variable patterns like {{CHECKLIST}}, {{TEXT}}, etc.
  // Users should never include these — they are internal prompt placeholders.
  sanitized = sanitized.replace(/\{\{[^}]+\}\}/g, '');

  // Strip XML tags matching our prompt delimiter conventions: <user_*> and <system>.
  // This prevents boundary escape attacks without destroying legitimate content
  // (HTML, <msg> from our own templates, math expressions like x<y, etc.)
  sanitized = sanitized.replace(/<\/?(?:user_\w+|system)\b[^>]*>/gi, '');

  return sanitized;
}
