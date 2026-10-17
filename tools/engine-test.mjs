// Self-test of Dynamic Fit for Mplus — the DFI engine (public/lib/dfi.js) and the local Mplus adapter.
// No server or browser needed.
//   node tools/engine-test.mjs                 (or: npm run engine-test)
//   node tools/engine-test.mjs --dir=<folder>  work in this folder instead of a new temp folder
//   node tools/engine-test.mjs --keep          keep the test folders (default: delete them afterwards)
//   node tools/engine-test.mjs --quick         skip the 500-replication reference simulation
// Checks:
//   1. Pure JavaScript: misspecification rules against dynamic::multi_add_hier for the A-SAGS model of
//      Boivin et al. (2026); quantiles (type 7) and the CFI formula; the CFA input of the sample data.
//   2. Mplus: the CFA of data/sample.csv (WLSMV, second order) in an ASCII folder, in a folder whose name has
//      spaces and Turkish letters, and through the ASCII temp-copy fallback; the outputs must agree.
//   3. Mplus: the reference DFI of the A-SAGS hand-entry example (continuous ML, 500 replications, N = 492)
//      must reproduce the cutoffs validated against the R package (same seeds → identical Mplus results).
//   4. Mplus: a short ordinal (WLSMV) DFI from the sample CFA (50 replications) must complete.
// Exit code 1 when a check fails; without Mplus only the JavaScript checks run.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectMplus, runEngine } from '../engines.mjs';
import { parseTable, toMplusDat } from '../public/lib/data.js';
import { buildCfaInp } from '../public/lib/mplus.js';
import * as D from '../public/lib/dfi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const KEEP = process.argv.includes('--keep');
const QUICK = process.argv.includes('--quick');
const BASE = path.resolve(arg('dir') || path.join(os.tmpdir(), `dfi-engine-test-${Date.now().toString(36)}`));
const pad = (s, n) => String(s).padEnd(n);

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);
const check = (cond, msg) => (cond ? pass : fail)(msg);

console.log('Dynamic Fit for Mplus — engine self-test');
console.log(`Node ${process.version} · ${process.platform} · test folder: ${BASE}\n`);

// ---------- 1. JavaScript ----------
console.log('DFI engine (JavaScript)');
const ASAGS = { ...D.parseStdModel(`MGA BY ga1*.748 ga4*.848 ga7*.833 ga10*.950 ga13*.856;
SRGA BY ga2*.942 ga5*.953 ga8*.906 ga11*.956;
NGA BY ga3*.890 ga6*.956 ga9*.962 ga12*.951;
GA BY MGA*.833 SRGA*.880 NGA*.912;`), n: 492, fit: { cfi: 0.975, rmsea: 0.171, srmr: 0.049 } };
const planA = D.planDfi(ASAGS, { dataType: 'continuous', estimator: 'ML' });
check(planA.type === 'hier' && planA.levels.length === 2, `A-SAGS: higher-order model with 2 levels (got ${planA.type}, ${planA.levels.length})`);
const ms = planA.misspec.map((m) => `${m.target} BY ${m.item} ${m.magnitude.toFixed(4)}`).join('; ');
check(ms === 'NGA BY GA1 0.2902; SRGA BY GA3 0.1265', `misspecifications match dynamic::multi_add_hier (${ms})`);
check(planA.files.length === 6 && planA.files.every((f) => f.text.split('\n').every((l) => l.length <= 90 && /^[\x00-\x7f]*$/.test(l))), 'six Mplus inputs, ASCII, lines ≤ 90 characters');
check(Math.abs(D.quantile([1, 2, 3, 4, 10], 0.95) - 8.8) < 1e-12, 'quantile type 7');
check(Math.abs(D.cfiOf(13.392, 8, 302.029, 15) - 0.98121) < 1e-4, 'CFI from model and baseline chi-squares (Mplus: .981)');
const one = { ...D.parseStdModel('F =~ .42*x1 + .21*x2 + .20*x3 + .85*x4 + .85*x5 + .84*x6'), n: 301 };
const p1 = D.planDfi(one, {});
check(p1.type === 'one' && p1.levels.map((l) => l.addRcov.length).join(',') === '1,2,3', `one-factor model: 1, 2, 3 residual correlations (got ${p1.levels.map((l) => l.addRcov.length).join(',')})`);

const csvText = await fs.readFile(path.join(ROOT, 'data', 'sample.csv'), 'utf8');
const table = parseTable(csvText);
const items = table.columns.filter((c) => c !== 'ID');
const sampleSpec = {
  title: 'Sample goal attainment - engine test', dataFile: 'data.dat', names: items, missing: -999, estimator: 'WLSMV', categorical: true,
  factors: [{ name: 'MAS', items: items.filter((c) => c.startsWith('MAS')) }, { name: 'SELF', items: items.filter((c) => c.startsWith('SELF')) }, { name: 'NORM', items: items.filter((c) => c.startsWith('NORM')) }],
  second: { name: 'GOAL' }, meta: { test: true },
};
const cfaText = buildCfaInp(sampleSpec);
check(cfaText.split('\n').every((l) => l.length <= 90 && /^[\x00-\x7f]*$/.test(l)) && /CATEGORICAL =/.test(cfaText) && /GOAL BY MAS SELF NORM;/.test(cfaText), 'CFA input of the sample data (ordinal, second order)');

