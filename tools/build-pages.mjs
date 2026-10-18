// Copies the interface into docs/app/ for the web version on GitHub Pages:
//   node tools/build-pages.mjs
// The web version is the same interface; it finds the Windows app (or `node serve.mjs`) running on this computer at
// http://localhost:3401-3421 and links to it (serve.mjs answers that origin's GET /api/health only).
// The published page also gets the visitor counter of the GitHub Pages site (GoatCounter: no cookies, no personal
// data); public/index.html, served by the app on the user's computer, stays without it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'app');
const COUNTER = '<script data-goatcounter="https://esem-mplus.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>\n';

await fs.rm(OUT, { recursive: true, force: true });
await fs.cp(path.join(ROOT, 'public'), OUT, { recursive: true });
await fs.mkdir(path.join(OUT, 'data'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'data', 'sample.csv'), path.join(OUT, 'data', 'sample.csv'));
const index = path.join(OUT, 'index.html');
const html = await fs.readFile(index, 'utf8');
if (!html.includes('</body>')) throw new Error('public/index.html has no </body>');
await fs.writeFile(index, html.replace('</body>', `${COUNTER}</body>`));
const files = await fs.readdir(OUT, { recursive: true });
console.log(`docs/app/ written (${files.length} entries, with the visitor counter)`);
