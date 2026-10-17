// Dynamic fit index (DFI) cutoffs with Mplus Monte Carlo simulation.
// A port of the 'dynamic' R package (Wolf & McNeish, 2023; AGPL-3): the data-generating models, the
// misspecification rules and the cutoff rules follow dynamic's code (GitHub, DESCRIPTION version 1.1.0, commit
// 90aa51f: cfaOne, cfaHB, hier1HB, catOne, catHB; CRAN 1.1.0 of 2022 for the 95/5 rule of cfaOne/cfaHB), except by
// default the signs of the misspecifications (dynamic issue #7) and the one-factor Level 1 (McNeish & Wolf, 2023a);
// signs = 'dynamic' reproduces the package exactly;
// data generation and estimation are done by Mplus. Mplus Monte Carlo runs do not save CFI per replication, so
// every condition is run twice with the same SEED (identical data sets): once with the analysis model and once
// with the baseline (independence) model; CFI and TLI are computed from the two chi-square statistics exactly
// as Mplus computes them. Same algorithm as dynamic_mplus.R (validated against dynamic). Beyond Monte Carlo error,
// cutoffs can differ from dynamic's by about .001: dynamic's lavaan fits (std.lv = TRUE, rel.tol = .001) stop
// slightly short of the ML minimum that Mplus reaches.
// Plain ES module without DOM access: runs in the browser and in Node.

export const LEVEL_SEP = '_';
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (s) => {
  if (s === undefined || s === null) return NaN;
  const t = String(s).trim().replace(/\*+$/, '');
  if (!t || /^\*+$/.test(t)) return NaN;
  return Number(t.replace(/D/i, 'E'));
};
const fmt = (x, d = 4) => {
  const s = Number(x).toFixed(d);
  return /^-0\.0+$/.test(s) ? s.slice(1) : s;
};
/** ".026" style used by dynamic (three decimals, no leading zero). */
export const f3 = (x) => (fin(x) ? fmt(x, 3).replace(/^(-?)0\./, '$1.') : '—');

// Wrap one Mplus statement so that no line exceeds `width` characters (Mplus allows 90).
export function wrapStmt(stmt, width = 76, indent = '  ') {
  const words = String(stmt).trim().split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (indent.length + cur.length + 1 + w.length > width) { out.push(cur); cur = '  ' + w; }
    else cur += ' ' + w;
  }
  out.push(cur);
  return out.map((l) => indent + l);
}

// ---------------------------------------------------------------- reading a fitted Mplus model
const NUMRE = String.raw`(-?(?:\d+\.?\d*|\.\d+)(?:[DE][-+]?\d+)?|\*{3,})`;
const SECTION_RE = /^ (Means|Intercepts|Thresholds|Variances|Residual Variances|Scales|New\/Additional Parameters)\s*$/;

function parseStdyx(lines) {
  let lhs = null, op = null;
  const rows = [];
  for (const ln of lines) {
    if (/^\s*Group\s+\S+\s*$/.test(ln)) throw new Error('Multiple-group models are not supported.');
    let m;
    if ((m = ln.match(/^ (\S+)\s+(BY|WITH|ON|PON|PWITH)\s*$/))) { lhs = m[1].toUpperCase(); op = m[2]; continue; }
    if ((m = ln.match(SECTION_RE))) { lhs = null; op = m[1]; continue; }
    if (op && (m = ln.match(new RegExp(String.raw`^\s{2,}(\S+)\s+${NUMRE}(?:\s+${NUMRE})?(?:\s+${NUMRE})?`)))) {
      rows.push({ lhs, op, rhs: m[1].toUpperCase(), est: num(m[2]), se: num(m[3]), z: num(m[4]) });
    }
  }
  return rows;
}

function readFit(lines) {
  const s = lines.findIndex((l) => /^MODEL FIT INFORMATION/.test(l));
  const e = lines.findIndex((l) => /^MODEL RESULTS/.test(l));
  if (s < 0 || e < 0) return null;
  const f = lines.slice(s, e + 1);
  const val = (head, lab) => {
    const h = f.findIndex((l) => head.test(l));
    if (h < 0) return NaN;
    for (let j = h + 1; j < f.length; j++) if (lab.test(f[j])) { const tk = f[j].trim().split(/\s+/); return num(tk[tk.length - 1]); }
    return NaN;
  };
  const chi = /^Chi-Square Test of Model Fit\s*$/;
  return {
    chisq: val(chi, /^\s+Value/), df: val(chi, /^\s+Degrees of Freedom/), pvalue: val(chi, /^\s+P-Value/),
    rmsea: val(/^RMSEA/, /^\s+Estimate/), cfi: val(/^CFI\/TLI/, /^\s+CFI/), tli: val(/^CFI\/TLI/, /^\s+TLI/),
    srmr: val(/^SRMR/, /^\s+Value/),
  };
}

/**
 * Reads a fitted Mplus model (.out): STDYX loadings, (residual) correlations, thresholds, N, estimator and fit.
 * → {ok, complete, errors[], warnings[], version, n, estimator, title, by[], with[], thr[], fit, error}
 * ok = the run finished without errors and has an STDYX solution of a CFA/higher-order model.
 */
export function readMplusOut(text) {
  const src = String(text ?? '').replace(/\r/g, '');
  const lines = src.split('\n');
  const r = { ok: false, complete: /Elapsed Time:/.test(src), errors: [], warnings: [], version: null, n: NaN, estimator: null, title: '', by: [], with: [], thr: [], fit: null, error: null };
  const vm = src.match(/Mplus VERSION ([\d.]+)/);
  if (vm) r.version = vm[1];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\*\*\* ERROR/.test(l)) {
      const msg = [l.replace(/^\*\*\* ERROR( in \w+ command)?/, '').trim()];
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) msg.push(lines[j].trim());
      r.errors.push(msg.filter(Boolean).join(' ').replace(/\s+/g, ' '));
    } else if (/THE MODEL ESTIMATION DID NOT TERMINATE NORMALLY|NO CONVERGENCE/.test(l)) {
      r.errors.push(l.trim());
    } else if (/^\s+WARNING:|^\*\*\* WARNING/.test(l)) { // also "*** WARNING in ANALYSIS command" (e.g. an option Mplus ignored)
      const blk = [l.trim()];
      for (let j = i + 1; j < lines.length && lines[j].trim(); j++) blk.push(lines[j].trim());
      r.warnings.push(blk.join(' ').replace(/\s+/g, ' '));
    }
  }
  const nl = lines.find((l) => /^\s*Number of observations\s+\d+\s*$/.test(l));
  if (nl) r.n = num(nl.trim().split(/\s+/).pop());
  if (lines.some((l) => /^\s*Number of groups\s+([2-9]|[1-9]\d+)\s*$/.test(l))) r.error = 'Multiple-group models are not supported.';
  const el = lines.find((l) => /^\s*Estimator\s+[A-Z]+\s*$/.test(l));
  if (el) r.estimator = el.trim().split(/\s+/).pop();
  const ti = lines.findIndex((l) => /^\s*TITLE:/i.test(l));
  if (ti >= 0) r.title = (lines[ti].replace(/^\s*TITLE:/i, '').trim() || (lines[ti + 1] || '').trim()).replace(/;$/, '');
  r.fit = readFit(lines);
  const s = lines.findIndex((l) => /^STDYX Standardization/.test(l));
  if (s < 0) {
    if (!r.error) r.error = r.errors[0] || (r.complete ? 'The output has no STDYX standardized solution. Add OUTPUT: STDYX; to the input and run the model again.' : 'The Mplus output is incomplete.');
    return r;
  }
  const stop = /^(STDY Standardization|STD Standardization|R-SQUARE|QUALITY OF NUMERICAL RESULTS|TECHNICAL \d+ OUTPUT|MODEL MODIFICATION INDICES|RESIDUAL OUTPUT|SAVEDATA INFORMATION|DIAGRAM INFORMATION|Beginning Time)/;
  let e = lines.length;
  for (let j = s + 1; j < lines.length; j++) if (stop.test(lines[j])) { e = j; break; }
  let rows;
  try { rows = parseStdyx(lines.slice(s + 1, e)); } catch (err) { r.error = err.message; return r; }
  if (rows.some((x) => x.op === 'ON' || x.op === 'PON')) { r.error = 'The model has ON statements. Dynamic fit cutoffs are defined here for CFA and higher-order measurement models only.'; return r; }
  r.by = rows.filter((x) => x.op === 'BY').map((x) => ({ f: x.lhs, ind: x.rhs, est: x.est }));
  r.with = rows.filter((x) => x.op === 'WITH').map((x) => ({ a: x.lhs, b: x.rhs, est: x.est, fixed: x.se === 0 && x.z === 999 }));
  r.thr = rows.filter((x) => x.op === 'Thresholds').map((x) => ({ item: x.rhs.replace(/\$.*$/, ''), k: Number(x.rhs.replace(/^.*\$/, '')), est: x.est }));
  // Continuous items without intercepts in the solution: the model was fit with MODEL = NOMEANSTRUCTURE. Mplus's SRMR
  // then omits the mean residuals, so the simulation must use the same specification (planDfi).
  r.noMeans = !r.thr.length && !rows.some((x) => x.op === 'Intercepts' || x.op === 'Means');
  if (!r.by.length && !r.error) r.error = 'No factor loadings (BY) were found in the STDYX solution.';
  r.ok = r.complete && !r.errors.length && !r.error;
  if (!r.ok && !r.error) r.error = r.errors[0] || 'The Mplus output is incomplete.';
  return r;
}

