// Self-test of Dynamic Fit for Mplus — the DFI engine (public/lib/dfi.js) and the local Mplus adapter.
// No server or browser needed.
//   node tools/engine-test.mjs                 (or: npm run engine-test)
//   node tools/engine-test.mjs --dir=<folder>  work in this folder instead of a new temp folder
//   node tools/engine-test.mjs --keep          keep the test folders (default: delete them afterwards)
//   node tools/engine-test.mjs --quick         skip the 500-replication reference simulation
// Checks:
//   1. Pure JavaScript: misspecification rules against dynamic::multi_add_hier for the A-SAGS model of
//      Boivin et al. (2026); quantiles (type 7) and the CFI formula; the CFA input of the sample data; the zip
//      writer and the output-to-input match of the web version.
//   2. Mplus: the CFA of data/sample.csv (WLSMV, second order) in an ASCII folder, in a folder whose name has
//      spaces and Turkish letters, and through the ASCII temp-copy fallback; the outputs must agree.
//   3. Mplus: the reference DFI of the A-SAGS hand-entry example (continuous ML, 500 replications, N = 492)
//      must reproduce the cutoffs validated against the R package (same seeds → identical Mplus results).
//   4. Mplus: a short ordinal (WLSMV) DFI from the sample CFA (50 replications) must complete.
//   5. Mplus: a second-order model entered with the second-order statement first must run (20 replications).
//   6. Mplus: a one-factor model with reverse-coded items and no mean structure must converge (20 replications).
// Exit code 1 when a check fails; without Mplus only the JavaScript checks run.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectMplus, runEngine } from '../engines.mjs';
import { parseTable, toMplusDat } from '../public/lib/data.js';
import { buildCfaInp } from '../public/lib/mplus.js';
import * as D from '../public/lib/dfi.js';
import * as R from '../public/lib/report.js';
import { crc32, zipStore } from '../public/lib/zip.js';

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
// a model statement copied from a PDF (mathematical letters, −, ∗, "=" without the tilde, a line break) and long names
const pdf = D.parseStdModel('𝐸𝑥𝑡𝑟𝑎𝑣𝑒𝑟𝑠𝑖𝑜𝑛 = .671∗𝐸1+−.705∗𝐸2+.704∗𝐸3+−.702∗𝐸4+.750∗𝐸5+−.572∗𝐸6+.744∗𝐸7+−.514∗𝐸8+.605∗𝐸9+\n−.703∗𝐸10');
check(pdf.by.length === 10 && pdf.by[0].f === 'EXTRAVER' && pdf.labels.EXTRAVER === 'Extraversion' && pdf.by[1].est === -0.705 && pdf.by[9].ind === 'E10' && pdf.by[9].est === -0.703, `a model statement copied from a PDF is read (${pdf.by.length} loadings; factor ${pdf.by[0].f} = "${pdf.labels.EXTRAVER}")`);
const two = D.parseStdModel('Extraversion1 =~ .7*a1 + .6*a2 + .5*a3\nExtraversion2 =~ .7*b1 + .6*b2 + .5*b3\nExtraversion1 ~~ .3*Extraversion2');
check(two.by[0].f === 'EXTRAVER' && two.by[3].f === 'EXTRAVE2' && two.with[0].a === 'EXTRAVER' && two.with[0].b === 'EXTRAVE2' && two.labels.EXTRAVE2 === 'Extraversion2' && !('A1' in two.labels), `long names are shortened uniquely for Mplus (${two.by[0].f}, ${two.by[3].f}); short names get no label`);
// too few admissible replications (e.g., after excluding improper solutions): no cutoff, instead of a number from a handful
const rowsOf = (n, s, step = 1e-5) => Array.from({ length: n }, (_, i) => ({ srmr: s + i * step, rmsea: s + i * step, cfi: 1 - s - i * step, improper: false }));
const cc2 = D.conditionCutoffs(rowsOf(2, 0.05), rowsOf(500, 0.02)), cc20 = D.conditionCutoffs(rowsOf(20, 0.05), rowsOf(500, 0.02));
check(cc2.few && cc2.hb.rmsea.few && !Number.isFinite(cc2.hb.rmsea.value) && !Number.isFinite(cc2.sens.cfi.value) && !cc20.few && Number.isFinite(cc20.hb.rmsea.value), 'fewer than 20 admissible replications give no cutoff; 20 still do');
{
  const mk = (used, few) => ({ used, usedTrue: 493, completed: 500, improper: 500 - used, few, hb: Object.fromEntries(['srmr', 'rmsea', 'cfi'].map((k) => [k, few ? { value: NaN, rule: null, few: true } : { value: 0.05, rule: '95/5' }])), sens: Object.fromEntries(['srmr', 'rmsea', 'cfi'].map((k) => [k, few ? { value: NaN, sens: NaN, few: true } : { value: 0.05, sens: 0.95 }])) });
  const fake = { ok: true, rule: 'hb', policy: 'exclude', reps: 500, level0: { completed: 500, improper: 7, used: 493, spec: { srmr: 0.02, rmsea: 0.03, cfi: 0.99 } }, levels: p1.levels.map((l, i) => ({ level: l.level, ...mk(i === 0 ? 50 : 2, i > 0) })), slevels: [] };
  const t2 = R.fitTable(null, fake, p1, 'en'), t3 = R.conditionsTable(fake, p1, 'en'), rs = R.resultsText(null, fake, p1, [], 'en');
  check(/>n\/a</.test(t2) && /Level 1<sup>b<\/sup>/.test(t2) && /fewer than 20 admissible/.test(t2) && /fewer than 100 admissible/.test(t2), 'Table 2 shows n/a for too few replications and marks levels below 100');
  check(/>n\/a</.test(t3) && /fewer than 20 admissible/.test(t3) && /two conditions, fewer than 20 admissible replications remained after excluding improper solutions/.test(rs), 'Table 3 and the results text explain n/a');
}
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

