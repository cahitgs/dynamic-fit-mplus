// Copies the interface into docs/app/ for the web version on GitHub Pages:
//   node tools/build-pages.mjs
// The web version is the same interface; it finds the Windows app (or `node serve.mjs`) running on this computer at
// http://localhost:3401-3421 and uses it to run Mplus and to keep the projects (serve.mjs allows that origin).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'app');

await fs.rm(OUT, { recursive: true, force: true });
await fs.cp(path.join(ROOT, 'public'), OUT, { recursive: true });
await fs.mkdir(path.join(OUT, 'data'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'data', 'sample.csv'), path.join(OUT, 'data', 'sample.csv'));
const files = await fs.readdir(OUT, { recursive: true });
console.log(`docs/app/ written (${files.length} entries)`);