// ---------------------------------------------------------------- manually entered standardized model
/**
 * Parses a standardized model in Mplus-like syntax
 *   F1 BY y1*.70 y2*.65;  F1 WITH F2*.40;  [y1$1*-1.2 y1$2*0.3];
 * or in the lavaan-like syntax of dynamic's manual mode
 *   F1 =~ .70*y1 + .65*y2 ;  F1 ~~ .40*F2 ;  y1 | -1.2*t1
 * → {by[], with[], thr[], labels}. Names are upper-cased and, when longer than 8 characters or not Mplus names,
 * shortened for Mplus; labels = {shortName: nameAsTyped} for those. Throws an Error with an English message.
 */
export function parseStdModel(text) {
  // characters a PDF or a word processor may have put in: mathematical letters, true minus signs, ∗ and ×, the
  // tilde operator, hard spaces; and a statement broken across lines at a "+"
  let txt = String(text || '').normalize('NFKC').replace(/[−‐-―]/g, '-').replace(/[∗×]/g, '*').replace(/∼/g, '~').replace(/ /g, ' ');
  txt = txt.replace(/![^\n]*/g, '').replace(/#[^\n]*/g, '').replace(/\+[ \t]*\n\s*/g, '+ ').replace(/\n[ \t]*\+/g, ' +').replace(/=~[ \t]*\n\s*/g, '=~ ');
  // "Extraversion = .671*E1 + …": lavaan's =~ with the tilde lost, as in a typeset tutorial
  txt = txt.replace(/^([ \t]*[^=~|\n]+?)[ \t]*=(?![~=])[ \t]*(?=[-+]?[ \t]*[\d.]+[ \t]*\*)/gm, '$1 =~ ');
  const r = txt.includes('=~') ? parseLavaanStd(txt) : parseMplusStd(txt);
  // Mplus names (at most 8 characters, letters, digits and _, starting with a letter): other names are shortened
  // for Mplus and kept as labels, e.g. {EXTRAVER: 'Extraversion'}
  const names = [];
  r.by.forEach((x) => names.push(x.f, x.ind));
  r.with.forEach((w) => names.push(w.a, w.b));
  r.thr.forEach((x) => names.push(x.item));
  const { map, labels } = mplusNames(names);
  const M = (s) => map[String(s).toUpperCase()];
  return { by: r.by.map((x) => ({ ...x, f: M(x.f), ind: M(x.ind) })), with: r.with.map((w) => ({ ...w, a: M(w.a), b: M(w.b) })), thr: r.thr.map((x) => ({ ...x, item: M(x.item) })), labels };
}
function mplusNames(names) {
  const map = {}, labels = {}, taken = new Set();
  for (const raw of names) {
    const up = String(raw).toUpperCase();
    if (map[up] !== undefined) continue;
    let s = up.replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[A-Z]/.test(s)) s = `V${s}`;
    s = s.slice(0, 8);
    const base = s;
    for (let k = 2; taken.has(s); k++) s = `${base.slice(0, 8 - String(k).length)}${k}`;
    taken.add(s);
    map[up] = s;
    if (s !== up) labels[s] = String(raw);
  }
  return { map, labels };
}
function parseMplusStd(txt) {
  const by = [], wi = [], thr = [];
  const stm = txt.split(';').map((s) => s.trim().replace(/\s+/g, ' ').replace(/\s*([*@])\s*/g, '$1')).filter(Boolean);
  for (const s of stm) {
    let m;
    if (/^\[.*\]$/.test(s)) {
      for (const tk of s.replace(/^\[|\]$/g, '').trim().split(' ').filter(Boolean)) {
        if (!(m = tk.match(/^([^$]+)\$(\d+)[*@](-?[\d.]+)$/))) throw new Error(`Cannot read the threshold "${tk}" (write e.g. [y1$1*-1.20 y1$2*0.35]).`);
        thr.push({ item: m[1], k: Number(m[2]), est: Number(m[3]) });
      }
    } else if (/^\S+ BY /i.test(s)) {
      const p = s.split(' '), f = p[0];
      for (const tk of p.slice(2)) {
        if (!(m = tk.match(/^([^*@]+)[*@](-?[\d.]+)$/))) throw new Error(`The loading "${tk}" has no standardized value (write e.g. ${f} BY y1*.70).`);
        by.push({ f, ind: m[1], est: Number(m[2]) });
      }
    } else if (/^\S+ WITH /i.test(s)) {
      const p = s.split(' '), a = p[0];
      for (const tk of p.slice(2)) {
        if (!(m = tk.match(/^([^*@]+)([*@])(-?[\d.]+)$/))) throw new Error(`"${a} WITH ${tk}" has no standardized value (write e.g. F1 WITH F2*.40).`);
        wi.push({ a, b: m[1], est: Number(m[3]), fixed: m[2] === '@' });
      }
    } else throw new Error(`Cannot read the statement "${s}". Use BY, WITH and [threshold] statements.`);
  }
  if (!by.length) throw new Error('The model has no loadings.');
  return { by, with: wi, thr };
}
function parseLavaanStd(txt) {
  const by = [], wi = [], thr = [];
  const term = /^(-?[\d.]+)\s*\*\s*(\S+)$/;
  for (const ln of txt.split(/[\n;]/).map((x) => x.trim()).filter(Boolean)) {
    let m;
    if (ln.includes('=~')) {
      const [l, r] = ln.split('=~');
      const f = l.trim();
      for (const tm of r.split('+').map((x) => x.trim())) {
        if (!(m = tm.match(term))) throw new Error(`Cannot read "${tm}" (write e.g. F1 =~ .70*y1 + .65*y2).`);
        by.push({ f, ind: m[2], est: Number(m[1]) });
      }
    } else if (ln.includes('~~')) {
      const [l, r] = ln.split('~~');
      const a = l.trim();
      for (const tm of r.split('+').map((x) => x.trim())) {
        if (!(m = tm.match(term))) throw new Error(`Cannot read "${tm}" (write e.g. F1 ~~ .40*F2).`);
        if (m[2].toUpperCase() !== a.toUpperCase()) wi.push({ a, b: m[2], est: Number(m[1]), fixed: false });
      }
    } else if (ln.includes('|')) {
      const [l, r] = ln.split('|');
      if (!(m = r.trim().match(/^(-?[\d.]+)\s*\*\s*t(\d+)$/))) throw new Error(`Cannot read the threshold "${ln}" (write e.g. y1 | -1.20*t1).`);
      thr.push({ item: l.trim(), k: Number(m[2]), est: Number(m[1]) });
    } else throw new Error(`Cannot read the line "${ln}".`);
  }
  if (!by.length) throw new Error('The model has no loadings.');
  return { by, with: wi, thr };
}

