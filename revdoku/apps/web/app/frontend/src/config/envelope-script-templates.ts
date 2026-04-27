import templatesMd from './envelope-script-templates.md?raw';

export interface ScriptTemplate {
  id: string;
  title: string;
  description: string;
  code: string;     // merged: script_template variable + JS code
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractTag(text: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = text.match(re);
  return match ? match[1].trim() : '';
}

/**
 * Parse the markdown templates file.
 * Format: `# Title`, description lines, `<script>...merged code...</script>`.
 */
function parseTemplates(md: string): ScriptTemplate[] {
  const templates: ScriptTemplate[] = [];
  const sections = md.split(/^# /m).filter(Boolean);

  for (const section of sections) {
    const newlineIdx = section.indexOf('\n');
    if (newlineIdx === -1) continue;
    const title = section.slice(0, newlineIdx).trim();
    const body = section.slice(newlineIdx + 1);

    // Description = text between title and first <script> tag
    const scriptTagIdx = body.indexOf('<script>');
    const description = scriptTagIdx > 0
      ? body.slice(0, scriptTagIdx).trim()
      : '';

    const code = extractTag(body, 'script');
    if (title && code) {
      templates.push({ id: slugify(title), title, description, code });
    }
  }

  return templates;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = parseTemplates(templatesMd).sort((a, b) => a.title.localeCompare(b.title));