// ---------- Mplus ----------
const info = await detectMplus();
console.log(`\nMplus: ${info.ok ? `${info.version}  ${info.path}${info.asciiWorkaround ? '  (non-ASCII folders → ASCII temp copy)' : ''}` : `not available — ${info.error}`}`);
if (!info.ok) {
  if (info.path || process.env.MPLUS_PATH) fail(`Mplus is installed but does not work: ${info.error}`);
  console.log(failures ? `\n${failures} check(s) FAILED.` : '\nJavaScript checks passed; Mplus checks skipped.');
  process.exit(failures ? 1 : 0);
}

async function run(dir, file, asciiTemp = false) {
  const t0 = Date.now();
  const out = await runEngine({ engine: 'mplus', dir, file, asciiTemp });
  return { ...out, ms: Date.now() - t0, text: out.outExists ? await fs.readFile(path.join(dir, out.outFile), 'latin1') : '' };
}

// ---------- 2. CFA of the sample data in three folders ----------
console.log('\nCFA of data/sample.csv (WLSMV, second order)');
const FOLDERS = [
  { label: 'ASCII folder', dir: path.join(BASE, 'ascii'), asciiTemp: false },
  { label: '"Şablon ı deneme"', dir: path.join(BASE, 'Şablon ı deneme'), asciiTemp: false },
  { label: '"Şablon ı deneme" via ASCII temp copy', dir: path.join(BASE, 'Şablon ı deneme'), asciiTemp: true },
];
let cfa = null;
const cfaKeys = [];
for (const f of FOLDERS) {
  await fs.mkdir(f.dir, { recursive: true });
  await fs.writeFile(path.join(f.dir, 'data.dat'), toMplusDat(table, items));
  await fs.writeFile(path.join(f.dir, 'cfa.inp'), cfaText);
  let r;
  try { r = await run(f.dir, 'cfa.inp', f.asciiTemp); } catch (e) { fail(`${f.label}: ${e.message}`); continue; }
  const res = D.readMplusOut(r.text);
  if (r.exitCode !== 0 || !res.ok) { fail(`${f.label}: ${res.error || `exit code ${r.exitCode}`}`); continue; }
  if (f.asciiTemp && !r.asciiTemp) { fail(`${f.label}: the ASCII temp copy was not used`); continue; }
  pass(`${pad(f.label, 42)} ${(r.ms / 1000).toFixed(2)} s · N = ${res.n} · CFI ${D.f3(res.fit.cfi)} · RMSEA ${D.f3(res.fit.rmsea)} · SRMR ${D.f3(res.fit.srmr)}`);
  cfaKeys.push(JSON.stringify([res.by, res.fit]));
  if (!cfa) cfa = res;
}
if (cfaKeys.length > 1) check(cfaKeys.every((k) => k === cfaKeys[0]), `identical CFA results in all ${cfaKeys.length} folders`);
if (cfa) check(cfa.by.length === 15 && cfa.thr.length === 48, `STDYX read: 15 loadings, 48 thresholds (got ${cfa.by.length}, ${cfa.thr.length})`);

async function runPlan(plan, dir) {
  await fs.mkdir(dir, { recursive: true });
  const runs = {};
  const t0 = Date.now();
  for (const f of plan.files) {
    await fs.writeFile(path.join(dir, f.name), f.text);
    const r = await run(dir, f.name);
    let res = null;
    try { res = await fs.readFile(path.join(dir, f.res), 'latin1'); } catch { /* missing */ }
    runs[f.name] = { out: r.text, res };
    if (r.exitCode !== 0) fail(`${f.name}: exit code ${r.exitCode}`);
  }
  return { sum: D.summarizeDfi(plan, runs, 'include'), ms: Date.now() - t0 };
}
const row = (l) => ['srmr', 'rmsea', 'cfi'].map((k) => (Number.isFinite(l.hb[k].value) ? D.f3(l.hb[k].value) : 'NONE')).join(' ');

// ---------- 3. reference DFI ----------
if (!QUICK) {
  console.log('\nReference DFI: A-SAGS hand entry, continuous ML, 500 replications, N = 492');
  const { sum, ms: t } = await runPlan(planA, path.join(BASE, 'reference'));
  if (!sum.ok) fail(sum.error);
  else {
    const got = sum.levels.map(row).join(' | ');
    const want = '.023 .062 .987 | .025 .075 .983';
    check(got === want, `cutoffs ${got} (expected ${want}; validated against the R package) · ${(t / 1000).toFixed(1)} s`);
    console.log(`        improper solutions per level: ${[sum.level0.improper, ...sum.levels.map((l) => l.improper)].join(' / ')} of ${sum.reps}`);
  }
}

// ---------- 4. short ordinal DFI from the sample CFA ----------
if (cfa) {
  console.log('\nOrdinal DFI from the sample CFA (WLSMV, 50 replications)');
  const plan = D.planDfi({ ...cfa }, { reps: 50 });
  const { sum, ms: t } = await runPlan(plan, path.join(BASE, 'ordinal'));
  if (!sum.ok) fail(sum.error);
  else {
    check(plan.dataType === 'categorical' && plan.estimator === 'WLSMV', `ordinal data, WLSMV (${plan.type}, ${plan.levels.length} levels: ${plan.levels.map((l) => l.added).join('; ')})`);
    check([sum.level0, ...sum.levels].every((l) => l.completed >= 45), `replications completed: ${[sum.level0.completed, ...sum.levels.map((l) => l.completed)].join(' / ')} of 50 · ${(t / 1000).toFixed(1)} s`);
    console.log(`        cutoffs (95/5): ${sum.levels.map(row).join(' | ')} · improper: ${sum.levels.map((l) => l.improper).join(' / ')}`);
  }
}

if (!KEEP && !arg('dir')) await fs.rm(BASE, { recursive: true, force: true }).catch(() => {});
else console.log(`\nTest files kept in ${BASE}`);
console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