// ---------------------------------------------------------------- model structure
const uniq = (a) => [...new Set(a)];
/** {factors, items, higher, first}; throws an Error for models the method cannot handle. */
export function structure(spec) {
  const by = spec.by;
  const f0 = uniq(by.map((x) => x.f));
  // Mplus needs `F1 BY …` before `G BY F1 …`: order the factors from the first order upward (stable otherwise)
  const factors = [], left = [...f0];
  while (left.length) {
    const i = left.findIndex((f) => by.every((x) => x.f !== f || !f0.includes(x.ind) || factors.includes(x.ind)));
    if (i < 0) throw new Error('The higher-order factors load on each other in a circle.');
    factors.push(...left.splice(i, 1));
  }
  const items = uniq(by.filter((x) => !factors.includes(x.ind)).map((x) => x.ind));
  const higher = uniq(by.filter((x) => factors.includes(x.ind)).map((x) => x.f));
  const names = [...items, ...factors];
  const long = names.filter((x) => x.length > 8);
  if (long.length) throw new Error(`Mplus names can have at most 8 characters: ${long.join(', ')}.`);
  const unknown = uniq([...spec.with.map((w) => w.a), ...spec.with.map((w) => w.b)]).filter((x) => !names.includes(x));
  if (unknown.length) throw new Error(`WITH statements refer to unknown variables: ${unknown.join(', ')}.`);
  const badThr = uniq(spec.thr.map((x) => x.item)).filter((x) => !items.includes(x));
  if (badThr.length) throw new Error(`Thresholds are given for variables that are not indicators: ${badThr.join(', ')}.`);
  if (by.some((x) => !(Math.abs(x.est) < 1))) throw new Error('Standardized loadings must be between −1 and 1.');
  return { factors, items, higher, first: factors.filter((f) => !higher.includes(f)) };
}

