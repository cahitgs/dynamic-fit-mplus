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
//   5. Mplus: a second-order model entered with the second-order statement first must run (20 replications).
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
check(planA.slevels.length === 0 && planA.structural.reason === 'saturated', 'A-SAGS: no structural levels (3 first-order factors: saturated)');
// one-factor Level 1: McNeish & Wolf (2023a) round (⌊⌊I/2⌋/3 + .5⌋), dynamic rounds down ('As dynamic')
const ten = { ...D.parseStdModel('F =~ .52*Q1 + .61*Q2 + .55*Q3 + .70*Q4 + .66*Q5 + .58*Q6 + .73*Q7 + .64*Q8 + .69*Q9 + .60*Q10'), n: 300 };
const cnt = (o) => D.planDfi(ten, o).levels.map((l) => l.addRcov.length).join(',');
check(cnt({}) === '2,3,5' && cnt({ signs: 'dynamic' }) === '1,3,5' && D.planDfi(ten, {}).l1Differs, `one-factor, 10 items: levels 2,3,5 as in the paper, 1,3,5 as dynamic (got ${cnt({})} / ${cnt({ signs: 'dynamic' })})`);
const dfErr = (txt) => { try { D.planDfi({ ...D.parseStdModel(txt), n: 300 }, {}); return ''; } catch (e) { return e.message; } };
check(/df = 0/.test(dfErr('F =~ .7*a + .6*b + .5*c')) && !dfErr('F1 =~ .7*a + .6*b\nF2 =~ .7*c + .6*d\nF1 ~~ .3*F2'), 'models without degrees of freedom are refused (3-item one-factor: df = 0; 2 × 2 items: df = 1 runs)');
// hier2 (structural misspecification) against dynamic: pairs and disturbance covariances of a 6-factor model
const H6SRC = `G =~ .51*F1 + .83*F2 + .97*F3 + .83*F4 + .87*F5 + .75*F6
F1 =~ .41*Y1 + .81*Y2 + .71*Y3
F2 =~ .79*Y4 + .64*Y5 + .81*Y6
F3 =~ .53*Y8 + .68*Y9 + .66*Y10
F4 =~ .79*Y11 + .76*Y12 + .70*Y7
F5 =~ .82*Y13 + .71*Y14 + .85*Y15
F6 =~ .7*Y16 + .6*Y17 + .65*Y18`;
const H6 = { ...D.parseStdModel(H6SRC), n: 500 };
const pH = D.planDfi(H6, {});
const sl = pH.slevels.map((l) => l.addPsi.map((x) => `${x.a}-${x.b}`).join(',')).join(' | ');
check(sl === 'F6-F1 | F6-F1,F4-F2 | F6-F1,F4-F2,F3-F5', `hier2 pairs match dynamic (${sl})`);
const s3 = pH.files.find((f) => f.family === 's' && f.level === 3 && f.kind === 'model').text;
const cov = ['F6 WITH F1', 'F4 WITH F2', 'F3 WITH F5'].map((w) => Number((s3.match(new RegExp(`${w}\\*(-?[\\d.]+);`)) || [])[1]));
check(Math.abs(cov[0] - 0.284476) < 2e-6 && Math.abs(cov[1] - 0.15555) < 2e-6 && Math.abs(cov[2] - 0.059932) < 2e-6, `hier2 disturbance covariances match dynamic (${cov.map((x) => x.toFixed(6)).join(', ')})`);
// the second-order statement entered first (as in dynamic's examples): Mplus needs F1 BY … before G BY F1 …
const byOrder = (txt) => ['MODEL POPULATION:', '\nMODEL:'].every((sec) => {
  const t = txt.slice(txt.indexOf(sec), sec === '\nMODEL:' ? undefined : txt.indexOf('\nANALYSIS:'));
  const f1 = t.search(/\n {2}F1 BY/), g = t.search(/\n {2}G BY/);
  return f1 >= 0 && f1 < g;
});
check(pH.files.every((f) => f.kind === 'base' || byOrder(f.text)), 'second-order factor entered first: its BY statement is written after those of the first-order factors');
const lines6 = H6SRC.split('\n');
const pHl = D.planDfi({ ...D.parseStdModel([...lines6.slice(1), lines6[0]].join('\n')), n: 500 }, {});
check(JSON.stringify([pH.misspec, pH.slevels]) === JSON.stringify([pHl.misspec, pHl.slevels]), 'the misspecifications do not depend on the order of the statements');
// reverse-coding an item must not change the population misfit (signs = 'invariant'; dynamic issue #7)
const HS = 'F1 =~ .772*X1 + .424*X2 + .581*X3\nF2 =~ .852*X4 + .855*X5 + .838*X6\nF3 =~ .570*X7 + .723*X8 + .665*X9\nF1 ~~ .459*F2\nF1 ~~ .471*F3\nF2 ~~ .283*F3';
const sigma = (txt) => { const s = { ...D.parseStdModel(txt), n: 301 }; const st = D.structure(s); const pl = D.planDfi(s, {}); return pl.levels.map((lv) => { const p = D.population(s, st, lv.addBy, lv.addRcov); return p.it.map((_, i) => p.it.map((__, j) => { let v = p.Theta[i][j]; for (let a = 0; a < p.fac.length; a++) for (let b = 0; b < p.fac.length; b++) v += p.L[i][a] * p.Seta[a][b] * p.L[j][b]; return Math.abs(v); })); }); };
const sA = sigma(HS), sB = sigma(HS.replace('.424*X2', '-.424*X2').replace('.570*X7', '-.570*X7'));
check(sA.every((m, k) => m.every((r, i) => r.every((v, j) => Math.abs(v - sB[k][i][j]) < 1e-12))), 'reverse-coded items leave the population misfit unchanged');

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

// ---------- 5. second-order model entered with the second-order statement first ----------
console.log('\nSecond-order model, second-order statement first (ML, 20 replications, with structural levels)');
{
  const plan = D.planDfi(H6, { reps: 20 });
  const { sum, ms: t } = await runPlan(plan, path.join(BASE, 'gfirst'));
  check(sum.ok && [sum.level0, ...sum.levels, ...sum.slevels].every((l) => l.completed >= 15), sum.ok ? `${plan.files.length} Mplus runs completed (${plan.levels.length} levels, ${plan.slevels.length} structural) · ${(t / 1000).toFixed(1)} s` : sum.error);
}

if (!KEEP && !arg('dir')) await fs.rm(BASE, { recursive: true, force: true }).catch(() => {});
else console.log(`\nTest files kept in ${BASE}`);
console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
