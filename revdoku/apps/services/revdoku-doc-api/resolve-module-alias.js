import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

// Adds explicit `.js` extensions to relative imports / re-exports in the
// emitted build/. Required because `"type": "module"` makes Node ESM, and
// Node ESM rejects `from './foo'` at runtime — it needs `from './foo.js'`.
// tsc with `"module": "ES2020"` doesn't add the extension itself.
//
// To eliminate this script later, switch the tsconfig to either
// `"module": "nodenext"` (write `.js` in source) or
// `"rewriteRelativeImportExtensions": true` (TS 5.7+, write `.ts` in source).

const require = createRequire(import.meta.url);
const tsconfig = require('./tsconfig.json');
const startingDir = tsconfig.compilerOptions.outDir;

const RELATIVE_IMPORT_RE = /(from\s+['"])(\.\/[^'"]+|\.\.\/[^'"]+)(['"])/g;
const RELATIVE_EXPORT_RE = /(export\s+[^;]*?from\s+['"])(\.\/[^'"]+|\.\.\/[^'"]+)(['"])/g;

function addJsExtension(_match, prefix, importPath, suffix) {
  if (importPath.match(/\.\w+$/)) return _match;
  return `${prefix}${importPath}.js${suffix}`;
}

function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const src = fs.readFileSync(full, 'utf8');
    const out = src
      .replace(RELATIVE_IMPORT_RE, addJsExtension)
      .replace(RELATIVE_EXPORT_RE, addJsExtension);
    if (out !== src) fs.writeFileSync(full, out);
  }
}

walk(startingDir);
console.log('✓ Import extensions resolved');