// ---------------------------------------------------------------- small linear algebra
const zeros = (n, m) => Array.from({ length: n }, () => new Array(m).fill(0));
function matMul(A, B) {
  const n = A.length, m = B[0].length, k = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { let s = 0; for (let t = 0; t < k; t++) s += A[i][t] * B[t][j]; C[i][j] = s; }
  return C;
}
const transpose = (A) => A[0].map((_, j) => A.map((r) => r[j]));
function inverse(M) {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) throw new Error('The factor structure is not recursive (singular I − B).');
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c && A[r][c] !== 0) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r) => r.slice(n));
}
function isPosDef(S) {
  const n = S.length, L = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = S[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (!(s > 0)) return false; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  return true;
}

/**
 * Standardized population model: every latent and observed variable has variance 1; disturbance and residual
 * variances are solved for; WITH values are (residual) correlations, as in Mplus STDYX output.
 * addBy: [{f, ind, est}] cross-loadings added; addRcov: [{a, b, cov}] residual covariances added between items;
 * addPsi: [{a, b, r}] correlations added between the disturbances of two first-order factors (hier2).
 */
export function population(spec, st = structure(spec), addBy = [], addRcov = [], addPsi = []) {
  const fac = st.factors, it = st.items;
  const fi = Object.fromEntries(fac.map((f, i) => [f, i])), ii = Object.fromEntries(it.map((x, i) => [x, i]));
  const B = zeros(fac.length, fac.length), L = zeros(it.length, fac.length);
  for (const r of [...spec.by, ...addBy]) {
    if (r.ind in fi) B[fi[r.ind]][fi[r.f]] += r.est; else L[ii[r.ind]][fi[r.f]] += r.est;
  }
  const endo = fac.filter((f, i) => B[i].some((x) => x !== 0));
  const Rpsi = zeros(fac.length, fac.length), Rth = zeros(it.length, it.length);
  fac.forEach((_, i) => { Rpsi[i][i] = 1; });
  it.forEach((_, i) => { Rth[i][i] = 1; });
  for (const w of spec.with) {
    if (w.a in fi && w.b in fi) { Rpsi[fi[w.a]][fi[w.b]] = w.est; Rpsi[fi[w.b]][fi[w.a]] = w.est; }
    else if (w.a in ii && w.b in ii) { Rth[ii[w.a]][ii[w.b]] = w.est; Rth[ii[w.b]][ii[w.a]] = w.est; }
    else throw new Error(`WITH between a factor and an item is not supported: ${w.a} WITH ${w.b}.`);
  }
  for (const r of addPsi) { Rpsi[fi[r.a]][fi[r.b]] = r.r; Rpsi[fi[r.b]][fi[r.a]] = r.r; }
  const IB = inverse(fac.map((_, i) => fac.map((__, j) => (i === j ? 1 : 0) - B[i][j])));
  const IBt = transpose(IB);
  const isEndo = fac.map((f) => endo.includes(f));
  let psi = fac.map(() => 1);
  const scaled = (R, v) => R.map((r, i) => r.map((x, j) => x * Math.sqrt(v[i] * v[j])));
  for (let k = 0; k < 200; k++) {
    const S = matMul(matMul(IB, scaled(Rpsi, psi)), IBt);
    const next = psi.map((p, i) => (isEndo[i] ? p + 1 - S[i][i] : 1));
    if (next.some((x) => !fin(x) || x <= 0)) throw new Error('Inadmissible standardized values: a factor would have a negative disturbance variance.');
    const diff = Math.max(...next.map((x, i) => Math.abs(x - psi[i])));
    psi = next;
    if (diff < 1e-12) break;
  }
  const Psi = scaled(Rpsi, psi);
  const Seta = matMul(matMul(IB, Psi), IBt);
  const common = matMul(matMul(L, Seta), transpose(L));
  const theta = it.map((_, i) => 1 - common[i][i]);
  const bad = it.filter((_, i) => !(theta[i] > 0));
  if (bad.length) throw new Error(`Inadmissible standardized values: residual variance ≤ 0 for ${bad.join(', ')}.`);
  const Theta = scaled(Rth, theta);
  for (const r of addRcov) { Theta[ii[r.a]][ii[r.b]] = r.cov; Theta[ii[r.b]][ii[r.a]] = r.cov; }
  const Sigma = common.map((row, i) => row.map((x, j) => x + Theta[i][j]));
  if (!isPosDef(Sigma)) throw new Error('The population correlation matrix is not positive definite.');
  return { fac, it, fi, ii, B, L, psi, Psi, Seta, theta, Theta, endo, addRcov, addPsi };
}

// ---------------------------------------------------------------- misspecifications (dynamic's rules)
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/**
 * Cross-loadings for multi-factor (cfaHB/catHB) and higher-order (hier1HB) models: the lowest |loading| on each
 * factor (factors with > 2 items first); (number of [first-order] factors − 1) levels; target = the factor with
 * the highest coefficient H whose pair with the item's factor is not used yet; magnitude = the loading, capped at
 * 95% of the largest cross-loading that keeps the item's residual variance positive.
 * signs = 'invariant' (default): levels ordered by |loading| and each cross-loading signed as sign(loading × factor
 * correlation), so that reverse-coding an item or reflecting a factor does not change the population misfit (the
 * case the 95% bound assumes); identical to dynamic when loadings and factor correlations are positive.
 * signs = 'dynamic': as dynamic (levels by signed loading, cross-loadings always positive; dynamic issue #7).
 */
export function misspecHB(spec, st, type, signs = 'invariant') {
  const by = spec.by;
  let facs, rows, rcItems;
  if (type === 'hier') {
    facs = st.first;
    rows = by.filter((x) => st.first.includes(x.f) || (st.higher.includes(x.f) && st.items.includes(x.ind)));
    rcItems = []; // hier1HB does not screen items with residual covariances
  } else {
    facs = st.factors;
    rows = by;
    rcItems = uniq([...spec.with.map((w) => w.a), ...spec.with.map((w) => w.b)]).filter((x) => st.items.includes(x));
  }
  const irows = rows.filter((x) => st.items.includes(x.ind));
  const nload = {};
  irows.forEach((x) => { nload[x.ind] = (nload[x.ind] || 0) + 1; });
  const norig = {};
  rows.forEach((x) => { norig[x.f] = (norig[x.f] || 0) + 1; });
  const solo = irows.filter((x) => nload[x.ind] === 1 && !rcItems.includes(x.ind) && facs.includes(x.f))
    .map((x) => ({ ...x, priority: norig[x.f] > 2 ? 'Three' : 'Two' }));
  if (!solo.length) throw new Error('No items are available for cross-loading misspecifications.');
  let low = [];
  for (const f of uniq(solo.map((x) => x.f)).sort(byName)) {
    const d = solo.filter((x) => x.f === f);
    const mn = Math.min(...d.map((x) => Math.abs(x.est)));
    low.push(...d.filter((x) => Math.abs(x.est) === mn));
  }
  low.sort((a, b) => byName(a.priority, b.priority) || Math.abs(a.est) - Math.abs(b.est));
  const nlev = facs.length - 1;
  if (low.length < nlev) throw new Error('There are not enough free items to produce all misspecification levels.');
  low = low.slice(0, nlev);
  const H = Object.fromEntries(facs.map((f) => {
    const l = rows.filter((x) => x.f === f).map((x) => x.est);
    return [f, 1 / (1 + 1 / l.reduce((s, x) => s + (x * x) / (1 - x * x), 0))];
  }));
  const pop = population(spec, st);
  const R = (a, b) => pop.Seta[pop.fi[a]][pop.fi[b]];
  low.sort((a, b) => Math.abs(a.est) - Math.abs(b.est));
  const used = new Set(), sel = [];
  for (const x of low) {
    const own = x.f;
    const cand = facs.filter((f) => f !== own && !used.has([own, f].sort(byName).join('|')));
    if (!cand.length) continue;
    let tgt = cand[0];
    for (const c of cand) if (H[c] > H[tgt]) tgt = c;
    used.add([own, tgt].sort(byName).join('|'));
    sel.push({ item: x.ind, factor: own, target: tgt, loading: x.est, phi: R(own, tgt), H: H[tgt], priority: x.priority });
  }
  const order = signs === 'dynamic' ? (s) => s.loading : (s) => Math.abs(s.loading);
  sel.sort((a, b) => byName(a.priority, b.priority) || order(a) - order(b) || b.H - a.H);
  sel.forEach((s, i) => {
    const maxAllow = Math.round((Math.sqrt(s.loading ** 2 * s.phi ** 2 + 1 - s.loading ** 2) - Math.abs(s.loading * s.phi)) * 0.95 * 1e4) / 1e4;
    s.maxAllow = maxAllow;
    s.magnitude = Math.min(Math.abs(s.loading), Math.abs(maxAllow));
    s.sign = signs === 'dynamic' ? 1 : Math.sign(s.loading * s.phi) || Math.sign(s.loading) || 1;
    s.est = s.sign * s.magnitude;
    s.level = i + 1;
  });
  return sel;
}

/**
 * Residual correlations of .30 for one-factor models (cfaOne/catOne): items without residual covariances
 * sorted by |loading|, paired (2nd with 1st, 4th with 3rd, …); levels add 1/3, 2/3 and all of the pairs.
 * signs = 'invariant' (default): each residual correlation is signed as sign(loading_a × loading_b), so that
 * reverse-coding an item does not change the misfit, and Level 1 rounds as in McNeish & Wolf (2023a);
 * 'dynamic': always +.30 (dynamic issue #7) and Level 1 rounded down, as in the package.
 */
export function misspecOne(spec, st, signs = 'invariant') {
  const rcItems = uniq([...spec.with.map((w) => w.a), ...spec.with.map((w) => w.b)]).filter((x) => st.items.includes(x));
  const nload = {};
  spec.by.forEach((x) => { nload[x.ind] = (nload[x.ind] || 0) + 1; });
  const solo = spec.by.filter((x) => nload[x.ind] === 1 && !rcItems.includes(x.ind)).sort((a, b) => Math.abs(a.est) - Math.abs(b.est));
  const k = solo.length;
  if (k < 4) throw new Error('One-factor dynamic fit cutoffs need at least 4 items without residual covariances.');
  const take = k === 4 ? 2 : k === 5 ? 4 : Math.floor(k / 2) * 2;
  const pop = population(spec, st);
  const pairs = [];
  for (let i = 1; i < take; i += 2) {
    const a = solo[i].ind, b = solo[i - 1].ind;
    const rcor = signs === 'dynamic' ? 0.3 : 0.3 * (Math.sign(solo[i].est * solo[i - 1].est) || 1);
    pairs.push({ a, b, rcor, cov: rcor * Math.sqrt(pop.theta[pop.ii[a]] * pop.theta[pop.ii[b]]) });
  }
  const L3 = Math.floor(k / 2);
  // Level 1: the formula of McNeish & Wolf (2023a, p. 56) rounds, ⌊L3/3 + .5⌋ ("about one-third of the items");
  // dynamic rounds down, ⌊L3/3⌋, which gives one pair less when L3 mod 3 = 2 (10, 11, 16, 17, … items)
  const paperL1 = k < 6 ? 1 : Math.floor(L3 / 3 + 0.5);
  const dynL1 = k < 6 ? 1 : Math.floor(L3 / 3);
  const L1 = signs === 'dynamic' ? dynL1 : paperL1;
  const levels = k === 4 ? [1] : k === 5 ? [1, 2] : [L1, Math.floor((2 * L3) / 3), L3];
  return { pairs, levels, k, paperL1, dynL1 };
}

/**
 * Structural misspecification of second-order models (dynamic's hier2; McNeish & Manapat, 2024): correlations of
 * .50 between the disturbances of pairs of first-order factors. Eligible: first-order factors that load on exactly
 * one second-order factor and have no disturbance correlation in the model (dynamic would silently drop a duplicate
 * pair). They are sorted by |second-order loading| (stable) and paired 2nd with 1st, 4th with 3rd, …; levels add
 * floor(L3/3), floor(2·L3/3) and L3 = floor(k/2) pairs. With 4 or 5 eligible factors two levels (1 and 2 pairs),
 * as McNeish & Manapat (2024) describe; dynamic stops with an error for exactly 4. With fewer than 4 first-order
 * factors their covariance matrix is saturated and nothing can be tested.
 * signs = 'invariant': each correlation is signed as sign(γa·γb) (times the correlation of the two second-order
 * factors when they differ), so that reflecting a factor does not change the misfit; 'dynamic': always +.50.
 * → {pairs: [{a, b, r}], levels: [pairs per level], k, reason: null | 'saturated' | 'few'}
 */
export function misspecHier2(spec, st, signs = 'invariant') {
  const none = (reason) => ({ pairs: [], levels: [], k: 0, reason });
  if (st.first.length < 4) return none('saturated');
  const gam = spec.by.filter((x) => st.higher.includes(x.f) && st.first.includes(x.ind));
  const cnt = {};
  gam.forEach((x) => { cnt[x.ind] = (cnt[x.ind] || 0) + 1; });
  const corr = new Set();
  spec.with.forEach((w) => { if (st.first.includes(w.a) && st.first.includes(w.b)) { corr.add(w.a); corr.add(w.b); } });
  const sorted = gam.filter((x) => cnt[x.ind] === 1 && !corr.has(x.ind))
    .map((x, i) => ({ ...x, i })).sort((a, b) => Math.abs(a.est) - Math.abs(b.est) || a.i - b.i);
  const k = sorted.length;
  if (k < 4) return { ...none('few'), k };
  const pop = population(spec, st);
  const take = k <= 5 ? 4 : Math.floor(k / 2) * 2;
  const pairs = [];
  for (let i = 1; i < take; i += 2) {
    const a = sorted[i], b = sorted[i - 1];
    const phiG = a.f === b.f ? 1 : pop.Seta[pop.fi[a.f]][pop.fi[b.f]];
    const r = signs === 'dynamic' ? 0.5 : 0.5 * (Math.sign(a.est * b.est * phiG) || 1);
    pairs.push({ a: a.ind, b: b.ind, r });
  }
  const L3 = Math.floor(k / 2);
  const levels = k <= 5 ? [1, 2] : [Math.floor(L3 / 3), Math.floor((2 * L3) / 3), L3];
  return { pairs, levels, k, reason: null };
}

// ---------------------------------------------------------------- Mplus input files
function popLines(spec, st, pop, addBy, catItems) {
  const out = [];
  for (const f of st.factors) {
    const r = spec.by.filter((x) => x.f === f);
    out.push(...wrapStmt(`${f} BY ${r.map((x) => `${x.ind}*${fmt(x.est)}`).join(' ')};`));
  }
  if (addBy && addBy.length) {
    out.push('  ! misspecification (not in the analysis model):');
    addBy.forEach((x) => out.push(`  ${x.f} BY ${x.ind}*${fmt(x.est)};`));
  }
  st.factors.forEach((f, i) => out.push(`  ${f}*${fmt(pop.psi[i], 6)};`));
  const exo = st.factors.filter((f) => !pop.endo.includes(f));
  const addedPsi = new Set((pop.addPsi || []).map((r) => [r.a, r.b].sort(byName).join('|')));
  for (let i = 0; i < st.factors.length; i++) for (let j = i + 1; j < st.factors.length; j++) {
    const v = pop.Psi[i][j];
    if (addedPsi.has([st.factors[i], st.factors[j]].sort(byName).join('|'))) continue;
    if (v !== 0 || (exo.includes(st.factors[i]) && exo.includes(st.factors[j]))) out.push(`  ${st.factors[i]} WITH ${st.factors[j]}*${fmt(v, 6)};`);
  }
  if (addedPsi.size) {
    out.push('  ! misspecification (not in the analysis model):');
    pop.addPsi.forEach((r) => out.push(`  ${r.a} WITH ${r.b}*${fmt(pop.Psi[pop.fi[r.a]][pop.fi[r.b]], 6)};`));
  }
  st.items.forEach((x, i) => out.push(`  ${x}*${fmt(pop.theta[i], 6)};`));
  const added = new Set((pop.addRcov || []).map((r) => [r.a, r.b].sort(byName).join('|')));
  for (let i = 0; i < st.items.length; i++) for (let j = i + 1; j < st.items.length; j++) {
    const v = pop.Theta[i][j];
    if (v === 0 || added.has([st.items[i], st.items[j]].sort(byName).join('|'))) continue;
    out.push(`  ${st.items[i]} WITH ${st.items[j]}*${fmt(v, 6)};`);
  }
  if (pop.addRcov && pop.addRcov.length) {
    out.push('  ! misspecification (not in the analysis model):');
    pop.addRcov.forEach((r) => out.push(`  ${r.a} WITH ${r.b}*${fmt(r.cov, 6)};`));
  }
  for (const v of catItems) {
    const t = spec.thr.filter((x) => x.item === v).sort((a, b) => a.k - b.k);
    out.push(...wrapStmt(`[${t.map((x) => `${v}$${x.k}*${fmt(x.est)}`).join(' ')}];`));
  }
  return out;
}

/**
 * MODEL statements of the analysis model: the model structure, Mplus default identification (the first loading of
 * each factor fixed at 1). An indicator whose standardized loading has the opposite sign of that first indicator's
 * gets the start value −1: Mplus starts every loading at +1, and with several reverse-coded items and
 * MODEL = NOMEANSTRUCTURE the estimation then failed to converge in every replication (the 10-item Extraversion
 * model of Wolf & McNeish's DFI tutorial). A start value changes nothing at convergence.
 */
export function analysisLines(spec, st = structure(spec)) {
  const out = [];
  for (const f of st.factors) {
    const rows = spec.by.filter((x) => x.f === f);
    const marker = Math.sign(rows[0].est) || 1;
    out.push(...wrapStmt(`${f} BY ${rows.map((x, i) => (i > 0 && Math.sign(x.est) * marker < 0 ? `${x.ind}*-1` : x.ind)).join(' ')};`));
  }
  for (const w of spec.with) out.push(`  ${w.a} WITH ${w.b}${w.fixed && w.est === 0 ? '@0' : ''};`);
  return out;
}

function mcInput({ title, items, catItems, nthr, n, reps, seed, results, pop, estimator, analysis = [], model, meta }) {
  const L = [];
  if (meta) {
    const json = JSON.stringify(meta);
    for (let i = 0; i < json.length; i += 64) L.push(`! ANALYSIS-WORKBENCH ${json.slice(i, i + 64)}`);
  }
  L.push(`TITLE: ${title}`, 'MONTECARLO:', ...wrapStmt(`NAMES = ${items.join(' ')};`));
  if (catItems.length) {
    L.push(...wrapStmt(`GENERATE = ${catItems.map((v) => `${v} (${nthr[v]})`).join(' ')};`));
    L.push(...wrapStmt(`CATEGORICAL = ${catItems.join(' ')};`));
  }
  L.push(`  NOBSERVATIONS = ${Math.trunc(n)};`, `  NREPS = ${Math.trunc(reps)};`, `  SEED = ${Math.trunc(seed)};`, `  RESULTS = ${results};`);
  L.push('MODEL POPULATION:', ...pop, 'ANALYSIS:', `  ESTIMATOR = ${estimator};`, ...analysis, 'MODEL:', ...model, 'OUTPUT: TECH9;');
  return L.join('\n') + '\n';
}

// the seeds of dynamic's cfaHB/hier1HB/catHB (its cfaOne/catOne use 326267/649364); Mplus draws its own random
// numbers, so the values fix the runs but do not reproduce dynamic's data sets
export const DEFAULTS = { reps: 500, nmax: 2000, seedTrue: 267326, seedMisspec: 269854 };

/**
 * Plans a DFI study from a standardized model.
 * spec = {by, with, thr, n}; opts = {type: 'auto'|'one'|'multi'|'hier', dataType: 'auto'|'continuous'|'categorical',
 *         estimator, reps, nmax, seedTrue, seedMisspec, meta}
 * → {type, dataType, estimator, n, nSim, reps, st, catItems, levels: [{level, label, addBy, addRcov, added}],
 *    misspec, files: [{name, text, level, kind, out, res}]}
 */
export function planDfi(spec, opts = {}) {
  const o = { ...DEFAULTS, type: 'auto', dataType: 'auto', signs: 'invariant', ...opts };
  const signs = o.signs === 'dynamic' ? 'dynamic' : 'invariant';
  const st = structure(spec);
  if (!fin(spec.n) || spec.n < 2) throw new Error('The sample size is unknown.');
  // degrees of freedom of the analysis model (Mplus default identification: first loading fixed, exogenous factors
  // correlated); with none the model cannot misfit, and dynamic stops (as does McNeish & Wolf, 2023a, fn. 6)
  {
    const pairs = new Set();
    const exo = st.factors.filter((f) => !spec.by.some((x) => x.ind === f));
    for (let i = 0; i < exo.length; i++) for (let j = i + 1; j < exo.length; j++) pairs.add([exo[i], exo[j]].sort(byName).join('|'));
    spec.with.filter((w) => !(w.fixed && w.est === 0)).forEach((w) => pairs.add([w.a, w.b].sort(byName).join('|')));
    // p(p+1)/2 moments − [(loadings − factors) + factor (disturbance) variances + p residual variances + covariances]
    const p = st.items.length;
    const df = (p * (p + 1)) / 2 - (spec.by.length - st.factors.length + st.factors.length + p + pairs.size);
    if (df <= 0) throw new Error(`The model has no degrees of freedom (df = ${df}), so its fit cannot be tested and there are no dynamic cutoffs.`);
  }
  let dataType = o.dataType;
  if (dataType === 'auto') dataType = spec.thr.length ? 'categorical' : 'continuous';
  if (dataType === 'categorical' && !spec.thr.length) throw new Error('Categorical data need thresholds (a WLSMV model or thresholds entered by hand).');
  const catItems = dataType === 'categorical' ? st.items.filter((x) => spec.thr.some((t) => t.item === x)) : [];
  const nthr = {};
  spec.thr.forEach((t) => { nthr[t.item] = (nthr[t.item] || 0) + 1; });
  const estimator = String(o.estimator || (dataType === 'categorical' ? 'WLSMV' : 'ML')).toUpperCase();
  if (catItems.length && !/^(WLS|ULS)/.test(estimator)) throw new Error('Categorical data need a WLS- or ULS-family estimator (e.g., WLSMV).');
  // the observed fit comes from an ordinal (WLSMV-type) model but the cutoffs from ML with normal data (the "as
  // dynamic" option): the two are on different metrics, so the report does not compare them
  const srcEstimator = spec.estimator ? String(spec.estimator).toUpperCase() : null;
  const estMismatch = (spec.thr.length > 0 || /^(WLS|ULS)/.test(srcEstimator || '')) && dataType !== 'categorical';
  let type = o.type;
  if (type === 'auto') type = st.higher.length ? 'hier' : st.factors.length === 1 ? 'one' : 'multi';
  if (type === 'one' && st.factors.length !== 1) throw new Error('A one-factor analysis needs a one-factor model.');
  if (type === 'multi' && st.higher.length) throw new Error('A higher-order model needs the higher-order analysis.');
  if (type === 'multi' && st.factors.length < 2) throw new Error('A multi-factor analysis needs at least two factors.');
  if (type === 'hier' && !st.higher.length) throw new Error('A higher-order analysis needs a higher-order factor.');

  // signSensitive: the signs setting changes a misspecification's sign; l1Differs: it changes the one-factor Level 1
  let levels, misspec, signSensitive, l1Differs = false;
  if (type === 'one') {
    misspec = misspecOne(spec, st, signs);
    levels = misspec.levels.map((k, i) => {
      const pr = misspec.pairs.slice(0, k);
      return { level: i + 1, addBy: [], addRcov: pr, added: `${k} residual correlation${k > 1 ? 's' : ''} (${pr.some((x) => x.rcor < 0) ? '±' : ''}.30)` };
    });
    const sgn = Object.fromEntries(spec.by.map((x) => [x.ind, Math.sign(x.est)]));
    signSensitive = misspec.pairs.some((x) => sgn[x.a] * sgn[x.b] < 0);
    l1Differs = misspec.paperL1 !== misspec.dynL1;
  } else {
    misspec = misspecHB(spec, st, type, signs);
    levels = misspec.map((s, i) => ({ level: i + 1, addBy: misspec.slice(0, i + 1).map((x) => ({ f: x.target, ind: x.item, est: x.est })), addRcov: [], added: `${s.target} BY ${s.item} (${f3(s.est).replace(/^-/, '−')})` }));
    signSensitive = misspec.some((s) => s.loading < 0 || s.phi < 0);
  }
  // second-order models: structural misspecification as well (hier2), as levels S1, S2, … on the same correct model
  let slevels = [], structural = null;
  if (type === 'hier') {
    const s = misspecHier2(spec, st, signs);
    structural = { k: s.k, reason: s.reason, note: null };
    for (const [i, k] of s.levels.entries()) {
      const pr = s.pairs.slice(0, k);
      try { population(spec, st, [], [], pr); } catch (e) { structural.note = e.message; break; } // inadmissible: stop here
      // the label names what this level adds to the previous one, as for the cross-loading levels
      const nw = pr.slice(i ? s.levels[i - 1] : 0);
      slevels.push({ level: i + 1, addBy: [], addRcov: [], addPsi: pr, added: `${nw.map((x) => `${x.a} WITH ${x.b}`).join(', ')} (${nw.some((x) => x.r < 0) ? '±' : ''}.50)` });
    }
    if (misspecHier2(spec, st, 'invariant').pairs.some((x) => x.r < 0)) signSensitive = true;
  }
  // the cutoff rule of the main table: dynamic's categorical functions (catOne/catHB) and McNeish (2023) keep 95%
  // specificity and lower the sensitivity; the omitted-path papers and hier1HB use 95/5 with a 90/10 fallback
  const rule = dataType === 'categorical' && type !== 'hier' ? 'sens' : 'hb';
  const nSim = Math.min(Math.round(spec.n), o.nmax);
  const ana = analysisLines(spec, st);
  // the empirical model was fit without a mean structure (readMplusOut): simulate the same way, or SRMR differs
  const noMeans = !!spec.noMeans && !catItems.length;
  const analysisOpts = noMeans ? ['  MODEL = NOMEANSTRUCTURE;', '  INFORMATION = EXPECTED;'] : [];
  const cont = st.items.filter((x) => !catItems.includes(x));
  const base = cont.length ? wrapStmt(`${cont.join(' ')};`) : [];
  const files = [];
  const all = [{ level: 0, addBy: [], addRcov: [], family: 'm' }, ...levels.map((l) => ({ ...l, family: 'm' })), ...slevels.map((l) => ({ ...l, family: 's' }))];
  for (const lv of all) {
    const pop = population(spec, st, lv.addBy, lv.addRcov, lv.addPsi || []);
    const pl = popLines(spec, st, pop, lv.addBy, catItems);
    const seed = lv.level === 0 ? o.seedTrue : o.seedMisspec;
    const s = lv.family === 's';
    const lab = lv.level === 0 ? 'true model (Level 0)' : s ? `structural level ${lv.level} misspecification` : `Level ${lv.level} misspecification`;
    for (const kind of ['model', 'base']) {
      const stem = `dfi_${s ? 'S' : 'L'}${lv.level}_${kind}`;
      const res = `${stem}_res.dat`;
      const meta = o.meta ? { ...o.meta, dfi: { level: lv.level, family: lv.family, kind } } : null;
      const text = mcInput({
        title: `DFI ${lab}, ${kind === 'model' ? 'analysis model' : 'baseline model'}`, items: st.items, catItems, nthr,
        n: nSim, reps: o.reps, seed, results: res, pop: pl, estimator, analysis: analysisOpts, model: kind === 'model' ? ana : base, meta,
      });
      files.push({ name: `${stem}.inp`, out: `${stem}.out`, res, text, level: lv.level, kind, family: lv.family });
    }
  }
  return { type, dataType, estimator, srcEstimator, estMismatch, noMeans, rule, signs, signSensitive, l1Differs, n: spec.n, nSim, reps: o.reps, nmax: o.nmax, seeds: { true: o.seedTrue, misspec: o.seedMisspec }, st, catItems, levels, slevels, structural, misspec, files };
}

// ---------------------------------------------------------------- reading the Monte Carlo runs
const RES_KEY = { 'Chi-square : Value': 'chisq', 'Chi-square : Degrees of Freedom': 'df', 'Chi-square : P-Value': 'pvalue', 'RMSEA : Estimate': 'rmsea', SRMR: 'srmr', 'Number of Free Parameters': 'npar' };

/**
 * Reads one Monte Carlo run: the RESULTS file (layout from the "Order of data" list of the output) and the
 * TECH9 messages per replication.
 * → {ok, error, requested, completed, rows: [{rep, chisq, df, ...}], tech9: {rep: [messages]}, improper: Set(rep)}
 */
export function readMcRun(outText, resText) {
  const o = String(outText ?? '').replace(/\r/g, '');
  const lines = o.split('\n');
  const r = { ok: false, error: null, requested: NaN, completed: NaN, rows: [], tech9: {}, improper: new Set() };
  const ei = lines.findIndex((l) => /^\s*\*\*\* ERROR/.test(l));
  if (ei >= 0) { r.error = lines.slice(ei, ei + 5).map((x) => x.trim()).filter(Boolean).join(' '); return r; }
  const rq = o.match(/Requested\s+(\d+)/), cp = o.match(/Completed\s+(\d+)/);
  if (rq) r.requested = Number(rq[1]);
  if (cp) r.completed = Number(cp[1]);
  const s = lines.findIndex((l) => /^\s*Order of data\s*$/.test(l));
  if (s < 0 || resText == null) { r.error = 'The run saved no Monte Carlo results.'; return r; }
  let e = s + 1;
  while (e < lines.length && !/^\s*Save file\s*$/.test(lines[e])) e++;
  const lab = lines.slice(s + 1, e).map((x) => x.trim()).filter((x) => x && !x.startsWith('('));
  const fitlab = lab.filter((x) => !['Replication number', 'Parameter estimates', 'Standard errors'].includes(x));
  const names = fitlab.map((x) => RES_KEY[x] || x.replace(/[^A-Za-z0-9]+/g, '_'));
  const rl = String(resText).replace(/\r/g, '').split('\n');
  const recs = [];
  let cur = null;
  for (const ln of rl) {
    if (/^\s*\d+\s*$/.test(ln)) { if (cur) recs.push(cur); cur = [Number(ln.trim())]; }
    else if (cur && ln.trim()) cur.push(...ln.trim().split(/\s+/).map(num));
  }
  if (cur) recs.push(cur);
  const lens = {};
  recs.forEach((x) => { lens[x.length] = (lens[x.length] || 0) + 1; });
  const modal = Number(Object.keys(lens).sort((a, b) => lens[b] - lens[a])[0]);
  for (const x of recs) {
    if (x.length !== modal) continue;
    const v = x.slice(x.length - fitlab.length);
    const row = { rep: x[0] };
    names.forEach((nm, i) => { row[nm] = v[i]; });
    r.rows.push(row);
  }
  // TECH9: messages per replication
  const t9 = lines.findIndex((l) => /^TECHNICAL 9 OUTPUT/.test(l));
  if (t9 >= 0) {
    let rep = null;
    for (let j = t9 + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\S/.test(l)) break;
      const m = l.match(/^\s*REPLICATION\s+(\d+):/);
      if (m) { rep = Number(m[1]); r.tech9[rep] = []; continue; }
      if (rep != null && l.trim()) r.tech9[rep].push(l.trim());
    }
    for (const [k, msgs] of Object.entries(r.tech9)) {
      const txt = msgs.join(' ');
      if (/NOT POSITIVE DEFINITE|NEGATIVE (RESIDUAL )?VARIANCE|NON-POSITIVE DEFINITE/i.test(txt)) r.improper.add(Number(k));
      r.tech9[k] = txt;
    }
  }
  r.ok = r.rows.length > 0;
  if (!r.ok) r.error = 'No replication results could be read.';
  return r;
}

