import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tsconfig = require('./tsconfig.json');

const startingDir = tsconfig.compilerOptions.outDir;

function resolveImportsInFolder(folder) {
  fs.readdirSync(folder, {
    withFileTypes: true,
  }).forEach((fileOrFolder) => {
    if (fileOrFolder.isFile() && fileOrFolder.name.endsWith('.js')) {
      let fileContent = fs.readFileSync(path.resolve(folder, fileOrFolder.name)).toString();

      // Add .js extensions to relative imports that don't have them
      // Matches: import ... from './path' or import ... from "../path"
      // But NOT: import ... from './path.js' or import ... from 'package-name'
      fileContent = fileContent.replace(
        /from\s+['"](\.\/.+?|\.\.\/.+?)['"];/g,
        (match, importPath) => {
          // Don't add .js if it already has an extension
          if (importPath.match(/\.\w+$/)) {
            return match;
          }
          // Add .js extension
          return match.replace(importPath, importPath + '.js');
        }
      );

      // Handle export ... from statements
      fileContent = fileContent.replace(
        /export\s+.*?\s+from\s+['"](\.\/.+?|\.\.\/.+?)['"];/g,
        (match, importPath) => {
          // Don't add .js if it already has an extension
          if (importPath.match(/\.\w+$/)) {
            return match;
          }
          // Add .js extension
          return match.replace(importPath, importPath + '.js');
        }
      );

      fs.writeFileSync(`${folder}/${fileOrFolder.name}`, fileContent);
    } else if (fileOrFolder.isDirectory()) {
      resolveImportsInFolder(`${folder}/${fileOrFolder.name}`);
    }
  });
}

resolveImportsInFolder(startingDir);
console.log('✓ Import extensions resolved');
