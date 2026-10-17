// Data helpers of the Analysis Workbench: read a delimited text table, describe it, correlate,
// and write engine input files (Mplus .dat, CSV for R / webR).
// Plain ES module without DOM access: runs in the browser and in Node.

// Cell values that always count as missing (compared in upper case)
const MISSING_TOKENS = new Set(['', 'NA', 'N/A', 'NAN', '.', 'NULL', '#N/A', '#NULL!', 'MISSING', '-']);
const isNumLike = (s) => /^[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?$/.test(s);

function splitLine(line, d) {
  if (d === ' ') return line.trim().split(/\s+/);
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Delimiter: the candidate that splits the first lines into the same number (≥ 2) of fields.
// Priority among consistent candidates: tab, semicolon (decimal-comma files), comma, pipe; else whitespace.
function detectDelimiter(lines) {
  const sample = lines.slice(0, 8);
  for (const d of ['\t', ';', ',', '|']) {
    const counts = sample.map((l) => splitLine(l, d).length);
    if (counts[0] >= 2 && counts.every((c) => c === counts[0])) return d;
  }
  for (const d of ['\t', ';', ',', '|']) {
    if (sample.length && splitLine(sample[0], d).length >= 2) return d;
  }
  return ' ';
}

/**
 * Reads a delimited text table (CSV, semicolon or tab separated, or whitespace separated like Mplus .dat).
 * @param {string} text
 * @param {{missingCodes?: (string|number)[]}} [opts] values treated as missing (default ['-999'])
 * @returns {{columns: string[], rows: (number|null)[][], nRows: number, nCols: number, delimiter: string,
 *   decimalComma: boolean, hasHeader: boolean, nonNumeric: number[], sampleBad: (string|null)[],
 *   coded: boolean[], levels: (string[]|null)[]}}
 *   rows are row-major; null = missing. delimiter is ',', ';', '\t', '|' or ' ' (whitespace).
 *   Columns that are mostly text (e.g. team names) are coded 1..k in order of appearance (coded[j] = true,
 *   levels[j] = the labels). Stray non-numeric cells in numeric columns become null (count in nonNumeric[j]).
 */
export function parseTable(text, { missingCodes = ['-999'] } = {}) {
  const src = String(text ?? '').replace(/^\u{FEFF}/u, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n').filter((l) => l.trim().length);
  const delimiter = detectDelimiter(lines);
  let raw = lines.map((l) => splitLine(l, delimiter));
  const first = raw[0] || [];
  const hasHeader = first.some((c) => c && !isNumLike(c) && !MISSING_TOKENS.has(c.toUpperCase()));
  const nCols = Math.max(first.length, ...raw.slice(0, 50).map((r) => r.length), 0);
  let columns;
  if (hasHeader) {
    const seen = new Map();
    columns = Array.from({ length: nCols }, (_, i) => {
      let c = String(first[i] ?? '').replace(/^"|"$/g, '').trim() || `V${i + 1}`;
      const k = c.toUpperCase();
      if (seen.has(k)) { const n = seen.get(k) + 1; seen.set(k, n); c = `${c}_${n}`; } else seen.set(k, 1);
      return c;
    });
    raw = raw.slice(1);
  } else {
    columns = Array.from({ length: nCols }, (_, i) => `V${i + 1}`);
  }
  // Decimal comma: only when the delimiter is not a comma and most numeric cells look like "1,5"
  let decimalComma = false;
  if (delimiter !== ',') {
    let commaNums = 0;
    let dotNums = 0;
    for (const r of raw.slice(0, 300)) for (const c of r) {
      if (/^[-+]?\d*,\d+$/.test(c)) commaNums++;
      else if (/^[-+]?\d*\.\d+$/.test(c)) dotNums++;
    }
    decimalComma = commaNums > dotNums;
  }
  const missStr = new Set(missingCodes.map((m) => String(m).trim()).filter((m) => m !== ''));
  const missNum = new Set([...missStr].map(Number).filter(Number.isFinite));
  const isMissing = (c) => MISSING_TOKENS.has(c.toUpperCase()) || missStr.has(c);
  const nRows = raw.length;
  const rows = raw.map(() => new Array(nCols).fill(null));
  const nonNumeric = new Array(nCols).fill(0);
  const sampleBad = new Array(nCols).fill(null);
  const valid = new Array(nCols).fill(0);
  raw.forEach((r, i) => {
    for (let j = 0; j < nCols; j++) {
      let c = r[j] === undefined ? '' : r[j];
      if (isMissing(c)) continue;
      if (decimalComma) c = c.replace(',', '.');
      const v = isNumLike(c) ? Number(c) : NaN;
      if (Number.isNaN(v)) { nonNumeric[j]++; if (sampleBad[j] === null) sampleBad[j] = c; continue; }
      if (missNum.has(v)) continue;
      rows[i][j] = v;
      valid[j]++;
    }
  });
  // Mostly-text columns (e.g. "Team A") → codes 1..k
  const coded = new Array(nCols).fill(false);
  const levels = new Array(nCols).fill(null);
  for (let j = 0; j < nCols; j++) {
    if (!nonNumeric[j] || nonNumeric[j] < valid[j]) continue;
    const map = new Map();
    raw.forEach((r, i) => {
      const c = r[j] === undefined ? '' : r[j];
      if (isMissing(c)) { rows[i][j] = null; return; }
      if (!map.has(c)) map.set(c, map.size + 1);
      rows[i][j] = map.get(c);
    });
    coded[j] = true;
    levels[j] = [...map.keys()];
    nonNumeric[j] = 0;
    sampleBad[j] = null;
  }
  return { columns, rows, nRows, nCols, delimiter, decimalComma, hasHeader, nonNumeric, sampleBad, coded, levels };
}

/** Index of a column (by name, case-insensitive fallback) or -1. */
export function colIndex(table, name) {
  if (typeof name === 'number') return name >= 0 && name < table.columns.length ? name : -1;
  const i = table.columns.indexOf(name);
  if (i >= 0) return i;
  const up = String(name).toUpperCase();
  return table.columns.findIndex((c) => c.toUpperCase() === up);
}

/** The values of one column (number|null)[]. */
export function column(table, name) {
  const j = colIndex(table, name);
  return j < 0 ? [] : table.rows.map((r) => r[j]);
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Descriptive statistics per column: {[col]: {n, missing, mean, sd, min, max}} (sd with n − 1).
 * Unknown columns are left out. Empty columns give NaN statistics.
 */
export function describe(table, cols = table.columns) {
  const out = {};
  for (const name of cols) {
    const j = colIndex(table, name);
    if (j < 0) continue;
    let n = 0, sum = 0, min = Infinity, max = -Infinity;
    for (const r of table.rows) { const v = r[j]; if (fin(v)) { n++; sum += v; if (v < min) min = v; if (v > max) max = v; } }
    const mean = n ? sum / n : NaN;
    let ss = 0;
    for (const r of table.rows) { const v = r[j]; if (fin(v)) ss += (v - mean) ** 2; }
    out[name] = { n, missing: table.nRows - n, mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN, min: n ? min : NaN, max: n ? max : NaN };
  }
  return out;
}

/**
 * Pearson correlation matrix of the given columns (array of arrays, same order as cols; diagonal 1).
 * Pairwise complete observations by default; {listwise: true} uses only rows complete on all cols.
 * The returned array also carries .n (matrix of pair counts) and .p (two-tailed p-values).
 */
export function corr(table, cols = table.columns, { listwise = false } = {}) {
  const idx = cols.map((c) => colIndex(table, c));
  const k = idx.length;
  const rows = listwise ? table.rows.filter((r) => idx.every((j) => j >= 0 && fin(r[j]))) : table.rows;
  const R = Array.from({ length: k }, () => new Array(k).fill(NaN));
  const N = Array.from({ length: k }, () => new Array(k).fill(0));
  const P = Array.from({ length: k }, () => new Array(k).fill(NaN));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      const ja = idx[a], jb = idx[b];
      if (ja < 0 || jb < 0) continue;
      let n = 0, sa = 0, sb = 0;
      for (const r of rows) if (fin(r[ja]) && fin(r[jb])) { n++; sa += r[ja]; sb += r[jb]; }
      if (n < 2) { N[a][b] = N[b][a] = n; continue; }
      const ma = sa / n, mb = sb / n;
      let saa = 0, sbb = 0, sab = 0;
      for (const r of rows) if (fin(r[ja]) && fin(r[jb])) { const da = r[ja] - ma, db = r[jb] - mb; saa += da * da; sbb += db * db; sab += da * db; }
      const r = a === b ? (saa > 0 ? 1 : NaN) : saa > 0 && sbb > 0 ? Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb))) : NaN;
      R[a][b] = R[b][a] = r;
      N[a][b] = N[b][a] = n;
      if (a !== b && Number.isFinite(r) && n > 2) {
        const p = Math.abs(r) >= 1 ? 0 : pT(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2);
        P[a][b] = P[b][a] = p;
      }
    }
  }
  Object.defineProperty(R, 'n', { value: N, enumerable: false });
  Object.defineProperty(R, 'p', { value: P, enumerable: false });
  return R;
}