export const cfiOf = (cm, dm, cb, db) => { const n = Math.max(cm - dm, 0), d = Math.max(cm - dm, cb - db, 0); return d === 0 ? 1 : 1 - n / d; };
export const tliOf = (cm, dm, cb, db) => ((cb / db) - (cm / dm)) / ((cb / db) - 1);

/** Merges the analysis-model and baseline runs of one level: rows with CFI and TLI, and an improper flag. */
export function combineLevel(level, model, base) {
  const b = new Map(base.rows.map((x) => [x.rep, x]));
  const rows = [];
  for (const m of model.rows) {
    const x = b.get(m.rep);
    if (!x) continue;
    rows.push({ level, rep: m.rep, chisq: m.chisq, df: m.df, pvalue: m.pvalue, rmsea: m.rmsea, srmr: m.srmr, chisqBase: x.chisq, dfBase: x.df, cfi: cfiOf(m.chisq, m.df, x.chisq, x.df), tli: tliOf(m.chisq, m.df, x.chisq, x.df), improper: model.improper.has(m.rep) });
  }
  return rows;
}

// ---------------------------------------------------------------- cutoff rules
/** Quantile, type 7 (R's default). */
export function quantile(values, p) {
  const v = values.filter(fin).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = (v.length - 1) * p, lo = Math.floor(h), hi = Math.min(lo + 1, v.length - 1);
  return v[lo] + (h - lo) * (v[hi] - v[lo]);
}
const col = (rows, k) => rows.map((x) => x[k]);

