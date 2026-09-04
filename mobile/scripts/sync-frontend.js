import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../../frontend');
const destDir = path.resolve(__dirname, '../www');

console.log(`[sync-frontend] Copying frontend files from ${srcDir} to ${destDir}...`);

if (!fs.existsSync(srcDir)) {
  console.error(`[sync-frontend] Error: source directory ${srcDir} does not exist.`);
  process.exit(1);
}

// Clean and recreate destination
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir, { recursive: true });

// Recursive copy
function copyFolderSync(from, to) {
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyFolderSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyFolderSync(srcDir, destDir);
console.log('[sync-frontend] Frontend synchronized to mobile/www successfully.');