// ---------- t distribution (for correlation p-values) ----------
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const ci of c) s += ci / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-tailed p-value of a t statistic with df degrees of freedom. */
export function pT(t, df) {
  if (!Number.isFinite(t) || !(df > 0)) return NaN;
  return ibeta(df / (df + t * t), df / 2, 0.5);
}

// ---------- writers ----------
function fmtNum(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Mplus free-format data: space-separated values, one row per line, no header; missing → the missing code.
 * cols: column names (or indices) in the order of the Mplus NAMES list.
 */
export function toMplusDat(table, cols, missing = -999) {
  const idx = cols.map((c) => colIndex(table, c));
  if (idx.some((j) => j < 0)) throw new Error(`Unknown column(s): ${cols.filter((_, i) => idx[i] < 0).join(', ')}`);
  const miss = String(missing);
  return table.rows.map((r) => idx.map((j) => (fin(r[j]) ? fmtNum(r[j]) : miss)).join(' ')).join('\n') + '\n';
}

function csvField(s) {
  const t = String(s);
  return /[",\r\n]|^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * CSV for R / webR: header row, comma separated, NA for missing values. Text columns that parseTable
 * coded 1..k are written with their text again, so reading the CSV back gives the same table.
 */
export function toCsv(table, cols) {
  const idx = cols.map((c) => colIndex(table, c));
  if (idx.some((j) => j < 0)) throw new Error(`Unknown column(s): ${cols.filter((_, i) => idx[i] < 0).join(', ')}`);
  const head = cols.map((c, i) => csvField(typeof c === 'number' ? table.columns[idx[i]] : c)).join(',');
  const levels = idx.map((j) => (table.coded && table.coded[j] && table.levels && table.levels[j]) || null);
  const cell = (v, k) => {
    if (!fin(v)) return 'NA';
    const lv = levels[k] && levels[k][v - 1];
    return lv != null ? csvField(lv) : String(v);
  };
  const body = table.rows.map((r) => idx.map((j, k) => cell(r[j], k)).join(','));
  return [head, ...body].join('\n') + '\n';
}

// ---------- Mplus variable names ----------
// Words Mplus reserves in its command language; they cannot be used as variable names.
const MPLUS_RESERVED = new Set(['ALL', 'AND', 'ARE', 'BY', 'EQ', 'GE', 'GT', 'IS', 'LE', 'LT', 'NE', 'NOT', 'ON', 'OR', 'PON', 'PWITH', 'TO', 'WITH', 'XWITH']);
const TR_ASCII = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ç: 'c', Ç: 'C', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U' };

/** ASCII transliteration (Turkish letters and accents), other non-ASCII characters removed. */
export function toAscii(s) {
  return String(s ?? '')
    .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TR_ASCII[c])
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '');
}

/** Is this a valid Mplus variable name? (≤ 8 characters, ASCII letters/digits/_, letter first, not reserved) */
export function isMplusName(name) {
  const s = String(name ?? '');
  return /^[A-Za-z][A-Za-z0-9_]{0,7}$/.test(s) && !MPLUS_RESERVED.has(s.toUpperCase());
}

/**
 * A valid, unique Mplus variable name for a column name or label: ASCII, upper case, ≤ 8 characters,
 * letter first, not a reserved word, not in `used` (Set or array; compared case-insensitively).
 * `used` is not modified — add the result yourself.
 */
export function mplusName(label, used = []) {
  const taken = new Set([...(used instanceof Set ? used : used || [])].map((u) => String(u).toUpperCase()));
  let base = toAscii(label).toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (!/^[A-Z]/.test(base)) base = 'V' + base;
  base = base.slice(0, 8);
  if (MPLUS_RESERVED.has(base)) base = (base + 'V').slice(0, 8);
  if (!taken.has(base) && isMplusName(base)) return base;
  for (let n = 2; n < 100000; n++) {
    const suf = String(n);
    const cand = base.slice(0, 8 - suf.length) + suf;
    if (!taken.has(cand) && isMplusName(cand)) return cand;
  }
  throw new Error('Could not find a free Mplus name.');
}