/**
 * 95/5 rule with 90/10 fallback, per index (McNeish & Wolf, 2023a, 2023b; dynamic::hier1HB, and cfaHB/cfaOne of
 * CRAN dynamic 1.1.0): {value, rule: '95/5'|'90/10'|null}. Strict comparisons, as in dynamic's code.
 */
export function hbCutoff(M, T, idx) {
  let m, t, ok;
  if (idx === 'cfi') { m = [quantile(col(M, 'cfi'), 0.95), quantile(col(M, 'cfi'), 0.9)]; t = [quantile(col(T, 'cfi'), 0.05), quantile(col(T, 'cfi'), 0.1)]; ok = [t[0] > m[0], t[1] > m[1]]; }
  else { m = [quantile(col(M, idx), 0.05), quantile(col(M, idx), 0.1)]; t = [quantile(col(T, idx), 0.95), quantile(col(T, idx), 0.9)]; ok = [t[0] < m[0], t[1] < m[1]]; }
  return ok[0] ? { value: m[0], rule: '95/5', m, t } : ok[1] ? { value: m[1], rule: '90/10', m, t } : { value: NaN, rule: null, m, t };
}

/**
 * Highest sensitivity (1% grid) that keeps 95% specificity; NONE below 50% sensitivity (dynamic::catOne/catHB, and
 * cfaOne/cfaHB since GitHub commit c8964ce of 2024-05-09; the rule of McNeish, 2023, and McNeish & Wolf, 2024; the
 * 50% floor is the package's): {value, sens, specCut}.
 */
