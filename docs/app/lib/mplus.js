// Mplus adapter of Dynamic Fit for Mplus: writes the input file of the empirical CFA (raw-data path).
// The Monte Carlo inputs of the dynamic fit study are written by lib/dfi.js; Mplus outputs are read there too.
// Plain ES module without DOM access: runs in the browser and in Node.
//
// Mplus 8.3 rules followed here: input lines ≤ 90 characters (wrapped at ~76), variable names ≤ 8
// characters, pure ASCII input (Mplus reads file names and text in the system code page), and the data
// file is referenced by a relative name next to the input.
import { readMplusOut } from './dfi.js';

export const LINE_MAX = 76;
export const META_TAG = 'ANALYSIS-WORKBENCH';

const TR_ASCII = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ç: 'c', Ç: 'C', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U' };
const ascii = (s) => String(s ?? '')
  .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TR_ASCII[c])
  .replace(/\p{Pd}/gu, '-')
  .normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^\x20-\x7e]/g, '');

/** "HEAD item item ...TAIL" split over lines of at most LINE_MAX characters. */
export function wrap(head, items, indent = '  ', tail = ';') {
  const lines = [];
  let cur = indent + head;
  items.forEach((it, i) => {
    const sep = i === 0 && (head === '' || /[[(]$/.test(head)) ? '' : ' ';
    if (i > 0 && (cur + sep + it + tail).length > LINE_MAX) {
      lines.push(cur);
      cur = indent + '  ' + it;
    } else cur += sep + it;
  });
  lines.push(cur + tail);
  return lines;
}

// Splits s into pieces of at most n characters without cutting next to a space
// (Mplus may trim the echoed comment lines, so a piece must not start or end with a space).
function chunks(s, n) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    let j = Math.min(s.length, i + n);
    while (j < s.length && j > i + 1 && (s[j - 1] === ' ' || s[j] === ' ')) j--;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}
/** The "! ANALYSIS-WORKBENCH {json}" comment lines that identify an input (pure ASCII). */
export function metaLines(meta) {
  const json = JSON.stringify(meta).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return chunks(json, 64).map((p) => `! ${META_TAG} ${p}`);
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;

/**
 * Input of the empirical CFA (raw-data path).
 * spec = {title, dataFile: 'data.dat', names: [columns of data.dat, in order], missing: -999,
 *         estimator: 'ML' | 'MLR' | 'WLSMV', categorical: bool,
 *         factors: [{name, items: [Mplus names]}], second: {name} | null, meta?}
 * Throws an Error (English message) when the spec cannot produce a valid input.
 */
export function buildCfaInp(spec) {
  const names = (spec.names || []).map(String);
  const factors = (spec.factors || []).filter((f) => f.items && f.items.length);
  const estimator = ['ML', 'MLR', 'WLSMV'].includes(String(spec.estimator).toUpperCase()) ? String(spec.estimator).toUpperCase() : 'ML';
  const missing = Number.isFinite(Number(spec.missing)) ? Number(spec.missing) : -999;
  const dataFile = String(spec.dataFile || 'data.dat');
  const all = [...names, ...factors.map((f) => f.name), ...(spec.second ? [spec.second.name] : [])];
  const bad = all.filter((n) => !NAME_RE.test(n));
  if (!names.length) throw new Error('No variable names for the Mplus NAMES list.');
  if (bad.length) throw new Error(`Invalid Mplus name(s): ${bad.join(', ')} (letters, digits and _, at most 8 characters, letter first).`);
  const upper = all.map((n) => n.toUpperCase());
  if (new Set(upper).size !== upper.length) throw new Error('Variable and factor names must be unique (Mplus ignores case).');
  if (!factors.length) throw new Error('The model has no factors.');
  const used = factors.flatMap((f) => f.items);
  const unknown = used.filter((v) => !names.some((n) => n.toUpperCase() === v.toUpperCase()));
  if (unknown.length) throw new Error(`Item(s) not in the data file: ${unknown.join(', ')}.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dataFile)) throw new Error('The data file name must be a plain ASCII file name.');
  const L = [...metaLines({ app: 'dynamic-fit-mplus', v: 1, engine: 'mplus', model: 'cfa', estimator, ...(spec.meta || {}) })];
  const title = ascii(spec.title || 'Confirmatory factor analysis').replace(/[;:!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Confirmatory factor analysis';
  L.push('TITLE:', '  ' + title, '', 'DATA:', `  FILE = ${dataFile};`, '', 'VARIABLE:');
  L.push(...wrap('NAMES =', names));
  L.push(...wrap('USEVARIABLES =', used));
  L.push(`  MISSING = ALL (${missing});`);
  if (spec.categorical) L.push(...wrap('CATEGORICAL =', used));
  L.push('', 'ANALYSIS:', `  ESTIMATOR = ${estimator};`, '', 'MODEL:');
  for (const f of factors) L.push(...wrap(`${f.name} BY`, f.items));
  if (spec.second) L.push(...wrap(`${spec.second.name} BY`, factors.map((f) => f.name)));
  L.push('', 'OUTPUT:', '  SAMPSTAT STDYX;');
  return L.join('\n') + '\n';
}

/** The first error message of an Mplus output (or ''), for short error callouts. */
export function firstError(text) {
  const r = readMplusOut(text);
  return (r.errors && r.errors[0]) || '';
}
