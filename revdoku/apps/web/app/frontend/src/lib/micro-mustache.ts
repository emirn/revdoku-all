/**
 * Minimal Mustache-like template renderer. No dependencies.
 * Supports: {{var}}, {{nested.var}}, {{#each items}}...{{/each}}, {{#if var}}...{{else}}...{{/if}}
 */

function resolve(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((o: any, k) => o?.[k], obj);
}

function renderSection(template: string, data: Record<string, unknown>): string {
  let result = template;

  // {{#each key}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w[\w.]*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, key, inner) => {
      const arr = resolve(data, key);
      if (!Array.isArray(arr)) return '';
      return arr.map((item: any) => {
        const ctx = typeof item === 'object' && item !== null ? { ...data, ...item } : { ...data, '.': item };
        return renderSection(inner, ctx);
      }).join('');
    }
  );

  // {{#if key}}...{{else}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w[\w.]*)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_, key, ifBlock, elseBlock) => {
      const val = resolve(data, key);
      return val ? renderSection(ifBlock, data) : renderSection(elseBlock || '', data);
    }
  );

  // {{var}}
  result = result.replace(/\{\{(\w[\w.]*)\}\}/g, (_, key) => {
    const val = resolve(data, key);
    return val != null ? String(val) : '';
  });

  return result;
}

export function renderMustache(template: string, data: Record<string, unknown>): string {
  return renderSection(template, data);
}
