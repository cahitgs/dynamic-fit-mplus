// Regenerates data/sample.csv — the simulated demo dataset of Dynamic Fit for Mplus.
// Deterministic: a seeded PRNG (mulberry32 + Box–Muller), so every run writes the same file.
//   node tools/make-sample.mjs            → writes data/sample.csv and prints a short summary
//   node tools/make-sample.mjs --check    → only prints the summary of the generated data (no write)
//
// Design: N = 480 students; 12 ordinal items (1–5) of a goal-attainment scale with three first-order factors
// (mastery MAS1–MAS4, self-referenced SELF1–SELF4, normative NORM1–NORM4) and one second-order factor (GOAL).
// Population model (standardized): loadings .70–.82, second-order loadings .80/.85/.75. MAS3 also loads on the
// normative factor (.30), a cross-loading the hypothesized model omits, so the fitted model shows some misfit.
// About 1% of the cells are missing (blank). Columns: ID, MAS1 … NORM4.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'sample.csv');

const SEED = 20261017;
const N = 480;
const FACTORS = {
  MAS: { gamma: 0.8, items: { MAS1: 0.72, MAS2: 0.78, MAS3: 0.7, MAS4: 0.8 } },
  SELF: { gamma: 0.85, items: { SELF1: 0.75, SELF2: 0.82, SELF3: 0.77, SELF4: 0.7 } },
  NORM: { gamma: 0.75, items: { NORM1: 0.8, NORM2: 0.74, NORM3: 0.78, NORM4: 0.72 } },
};
const CROSS = { item: 'MAS3', factor: 'NORM', loading: 0.3 };
const BASE_THRESHOLDS = [-1.7, -0.75, 0.25, 1.3];
const MISSING_RATE = 0.01;

// ---------- deterministic random numbers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
let spare = null;
function normal() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  const u1 = 1 - rand();
  const u2 = rand();
  const r = Math.sqrt(-2 * Math.log(u1));
  spare = r * Math.sin(2 * Math.PI * u2);
  return r * Math.cos(2 * Math.PI * u2);
}

const names = Object.keys(FACTORS);
const items = names.flatMap((f) => Object.keys(FACTORS[f].items));
const phi = (a, b) => (a === b ? 1 : FACTORS[a].gamma * FACTORS[b].gamma);
// item thresholds: the base set shifted a little per item (fixed pattern)
const shift = Object.fromEntries(items.map((x, i) => [x, [-0.15, 0.1, 0, 0.2, -0.05, 0.15][i % 6]]));

function generate() {
  const rows = [];
  for (let id = 1; id <= N; id++) {
    const g = normal();
    const eta = Object.fromEntries(names.map((f) => [f, FACTORS[f].gamma * g + Math.sqrt(1 - FACTORS[f].gamma ** 2) * normal()]));
    const row = { ID: id };
    for (const f of names) {
      for (const [item, lam] of Object.entries(FACTORS[f].items)) {
        let common = lam * eta[f];
        let comVar = lam * lam;
        if (item === CROSS.item) {
          common += CROSS.loading * eta[CROSS.factor];
          comVar += CROSS.loading ** 2 + 2 * lam * CROSS.loading * phi(f, CROSS.factor);
        }
        const ystar = common + Math.sqrt(1 - comVar) * normal();
        const cat = 1 + BASE_THRESHOLDS.filter((t) => ystar > t + shift[item]).length;
        row[item] = rand() < MISSING_RATE ? null : cat;
      }
    }
    rows.push(row);
  }
  return rows;
}

function summary(rows) {
  const lines = [`N = ${rows.length} students, ${items.length} items (seed ${SEED})`];
  for (const x of items) {
    const v = rows.map((r) => r[x]).filter((y) => y != null);
    const counts = [1, 2, 3, 4, 5].map((c) => v.filter((y) => y === c).length);
    lines.push(`${x.padEnd(6)} n = ${v.length}  categories 1–5: ${counts.join(' / ')}`);
  }
  return lines.join('\n');
}

const rows = generate();
const header = ['ID', ...items];
const csv = [header.join(','), ...rows.map((r) => header.map((h) => (r[h] == null ? '' : r[h])).join(','))].join('\n') + '\n';
if (!process.argv.includes('--check')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, csv);
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${rows.length} rows)`);
}
console.log(summary(rows));