export function sensCutoff(M, T, idx) {
  const power = [];
  for (let i = 95; i >= 0; i--) power.push(i / 100);
  let t, mq, ok;
  if (idx === 'cfi') { t = quantile(col(T, 'cfi'), 0.05); mq = power.map((p) => quantile(col(M, 'cfi'), p)); ok = mq.map((x) => x <= t); }
  else { t = quantile(col(T, idx), 0.95); mq = power.map((p) => quantile(col(M, idx), Math.round((1 - p) * 100) / 100)); ok = mq.map((x) => x >= t); }
  const k = ok.indexOf(true) >= 0 ? ok.indexOf(true) : power.length - 1;
  const sens = power[k];
  return { value: sens < 0.5 ? NaN : mq[k], sens, specCut: t };
}

export const INDICES = ['srmr', 'rmsea', 'cfi'];

/**
 * Summary of a finished DFI study. runs: {[fileName]: {out, res}} texts of the .out and _res.dat files;
 * policy: 'include' | 'exclude' (improper solutions).
 * → {ok, error, levels: [{level, added, completed, improper, used, hb: {idx: cut}, sens: {idx: cut}}],
 *    level0: {completed, improper, used, spec: {idx: value}}, rows (all replications), policy}
 */
export function summarizeDfi(plan, runs, policy = 'include') {
  const lv = [0, ...plan.levels.map((x) => x.level)];
  const parsed = {};
  for (const f of plan.files) {
    const r = runs[f.name];
    if (!r || r.out == null) return { ok: false, error: `${f.out} is missing.` };
    const p = readMcRun(r.out, r.res);
    if (!p.ok) return { ok: false, error: `${f.out}: ${p.error}` };
    parsed[f.name] = p;
  }
  const rows = [];
  const byLevel = {};
  for (const L of lv) {
    const m = parsed[`dfi_L${L}_model.inp`], b = parsed[`dfi_L${L}_base.inp`];
    byLevel[L] = combineLevel(L, m, b);
    rows.push(...byLevel[L]);
  }
  for (const l of plan.slevels || []) { // structural levels of second-order models: keys S1, S2, …
    const key = `S${l.level}`;
    byLevel[key] = combineLevel(key, parsed[`dfi_S${l.level}_model.inp`], parsed[`dfi_S${l.level}_base.inp`]);
    rows.push(...byLevel[key]);
  }
  const use = (rs) => (policy === 'exclude' ? rs.filter((x) => !x.improper) : rs);
  const T = use(byLevel[0]);
  const out = { ok: true, error: null, policy, rule: plan.rule || 'hb', rows, reps: plan.reps };
  out.level0 = { completed: byLevel[0].length, improper: byLevel[0].filter((x) => x.improper).length, used: T.length, spec: {} };
  INDICES.forEach((idx) => { out.level0.spec[idx] = idx === 'cfi' ? quantile(col(T, 'cfi'), 0.05) : quantile(col(T, idx), 0.95); });
  const cuts = (l, key) => {
    const M = use(byLevel[key]);
    const hb = {}, sens = {};
    INDICES.forEach((idx) => {
      hb[idx] = M.length >= 2 && T.length >= 2 ? hbCutoff(M, T, idx) : { value: NaN, rule: null };
      sens[idx] = M.length >= 2 && T.length >= 2 ? sensCutoff(M, T, idx) : { value: NaN, sens: 0 };
    });
    return { level: l.level, key, added: l.added, completed: byLevel[key].length, improper: byLevel[key].filter((x) => x.improper).length, used: M.length, hb, sens };
  };
  out.levels = plan.levels.map((l) => cuts(l, l.level));
  out.slevels = (plan.slevels || []).map((l) => cuts(l, `S${l.level}`));
  out.byLevel = byLevel;
  return out;
}