// the web version hands the Mplus inputs out as a zip (store method) and takes only outputs that echo those inputs
check(crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'CRC-32 of the zip writer');
const zipped = zipStore([{ name: 'a.inp', data: 'TITLE: a;\n' }, { name: 'run_all.bat', data: '@echo off\r\n' }], new Date(2026, 0, 2, 3, 4, 6));
check(zipped[0] === 0x50 && zipped[1] === 0x4b && zipped.length === 227 && zipped[zipped.length - 12] === 2, `zip archive of two files: ${zipped.length} bytes (expected 227), 2 entries in the end record`);
const fakeOut = (inp) => `Mplus VERSION 8.3\nMUTHEN & MUTHEN\n\nINPUT INSTRUCTIONS\n\n${inp.replace(/\n$/, '').split('\n').map((l) => (l ? '  ' + l : '')).join('\n')}\n\n\n\nINPUT READING TERMINATED NORMALLY\n`;
const inpA = planA.files[0].text;
check(D.sameInput(fakeOut(inpA), inpA) && !D.sameInput(fakeOut(inpA), planA.files[1].text) && D.echoedInput('no echo here') === null, 'an output is matched to the input it echoes, and only to that one');

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
  if (!cfa) check(D.sameInput(r.text, cfaText) && !D.sameInput(r.text, cfaText.replace('SAMPSTAT STDYX', 'STDYX')), 'the Mplus output echoes its input exactly (the check of the web version)');
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
    // the "as dynamic" option (normal data, ML) for a WLSMV model: flagged, so the report does not compare the fit
    check(!plan.estMismatch && D.planDfi({ ...cfa }, { dataType: 'continuous', reps: 50 }).estMismatch === true, 'WLSMV model with ML cutoffs is flagged as not comparable');
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

// ---------- 6. reverse-coded items without a mean structure ----------
// The Extraversion model of Wolf & McNeish's DFI tutorial (10 items, 5 reverse-coded, N = 1,222): with
// MODEL = NOMEANSTRUCTURE and Mplus's default start values no replication converged.
console.log('\nOne-factor model with reverse-coded items, no mean structure (ML, 20 replications)');
{
  const ext = { ...D.parseStdModel('EXTRA =~ .671*E1 + -.705*E2 + .704*E3 + -.702*E4 + .750*E5 + -.572*E6 + .744*E7 + -.514*E8 + .605*E9 + -.703*E10'), n: 1222, noMeans: true };
  const plan = D.planDfi(ext, { reps: 20, signs: 'dynamic' });
  check(/EXTRA BY E1 E2\*-1 E3 E4\*-1 E5 E6\*-1 E7 E8\*-1 E9 E10\*-1;/.test(plan.files[0].text) && /NOMEANSTRUCTURE/.test(plan.files[0].text), 'analysis model gives reverse-coded items the start value -1');
  const { sum, ms: t } = await runPlan(plan, path.join(BASE, 'reverse'));
  check(sum.ok && [sum.level0, ...sum.levels].every((l) => l.completed >= 18), sum.ok ? `replications completed: ${[sum.level0.completed, ...sum.levels.map((l) => l.completed)].join(' / ')} of 20 · ${(t / 1000).toFixed(1)} s` : sum.error);
}

if (!KEEP && !arg('dir')) await fs.rm(BASE, { recursive: true, force: true }).catch(() => {});
else console.log(`\nTest files kept in ${BASE}`);
console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