/**
 * Where the empirical fit falls relative to the cutoffs: [{idx, value, beyond: k (the levels with a cutoff are
 * exceeded up to level k, and the next one with a cutoff is not; 0 = within the first), top: the highest level with
 * a cutoff, cut: [...], any}].
 */
export function interpret(emp, summary, rule = summary && summary.rule ? summary.rule : 'hb', family = 'm') {
  if (!emp || !summary || !summary.ok) return [];
  const levels = family === 's' ? summary.slevels || [] : summary.levels;
  if (!levels.length) return [];
  return INDICES.map((idx) => {
    const e = emp[idx];
    const cut = levels.map((l) => (rule === 'hb' ? l.hb[idx].value : l.sens[idx].value));
    // as in McNeish & Wolf (2023a, Table 10): the index is read at the first level whose cutoff it passes, so beyond =
    // the last level exceeded before that one (levels with NONE are skipped; cutoffs of neighbouring levels can
    // swap order through Monte Carlo error)
    // compared as printed (three decimals), so that the text never says ".038 exceeded the cutoff of .038"; a value
    // equal to the cutoff passes, as in the paper's notation (RMSEA ≤ .038, CFI ≥ .986)
    const r3 = (x) => Math.round(x * 1000) / 1000;
    let beyond = 0;
    if (fin(e)) for (let i = 0; i < cut.length; i++) {
      if (!fin(cut[i])) continue;
      if (idx === 'cfi' ? r3(e) < r3(cut[i]) : r3(e) > r3(cut[i])) beyond = i + 1; else break;
    }
    const top = cut.reduce((a, c, i) => (fin(c) ? i + 1 : a), 0); // the highest level with a cutoff (NONE skipped)
    return { idx, value: e, beyond, top, cut, any: cut.some(fin) };
  });
}
