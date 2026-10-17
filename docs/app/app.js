// Dynamic Fit for Mplus — interface controller ("live manuscript").
// Left: the control column walks through Data → Structure → Settings → Run → Report. Right: the APA 7 paper
// writes itself as you go. Every interface string has two versions, English first: t(en, tr);
// every manuscript string: tp(lang, en, tr). Built on the Analysis Workbench kit.
//
// The model comes from one of three sources: raw data (CSV; the CFA runs in Mplus first), an Mplus output of a
// fitted model (.out), or standardized estimates entered by hand. Dynamic fit index (DFI) cutoffs are then
// simulated with Mplus Monte Carlo runs written by lib/dfi.js (a port of the 'dynamic' R package).

// ===== APP CONFIG — the only two lines a project edits to pick its engines and languages =====
const ENGINES = ['mplus'];  // one or more of 'mplus' | 'r' | 'webr'
const LANGS = ['en'];       // add 'tr' to show the EN|TR switch (asked at project start)
// ===============================================================================================

import { parseTable, describe, toMplusDat, toCsv, mplusName, isMplusName } from './lib/data.js';
import * as R from './lib/report.js';
import { dfiChart, sparkline, esc } from './lib/charts.js';
import * as D from './lib/dfi.js';
import * as MP from './lib/mplus.js';

const APP = 'Dynamic Fit for Mplus';
const CFA = { input: 'cfa.inp', data: 'data.dat', out: 'cfa.out' };
const SOURCE_OUT = 'source.out';
const META = { app: 'dynamic-fit-mplus', v: 1 };

// The bundled sample data (data/sample.csv, made by tools/make-sample.mjs)
const SAMPLE = {
  file: 'sample.csv',
  id: 'ID',
  labels: {
    MAS1: 'Mastery 1', MAS2: 'Mastery 2', MAS3: 'Mastery 3', MAS4: 'Mastery 4',
    SELF1: 'Self-referenced 1', SELF2: 'Self-referenced 2', SELF3: 'Self-referenced 3', SELF4: 'Self-referenced 4',
    NORM1: 'Normative 1', NORM2: 'Normative 2', NORM3: 'Normative 3', NORM4: 'Normative 4',
  },
  model: {
    factors: [
      { name: 'MAS', label: 'Mastery attainment', items: ['MAS1', 'MAS2', 'MAS3', 'MAS4'] },
      { name: 'SELF', label: 'Self-referenced attainment', items: ['SELF1', 'SELF2', 'SELF3', 'SELF4'] },
      { name: 'NORM', label: 'Normative attainment', items: ['NORM1', 'NORM2', 'NORM3', 'NORM4'] },
    ],
    second: { on: true, name: 'GOAL', label: 'Goal attainment' },
    categorical: 'auto',
  },
};
// Example of the hand-entry path: the second-order A-SAGS model of Boivin et al. (TQMP, 2026), standardized
// loadings as reported there (N = 492). With continuous ML data this reproduces dynamic::hier1HB.
const EXAMPLE_MANUAL = {
  text: 'MGA BY ga1*.748 ga4*.848 ga7*.833 ga10*.950 ga13*.856;\nSRGA BY ga2*.942 ga5*.953 ga8*.906 ga11*.956;\nNGA BY ga3*.890 ga6*.956 ga9*.962 ga12*.951;\nGA BY MGA*.833 SRGA*.880 NGA*.912;',
  n: 492,
  fit: { cfi: '.975', rmsea: '.171', srmr: '.049' },
};

// ======================================================================
// State and language
// ======================================================================
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const pickLang = (v) => (LANGS.includes(v) ? v : LANGS[0]);
const PAGES = ['data', 'roles', 'model', 'run', 'report']; // routes #/data … #/report
const S = {
  health: null, projects: [], P: null, table: null, stats: {},
  route: { page: 'data' },
  srcText: null, srcRes: null, // source.out (Mplus output path)
  cfaRes: null,                // cfa.out read back (raw-data path)
  derived: null,               // {key, spec, specErr, plan, planErr}
  runs: {}, dfi: null,         // texts of the Monte Carlo outputs and their summary
  jobs: new Map(),             // file → latest job of the open project
  files: new Set(),            // file names in the project folder
  fileText: new Map(),         // file name → text (code sheet)
  outCache: new Map(),         // .out file name → {text, html, marks, h}: highlighted once per text
  ui: { lang: pickLang(store.get('aa.lang')), paperLang: null, pane: 'ctrl', sheet: null, editing: null, focusKey: null, missingDraft: null, openDetails: {}, openVar: null, ctrlW: 0, manualDraft: null },
  busy: false,
};
S.ui.paperLang = pickLang(store.get('aa.paperLang') || S.ui.lang);
// t(en, tr): interface text · tp(lang, en, tr): manuscript text in a given language
const t = (en, tr) => (S.ui.lang === 'tr' ? tr : en);
const tp = (lang, en, tr) => (lang === 'tr' ? tr : en);
const loc = () => (S.ui.lang === 'tr' ? 'tr-TR' : 'en-US');

// ======================================================================
// Helpers
// ======================================================================
const $ = (s, r = document) => r.querySelector(s);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const nf = (x, d = 2) => (fin(x) ? x.toFixed(d) : '—');
const nfL = (x, d = 0) => (fin(x) ? x.toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const f3 = (x) => (fin(x) ? D.f3(x) : '—');
const clock = (ms) => { const s = fin(ms) && ms > 0 ? Math.floor(ms / 1000) : 0; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const dur = (ms) => {
  if (!fin(ms) || ms < 0) return '—';
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return t(`${s} s`, `${s} sn`);
  return t(`${Math.floor(s / 60)} min ${s % 60} s`, `${Math.floor(s / 60)} dk ${s % 60} sn`);
};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const isActive = (j) => !!(j && (j.status === 'queued' || j.status === 'running'));
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
const numOr = (v) => { const x = Number(String(v ?? '').trim().replace(',', '.')); return String(v ?? '').trim() === '' || !Number.isFinite(x) ? NaN : x; };

// The web version (e.g. https://cahitgs.github.io/…/app/) is the same interface without a server: the analyses run in
// the app on this computer (DynamicFitMplus.exe or `node serve.mjs`), which serves this interface itself at
// http://localhost:port. The web version only asks whether the app is running (GET /api/health) and links to it;
// otherwise its first window offers the download. ?runner=PORT limits the search to one port (tests).
const LOOP = ['localhost', '127.0.0.1', '[::1]', '::1'];
const QS = new URLSearchParams(location.search);
const HOSTED = !(location.protocol === 'http:' && LOOP.includes(location.hostname)) || QS.has('hosted');
const EXE_URL = 'https://github.com/cahitgs/dynamic-fit-mplus/releases/latest/download/DynamicFitMplus.exe';
async function findRunner() {
  const ports = QS.get('runner') ? [Number(QS.get('runner'))] : Array.from({ length: 21 }, (_, i) => 3401 + i);
  const probe = async (p) => {
    const r = await fetch(`http://localhost:${p}/api/health`, { signal: AbortSignal.timeout(2500) });
    const h = await r.json();
    if (!r.ok || h.app !== 'dynamic-fit-mplus' || h.port !== p) throw new Error('not the app');
    return p;
  };
  try { return await Promise.any(ports.map(probe)); } catch { return null; }
}
async function api(path, opts = {}) {
  if (HOSTED) { // the web version has no server: the work is done in the app on this computer
    connectDlg();
    throw new Error(t('Projects are kept and run by the app on your computer; open it to continue.', 'Projeler bilgisayarınızdaki uygulamada saklanır ve çalıştırılır; devam etmek için onu açın.'));
  }
  const o = { ...opts };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers = { 'Content-Type': 'application/json' }; delete o.json; }
  const res = await fetch('/api' + path, o);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
const fileUrl = (name) => `/api/projects/${encodeURIComponent(S.P.id)}/files/${encodeURIComponent(name)}`;
// Where a project's files are on this computer (PROJECTS_DIR, or projects\ next to the server or the .exe)
function projectPath(id) {
  const dir = S.health && S.health.projectsDir;
  if (!dir) return `projects/${id}/`;
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${id}${sep}`;
}
async function getText(name) {
  const res = await fetch(fileUrl(name));
  if (!res.ok) throw new Error(t(`Could not read ${name}.`, `${name} okunamadı.`));
  return res.text();
}
async function putFile(name, text) {
  await api(`/projects/${encodeURIComponent(S.P.id)}/files/${encodeURIComponent(name)}`, { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  S.files.add(name);
  S.fileText.set(name, text);
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, kind === 'err' ? 7000 : 3800);
}
function confirmDlg(title, body, okLabel, danger = false) {
  return new Promise((resolve) => {
    const d = $('#dlg');
    d.onclick = null;
    d.innerHTML = `<form method="dialog" class="p-6"><h2 class="h2 mb-2">${esc(title)}</h2><p class="text-ink-2 small mb-5">${esc(body)}</p>
      <div class="flex justify-end gap-2"><button class="btn" value="no">${t('Cancel', 'Vazgeç')}</button><button class="btn ${danger ? 'btn-dark' : 'btn-primary'}" value="ok">${esc(okLabel || t('Continue', 'Devam et'))}</button></div></form>`;
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.returnValue = ''; // Escape must not reuse an earlier "ok"
    d.showModal();
  });
}
function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

const ICON = {
  upload: '<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  play: '<path d="M7 5.5v13l11-6.5-11-6.5Z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  download: '<path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 18.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 8v5m0 3h.01M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  arrow: '<path d="M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5"/>',
  back: '<path d="M19 12H5m0 0 5.5-5.5M5 12l5.5 5.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  refresh: '<path d="M19.5 12A7.5 7.5 0 1 1 17.3 6.7M19.5 4v5h-5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/>',
  model: '<circle cx="12" cy="6" r="2.6"/><circle cx="5.5" cy="18" r="2.4"/><circle cx="12" cy="18" r="2.4"/><circle cx="18.5" cy="18" r="2.4"/><path d="M10.6 8.3 6.7 15.8M12 8.6v7M13.4 8.3l3.9 7.5"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12h9l1-12M9.5 7V4.5h5V7"/>',
};
const icon = (n, s = 17) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;
const callout = (kind, body, ic) => `<div class="callout ${kind}">${icon(ic || (kind === 'warn' || kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info'), 16)}<div>${body}</div></div>`;
// Forward button (arrow capsule), card heading, status badge (open · hatched · violet moving hatch · solid ✓)
const nextBtn = (label, attrs = '', cls = 'btn-primary') => `<button class="btn btn-lg ${cls}" ${attrs}><span class="btn-t">${label}</span><span class="ico-pill end">${icon('arrow', 16)}</span></button>`;
const cardHead = (title, sub = '', tools = '', lead = '') => `<div class="card-h"><div class="flex items-start gap-3">${lead}<div class="min-w-0"><h2 class="h3">${title}</h2>${sub ? `<p class="small muted">${sub}</p>` : ''}</div></div>${tools ? `<div class="card-tools no-print">${tools}</div>` : ''}</div>`;
const badge = (n, state = 'open', cls = 'step-n', ic = 14) => `<span class="${cls} st-${state}">${state === 'done' ? icon('check', ic) : n}</span>`;
const tile = (label, value, sub = '') => `<div class="tile"><div class="tile-l">${esc(label)}</div><div class="tile-v">${esc(value)}</div>${sub ? `<div class="tile-s">${esc(sub)}</div>` : ''}</div>`;
// Sticky step bar at the bottom of the control column: ← back · status · main action (info is plain text)
function stepBar({ back = null, info = '', tone = 'ok', actions = '' } = {}) {
  const b = back ? `<button class="btn btn-ghost btn-lg sb-back" ${back.attrs} aria-label="${esc(back.label)}"><span class="ico-pill start">${icon('back', 16)}</span><span class="btn-t">${esc(back.label)}</span></button>` : '';
  const i = info ? `<span class="sb-dot ${tone}" aria-hidden="true"></span><span title="${esc(info)}">${esc(info)}</span>` : '';
  const paper = `<button class="btn btn-lg btn-icon sb-paper" data-act="pane" data-v="paper" aria-label="${t('Show the paper', 'Makaleyi göster')}" data-tip="${t('Paper', 'Makale')}">${icon('file', 18)}</button>`;
  return `<nav class="stepbar no-print" aria-label="${t('Step navigation', 'Adım gezintisi')}"><div class="sb-info ${info ? tone : ''}">${i}</div>${b}<div class="sb-actions">${paper}${actions}</div></nav>`;
}
const ctrlWrap = (head, body, bar = '') => `<div class="ctrl-inner">${head}<div class="cc-body">${body}</div>${bar}</div>`;
const ctrlHead = (eyebrow, title, lead = '', extra = '') => `<header class="cc-head"><div class="eyebrow">${eyebrow}</div><h1 class="h1" tabindex="-1">${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${extra}</header>`;

// ======================================================================
// Projects
// ======================================================================
function normalizeProject(p) {
  p.source = { mode: null, name: null, text: '', n: null, fit: { cfi: '', rmsea: '', srmr: '' }, ...(p.source || {}) };
  p.source.fit = { cfi: '', rmsea: '', srmr: '', ...(p.source.fit || {}) };
  p.data = { file: 'data.csv', name: null, missingCodes: ['-999'], ...(p.data || {}) };
  p.model = { factors: [], categorical: 'auto', id: null, ...(p.model || {}) };
  p.model.second = { on: false, name: 'G', label: 'General factor', ...(p.model.second || {}) };
  if (!Array.isArray(p.model.factors)) p.model.factors = [];
  p.vars = p.vars || {};
  p.design = { engine: 'mplus', estimator: 'auto', dataType: 'auto', reps: 500, policy: 'include', ...(p.design || {}) };
  p.design.engine = 'mplus';
  if (![100, 250, 500, 1000].includes(Number(p.design.reps))) p.design.reps = 500;
  p.design.reps = Number(p.design.reps);
  if (!['include', 'exclude'].includes(p.design.policy)) p.design.policy = 'include';
  if (!['auto', 'continuous'].includes(p.design.dataType)) p.design.dataType = 'auto';
  if (!['auto', 'ML', 'MLR', 'WLSMV'].includes(p.design.estimator)) p.design.estimator = 'auto';
  p.design.figColor = p.design.figColor === true; // Figure 1: black and white (APA default) or color
  p.design.signs = p.design.signs === 'dynamic' ? 'dynamic' : 'invariant'; // signs of the misspecifications (dynamic issue #7)
  p.runs = p.runs || {};
  p.edits = p.edits || {};
  return p;
}
let saveTimer = null, savePending = null;
function save() {
  if (!S.P) return;
  clearTimeout(saveTimer);
  savePending = S.P;
  saveTimer = setTimeout(() => { const pj = savePending; savePending = null; putProject(pj); }, 400);
}
async function putProject(pj = S.P) {
  if (!pj) return;
  try { const r = await api(`/projects/${encodeURIComponent(pj.id)}`, { method: 'PUT', json: pj }); pj.updated = r.updated; } catch (e) { toast(t('Could not save the project: ', 'Proje kaydedilemedi: ') + e.message, 'err'); }
}
async function saveNow() { clearTimeout(saveTimer); savePending = null; await putProject(S.P); }
// A change made just before the page is reloaded or closed is still saved (a keepalive request outlives the page)
function flushSave() {
  if (!savePending) return;
  clearTimeout(saveTimer);
  const pj = savePending;
  savePending = null;
  const body = JSON.stringify(pj);
  try {
    fetch(`/api/projects/${encodeURIComponent(pj.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 }).catch(() => {});
  } catch { /* the page is going away */ }
}
async function createProject(name) {
  const pj = await api('/projects', { method: 'POST', json: { name, engine: 'mplus' } });
  try { S.projects = await api('/projects'); } catch { /* list refreshes later */ }
  await openProject(pj.id);
}
function resetProjectState() {
  S.table = null; S.stats = {}; S.srcText = null; S.srcRes = null; S.cfaRes = null; S.derived = null; S.runs = {}; S.dfi = null;
  S.jobs = new Map(); S.files = new Set(); S.fileText = new Map(); S.outCache = new Map(); S.sheetName = null;
  S.ui.sheet = null; S.ui.editing = null; S.ui.missingDraft = null; S.ui.openVar = null; S.ui.manualDraft = null; S.ui.jumpLast = null;
}
async function openProject(id) {
  const pj = normalizeProject(await api(`/projects/${encodeURIComponent(id)}`));
  if (S.P && S.P.id !== id) await saveNow();
  S.P = pj;
  resetProjectState();
  S.paperQuietUntil = Date.now() + 4000;
  store.set('aa.last', id);
  try { (await api(`/projects/${encodeURIComponent(id)}/files`)).forEach((f) => S.files.add(f.name)); } catch { /* new folder */ }
  const mode = pj.source.mode;
  if (mode === 'csv' && S.files.has('data.csv')) {
    try { setTable(await getText('data.csv')); } catch (e) { toast(t('Could not read the data file: ', 'Veri dosyası okunamadı: ') + e.message, 'err'); }
  }
  if (mode === 'out' && S.files.has(SOURCE_OUT)) {
    try { setSource(await getText(SOURCE_OUT)); } catch (e) { toast(e.message, 'err'); }
  }
  try {
    for (const j of await api('/jobs')) {
      if (j.project !== id || j.engine !== 'mplus') continue;
      const cur = S.jobs.get(j.file);
      if (!cur || (j.created || 0) >= (cur.created || 0)) S.jobs.set(j.file, j);
    }
  } catch { /* server just started */ }
  if (mode === 'csv' && pj.runs.cfa && S.files.has(CFA.out) && !isActive(S.jobs.get(CFA.input))) await loadCfa();
  if (pj.runs.dfi && ['done', 'error'].includes(pj.runs.dfi.status) && !dfiActive()) await loadDfi();
  render();
}

// ======================================================================
// Sources: raw data (CSV), Mplus output (.out), estimates entered by hand
// ======================================================================
function setTable(text) {
  S.table = parseTable(text, { missingCodes: S.P.data.missingCodes || ['-999'] });
  computeStats();
}
function computeStats() {
  const tb = S.table;
  const d = describe(tb, tb.columns);
  S.stats = {};
  tb.columns.forEach((c, j) => {
    const v = tb.rows.map((r) => r[j]).filter(fin);
    const ints = v.every((x) => Number.isInteger(x));
    const levels = ints ? new Set(v).size : 0;
    S.stats[c] = { ...d[c], nonNumeric: tb.nonNumeric[j], coded: !!(tb.coded && tb.coded[j]), nLevels: tb.levels && tb.levels[j] ? tb.levels[j].length : 0, ints, cats: levels };
  });
}
const colValues = (c) => { const j = S.table.columns.indexOf(c); return j < 0 ? [] : S.table.rows.map((r) => r[j]); };
const isChoice = (c) => S.stats[c] && S.stats[c].n > 0 && !S.stats[c].coded;
function setSource(text) {
  S.srcText = text;
  S.srcRes = D.readMplusOut(text);
  S.fileText.set(SOURCE_OUT, text);
}
// Starting a new source replaces everything that belonged to the old one
async function resetSource(mode) {
  const P = S.P;
  P.source = { mode, name: null, text: '', n: null, fit: { cfi: '', rmsea: '', srmr: '' } };
  P.data = { file: 'data.csv', name: null, missingCodes: ['-999'] };
  P.model = { factors: [], categorical: 'auto', id: null, second: { on: false, name: 'G', label: 'General factor' } };
  P.vars = {};
  P.runs = {};
  P.edits = {};
  for (const [f, j] of S.jobs) if (!isActive(j)) S.jobs.delete(f);
  S.table = null; S.stats = {}; S.srcText = null; S.srcRes = null; S.cfaRes = null; S.derived = null; S.runs = {}; S.dfi = null;
  S.ui.sheet = null; S.ui.editing = null; S.ui.openVar = null; S.ui.manualDraft = null;
}
async function ensureProject(name) {
  if (!S.P) await createProject(name);
}
async function loadDataText(text, fileName, { sample = false } = {}) {
  const missingCodes = ['-999'];
  const tb = parseTable(text, { missingCodes });
  if (tb.nRows < 2 || tb.columns.length < 2) { toast(t('The file needs at least two columns and two rows.', 'Dosyada en az iki sütun ve iki satır olmalı.'), 'err'); return; }
  await ensureProject(sample ? 'Sample · goal attainment' : fileName.replace(/\.[^.]+$/, '') || 'Project');
  const P = S.P;
  await resetSource('csv');
  const used = new Set();
  const vars = {};
  for (const c of tb.columns) {
    const m = mplusName(c, used);
    used.add(m);
    const lab = sample && SAMPLE.labels[c] ? SAMPLE.labels[c] : c;
    vars[c] = { mplus: m, labelEn: lab, labelTr: lab };
  }
  P.vars = vars;
  P.source.name = fileName;
  P.data = { file: 'data.csv', name: fileName, missingCodes, nRows: tb.nRows, columns: tb.columns, delimiter: tb.delimiter, decimalComma: tb.decimalComma, rev: (P.data.rev || 0) + 1 };
  P.model.id = tb.columns.find((c) => /^(id|case|caseid|participant|subject|pid|kimlik|no)$/i.test(c)) || null;
  if (sample) P.model = { ...JSON.parse(JSON.stringify(SAMPLE.model)), id: SAMPLE.id };
  S.table = tb;
  computeStats();
  try { await putFile('data.csv', toCsv(tb, tb.columns)); } catch (e) { toast(t('Could not write the data to the project: ', 'Veri projeye yazılamadı: ') + e.message, 'err'); }
  save();
  toast(t(`Read ${nfL(tb.nRows)} rows and ${tb.columns.length} columns.`, `${nfL(tb.nRows)} satır ve ${tb.columns.length} sütun okundu.`));
  render();
}
async function loadOutText(text, fileName) {
  const r = D.readMplusOut(text);
  await ensureProject(fileName.replace(/\.[^.]+$/, '') || 'Project');
  await resetSource('out');
  S.P.source.name = fileName;
  try { await putFile(SOURCE_OUT, text); } catch (e) { toast(e.message, 'err'); }
  setSource(text);
  save();
  if (r.ok) toast(t(`Read the model of ${fileName}: ${r.by.length} loadings, N = ${nfL(r.n)}.`, `${fileName} modeli okundu: ${r.by.length} yük, N = ${nfL(r.n)}.`));
  else toast(r.error || t('The output could not be read.', 'Çıktı okunamadı.'), 'err');
  render();
}
async function startManual(example = false) {
  await ensureProject(example ? 'Example · A-SAGS (hand entry)' : 'Hand-entered model');
  await resetSource('manual');
  if (example) {
    S.P.source.text = EXAMPLE_MANUAL.text;
    S.P.source.n = EXAMPLE_MANUAL.n;
    S.P.source.fit = { ...EXAMPLE_MANUAL.fit };
    S.P.source.name = 'Boivin et al. (2026), A-SAGS';
  }
  save();
  render();
}
const manualFit = () => { const f = S.P.source.fit || {}; return { cfi: numOr(f.cfi), rmsea: numOr(f.rmsea), srmr: numOr(f.srmr), chisq: NaN, df: NaN, pvalue: NaN }; };

// ======================================================================
// The CFA of the raw-data path
// ======================================================================
const modelItems = () => (S.P ? S.P.model.factors.flatMap((f) => f.items) : []);
// Ordinal: chosen, or detected (whole numbers with at most 10 distinct values in every item)
function categorical() {
  const P = S.P;
  if (!P || !S.table) return false;
  if (P.model.categorical === 'yes') return true;
  if (P.model.categorical === 'no') return false;
  const items = modelItems();
  return items.length > 0 && items.every((c) => S.stats[c] && S.stats[c].ints && S.stats[c].cats >= 2 && S.stats[c].cats <= 10);
}
function detectedCategorical() {
  const items = modelItems();
  return items.length > 0 && items.every((c) => S.stats[c] && S.stats[c].ints && S.stats[c].cats >= 2 && S.stats[c].cats <= 10);
}
const cfaEstimator = () => { const e = S.P.design.estimator; const cat = categorical(); return e === 'auto' || (cat && e !== 'WLSMV') || (!cat && e === 'WLSMV') ? (cat ? 'WLSMV' : 'ML') : e; };
function structErrors() {
  const P = S.P;
  if (!P) return [t('Load a model first.', 'Önce bir model yükleyin.')];
  const mode = P.source.mode;
  if (mode !== 'csv') return D_specErrors();
  if (!S.table) return [t('Load a data file first.', 'Önce bir veri dosyası yükleyin.')];
  const errs = [];
  const f = P.model.factors.filter((x) => x.items.length);
  if (!f.length) return [t('Assign the items to at least one factor.', 'Maddeleri en az bir faktöre atayın.')];
  f.forEach((x) => { if (x.items.length < 2) errs.push(t(`Factor ${x.name} needs at least two items.`, `${x.name} faktörü için en az iki madde gerekir.`)); });
  if (f.length === 1 && f[0].items.length < 4) errs.push(t('A one-factor model needs at least four items for dynamic fit cutoffs.', 'Tek faktörlü model, dinamik kesme değerleri için en az dört madde gerektirir.'));
  if (P.model.second.on && f.length < 3) errs.push(t('A second-order factor needs at least three first-order factors.', 'İkinci düzey faktör için en az üç birinci düzey faktör gerekir.'));
  const names = [...f.map((x) => x.name), ...(P.model.second.on ? [P.model.second.name] : [])];
  const itemNames = modelItems().map((c) => (P.vars[c] ? P.vars[c].mplus : ''));
  [...names, ...itemNames].forEach((n) => { if (!NAME_RE.test(n)) errs.push(t(`"${n}" is not a valid Mplus name (letters, digits and _, at most 8 characters, letter first).`, `"${n}" geçerli bir Mplus adı değil (harf, rakam ve _; en çok 8 karakter; ilk karakter harf).`)); });
  const up = [...names, ...itemNames].map((x) => String(x).toUpperCase());
  const dup = up.filter((x, i) => up.indexOf(x) !== i);
  if (dup.length) errs.push(t(`The name ${dup[0]} is used twice (Mplus ignores case).`, `${dup[0]} adı iki kez kullanılıyor (Mplus büyük-küçük harf ayırmaz).`));
  modelItems().forEach((c) => { if (!S.stats[c] || !S.stats[c].n) errs.push(t(`"${c}" has no numeric values.`, `"${c}" sütununda sayısal değer yok.`)); });
  return errs;
}
function D_specErrors() {
  const d = derive();
  if (S.P.source.mode === 'out' && !S.srcText) return [t('Choose an Mplus output file.', 'Bir Mplus çıktı dosyası seçin.')];
  if (S.P.source.mode === 'manual' && !(S.P.source.text || '').trim()) return [t('Enter the standardized estimates of the model.', 'Modelin standartlaştırılmış kestirimlerini girin.')];
  if (d.specErr) return [d.specErr];
  if (S.P.source.mode === 'manual' && !(fin(Number(S.P.source.n)) && Number(S.P.source.n) >= 10)) return [t('Enter the sample size (N).', 'Örneklem büyüklüğünü (N) girin.')];
  if (d.planErr) return [d.planErr];
  return [];
}
function cfaSpec() {
  const P = S.P;
  const items = modelItems();
  const cols = S.table.columns.filter((c) => items.includes(c));
  return {
    title: P.name, dataFile: CFA.data, names: cols.map((c) => P.vars[c].mplus), missing: -999, estimator: cfaEstimator(), categorical: categorical(),
    factors: P.model.factors.filter((f) => f.items.length).map((f) => ({ name: f.name, items: S.table.columns.filter((c) => f.items.includes(c)).map((c) => P.vars[c].mplus) })),
    second: P.model.second.on ? { name: P.model.second.name } : null,
    cols,
  };
}
function buildCfa() {
  const sp = cfaSpec();
  const gen = MP.buildCfaInp(sp);
  return { input: { name: CFA.input, text: S.P.edits.cfa ?? gen, generated: gen, edited: S.P.edits.cfa != null }, data: { name: CFA.data, text: () => toMplusDat(S.table, sp.cols, -999), cols: sp.cols.length } };
}
function cfaSig() {
  const P = S.P;
  if (!P || P.source.mode !== 'csv') return '';
  const o = { d: P.data.rev || 0, f: P.model.factors.map((f) => [f.name, f.items]), s: P.model.second.on ? P.model.second.name : null, c: categorical(), e: cfaEstimator(), n: modelItems().map((c) => (P.vars[c] ? P.vars[c].mplus : null)) };
  if (P.edits.cfa != null) o.edit = hash(P.edits.cfa);
  return JSON.stringify(o);
}
async function loadCfa() {
  try {
    const text = await getText(CFA.out);
    S.fileText.set(CFA.out, text);
    S.cfaRes = D.readMplusOut(text);
  } catch { S.cfaRes = null; }
  S.derived = null;
}

// ======================================================================
// The standardized model and the plan of the simulation (derived; cached by key)
// ======================================================================
function specFromOut(r) { return { by: r.by, with: r.with, thr: r.thr, n: r.n, fit: r.fit, estimator: r.estimator, version: r.version, noMeans: !!r.noMeans }; }
function derive() {
  const P = S.P;
  if (!P) return { spec: null, specErr: null, plan: null, planErr: null };
  const mode = P.source.mode;
  const cfaOk = !!(S.cfaRes && P.runs.cfa && P.runs.cfa.sig === cfaSig());
  const key = JSON.stringify([mode, mode === 'out' ? (S.srcText ? hash(S.srcText) : '') : '', mode === 'manual' ? [P.source.text, P.source.n, P.source.fit, !!P.source.noMeans] : '', mode === 'csv' ? [cfaOk, S.cfaRes ? S.cfaRes.n : 0, S.cfaRes ? S.cfaRes.by.length : 0, S.fileText.has(CFA.out) ? hash(S.fileText.get(CFA.out)) : ''] : '', P.design.dataType, P.design.reps, P.design.signs]);
  if (S.derived && S.derived.key === key) return S.derived;
  const d = { key, spec: null, specErr: null, plan: null, planErr: null };
  try {
    if (mode === 'csv') {
      if (cfaOk) { if (S.cfaRes.ok) d.spec = specFromOut(S.cfaRes); else d.specErr = S.cfaRes.error; }
    } else if (mode === 'out') {
      if (S.srcRes) { if (S.srcRes.ok) d.spec = specFromOut(S.srcRes); else d.specErr = S.srcRes.error; }
    } else if (mode === 'manual' && (P.source.text || '').trim()) {
      const s = D.parseStdModel(P.source.text);
      d.spec = { ...s, n: Number(P.source.n), fit: manualFit(), estimator: null, version: null, noMeans: !!P.source.noMeans };
    }
    if (d.spec) D.structure(d.spec);
  } catch (e) { d.spec = null; d.specErr = e.message; }
  if (d.spec && fin(d.spec.n) && d.spec.n >= 10) {
    try { d.plan = D.planDfi(d.spec, { dataType: P.design.dataType, reps: P.design.reps, signs: P.design.signs, meta: META }); } catch (e) { d.planErr = e.message; }
  }
  S.derived = d;
  return d;
}
function dfiSig() {
  const P = S.P;
  if (!P) return '';
  const mode = P.source.mode;
  // (noMeans and the sign convention are added only when they change the study, so that the signatures of
  // earlier projects stay valid)
  const d = derive();
  const sg = d.plan && (d.plan.signSensitive || d.plan.l1Differs) ? { s: P.design.signs } : {};
  return JSON.stringify({ m: mode, c: mode === 'csv' ? cfaSig() : null, o: mode === 'out' && S.srcText ? hash(S.srcText) : null, h: mode === 'manual' ? [P.source.text, P.source.n, ...(P.source.noMeans ? [true] : [])] : null, dt: P.design.dataType, r: P.design.reps, ...sg });
}
const dfiFiles = () => { const d = derive(); return d.plan ? d.plan.files : []; };
const dfiActive = () => !!(S.P && S.P.runs.dfi && (S.P.runs.dfi.files || []).some((f) => isActive(S.jobs.get(f))));
const cfaActive = () => isActive(S.jobs.get(CFA.input));
const anyActive = () => cfaActive() || dfiActive();
async function loadDfi() {
  const d = derive();
  if (!d.plan) return;
  const runs = {};
  for (const f of d.plan.files) {
    let out = null, res = null;
    try { out = S.files.has(f.out) ? await getText(f.out) : null; } catch { /* missing */ }
    try { res = S.files.has(f.res) ? await getText(f.res) : null; } catch { /* missing */ }
    runs[f.name] = { out, res };
    if (out != null) S.fileText.set(f.out, out);
  }
  S.runs = runs;
  summarize();
}
function summarize() {
  const d = derive();
  S.dfi = d.plan && Object.keys(S.runs).length ? D.summarizeDfi(d.plan, S.runs, S.P.design.policy) : null;
}
function runInfo() {
  const P = S.P;
  const rec = P ? P.runs.dfi : null;
  const active = anyActive();
  const fresh = !!(rec && rec.sig === dfiSig());
  const ok = !!(S.dfi && S.dfi.ok);
  let err = '';
  if (!active && P) {
    const c = P.runs.cfa;
    if (P.source.mode === 'csv' && c && c.status && c.status !== 'done' && c.sig === cfaSig()) err = c.error || (c.status === 'cancelled' ? '' : t('The CFA run ended with an error.', 'CFA çalıştırması hatayla bitti.'));
    else if (rec && rec.status && rec.status !== 'done') err = rec.error || (rec.status === 'cancelled' ? '' : t('The simulation ended with an error.', 'Simülasyon hatayla bitti.'));
    else if (rec && rec.status === 'done' && S.dfi && !S.dfi.ok) err = S.dfi.error;
  }
  return { rec, active, fresh, ok, err };
}

// ======================================================================
// Runs
// ======================================================================
function engineAvail() {
  if (!S.health) return { ok: false, checking: true };
  const h = S.health.engines && S.health.engines.mplus;
  if (HOSTED) return { ok: false, notRunning: true, error: t('This is the web version. The analyses run in the app on your computer: download DynamicFitMplus.exe and start it, or open it if it is already running.', 'Bu web sürümüdür. Analizler bilgisayarınızdaki uygulamada çalışır: DynamicFitMplus.exe dosyasını indirip başlatın ya da çalışıyorsa açın.') };
  if (!h) return { ok: false, error: t('The server cannot be reached. Start the app with "node serve.mjs".', 'Sunucuya ulaşılamıyor. Uygulamayı "node serve.mjs" ile başlatın.') };
  return h;
}
const missingMsg = () => t('Mplus was not found on this computer. Install Mplus, or start the server with MPLUS_PATH set to the full path of Mplus.exe.', 'Bu bilgisayarda Mplus bulunamadı. Mplus programını kurun ya da sunucuyu, MPLUS_PATH ortam değişkeni Mplus.exe dosyasının tam yolunu gösterecek biçimde başlatın.');
function missingHtml(av) {
  const err = av.error || missingMsg();
  if (av.notRunning) return `${esc(err)}<div class="mt-2 flex flex-wrap gap-2"><a class="btn btn-sm btn-primary" href="${EXE_URL}" download>${icon('download', 15)}${t('Download for Windows', 'Windows için indir')}</a><button class="btn btn-sm" data-act="recheck">${icon('arrow', 15)}${t('Open the app', 'Uygulamayı aç')}</button></div>`;
  const fix = /MPLUS_PATH/.test(err) ? '' : `<br><span class="small">${esc(missingMsg())}</span>`;
  return `${esc(err)}${fix}<div class="mt-2"><button class="btn btn-sm" data-act="recheck">${icon('refresh', 15)}${t('Check again', 'Yeniden denetle')}</button></div>`;
}
const runErrors = () => structErrors();
async function submit(file) {
  const r = await api(`/projects/${encodeURIComponent(S.P.id)}/run`, { method: 'POST', json: { engine: 'mplus', file } });
  const cur = S.jobs.get(file);
  if (!cur || cur.id !== r.jobId) S.jobs.set(file, { id: r.jobId, project: S.P.id, engine: 'mplus', file, status: 'queued', created: Date.now(), logTail: [] });
}
async function runAll() {
  const errs = runErrors();
  if (errs.length) { toast(errs[0], 'err'); return; }
  const av = engineAvail();
  if (!av.ok) { toast(av.checking ? t('Mplus is still being checked; try again in a moment.', 'Mplus hâlâ denetleniyor; birazdan yeniden deneyin.') : av.error || missingMsg(), 'err'); return; }
  S.busy = true;
  render();
  try {
    S.runs = {}; S.dfi = null;
    if (S.P.source.mode === 'csv') {
      const f = buildCfa();
      await putFile(f.data.name, f.data.text());
      await putFile(f.input.name, f.input.text);
      S.P.runs = { cfa: { sig: cfaSig(), started: new Date().toISOString(), at: null, status: 'queued' }, dfi: null };
      S.cfaRes = null; S.derived = null; S.fileText.delete(CFA.out); S.outCache.delete(CFA.out);
      await saveNow();
      await submit(CFA.input);
    } else {
      await startDfi();
    }
  } catch (e) { toast(e.message, 'err'); }
  S.busy = false;
  render();
}
async function startDfi() {
  const d = derive();
  if (!d.plan) throw new Error(d.planErr || d.specErr || t('There is no model to simulate.', 'Simüle edilecek model yok.'));
  for (const f of d.plan.files) { await putFile(f.name, f.text); S.fileText.delete(f.out); S.outCache.delete(f.out); }
  S.P.runs.dfi = { sig: dfiSig(), started: new Date().toISOString(), at: null, status: 'queued', files: d.plan.files.map((f) => f.name) };
  S.runs = {}; S.dfi = null;
  await saveNow();
  for (const f of d.plan.files) await submit(f.name);
}
function finishToast(ok, msg, started) {
  if (ok) toast(t(`Finished in ${dur(Date.now() - started)}. The cutoffs are in the paper.`, `${dur(Date.now() - started)} içinde bitti. Kesme değerleri makalede.`));
  else if (msg) toast(msg, 'err');
}
async function cancelRun() {
  const files = [CFA.input, ...((S.P && S.P.runs.dfi && S.P.runs.dfi.files) || [])];
  for (const f of files) {
    const j = S.jobs.get(f);
    if (isActive(j)) { try { await api(`/jobs/${encodeURIComponent(j.id)}/cancel`, { method: 'POST' }); } catch (e) { toast(e.message, 'err'); } }
  }
}
function onJob(j) {
  if (!S.P || j.project !== S.P.id || j.engine !== 'mplus') return;
  const prev = S.jobs.get(j.file);
  if (prev && prev.id !== j.id && (prev.created || 0) > (j.created || 0)) return;
  S.jobs.set(j.file, j);
  const changed = !prev || prev.id !== j.id || prev.status !== j.status;
  if (changed && !isActive(j)) jobFinished(j);
  else softRender(changed);
}
async function refreshFiles() {
  try { S.files = new Set((await api(`/projects/${encodeURIComponent(S.P.id)}/files`)).map((x) => x.name)); } catch { /* keep the old list */ }
}
async function jobFinished(j) {
  const P = S.P;
  await refreshFiles();
  if (S.P !== P) return;
  if (j.file === CFA.input) {
    const rec = P.runs.cfa;
    if (!rec) { render(); return; }
    rec.at = new Date(j.ended || Date.now()).toISOString();
    rec.status = j.status;
    if (j.status === 'done') {
      await loadCfa();
      if (S.P !== P) return;
      if (S.cfaRes && S.cfaRes.ok) {
        save();
        toast(t('The CFA finished. The dynamic fit simulation starts now.', 'CFA bitti. Dinamik uyum simülasyonu şimdi başlıyor.'));
        try { await startDfi(); } catch (e) { rec.status = 'error'; rec.error = e.message; toast(e.message, 'err'); }
      } else {
        rec.status = 'error';
        rec.error = S.cfaRes ? S.cfaRes.error : t('cfa.out could not be read.', 'cfa.out okunamadı.');
        toast(rec.error, 'err');
      }
    } else if (j.status === 'error') { rec.error = j.error || t('The CFA run ended with an error.', 'CFA çalıştırması hatayla bitti.'); toast(rec.error, 'err'); }
    else toast(t('The run was cancelled.', 'Çalıştırma iptal edildi.'));
    save();
    render();
    return;
  }
  const rec = P.runs.dfi;
  if (!rec || !(rec.files || []).includes(j.file)) { render(); return; }
  const mine = rec.files.map((f) => S.jobs.get(f));
  if (mine.some((x) => !x || isActive(x))) {
    if (j.status === 'error' && !rec.error) rec.error = j.error;
    softRender(true);
    return;
  }
  if (rec.status !== 'queued') { softRender(true); return; } // two jobs that end together: the study is closed once
  rec.at = new Date().toISOString();
  const bad = mine.find((x) => x.status === 'error') || mine.find((x) => x.status !== 'done');
  rec.status = bad ? bad.status : 'done';
  rec.error = bad ? bad.error || null : null;
  // kept in the project, so that the rows still say what happened after a restart (the server forgets its jobs)
  rec.failed = bad && bad.status === 'error' ? bad.file : null;
  rec.done = mine.filter((x) => x.status === 'done').map((x) => x.file);
  rec.notStarted = mine.filter((x) => x.status === 'cancelled' && !x.started).map((x) => x.file);
  save();
  if (!bad || bad.status === 'error') await loadDfi(); // a failed study still shows the counts of its finished runs
  if (S.P !== P) return;
  if (!bad) {
    const started = Date.parse(P.runs.cfa && P.source.mode === 'csv' ? P.runs.cfa.started : rec.started) || Date.now();
    finishToast(S.dfi && S.dfi.ok, S.dfi && S.dfi.error, started);
  } else if (bad.status === 'cancelled') toast(t('The simulation was cancelled.', 'Simülasyon iptal edildi.'));
  else toast(bad.error || t('A simulation run ended with an error.', 'Bir simülasyon çalıştırması hatayla bitti.'), 'err');
  render();
}
let softPending = false;
function softRender(important) {
  if (!important && S.route.page !== 'run') { renderTop(); return; }
  const ae = document.activeElement;
  if (ae && $('#work').contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
    if (!softPending) { softPending = true; ae.addEventListener('blur', () => { softPending = false; render(); }, { once: true }); }
    renderTop();
    return;
  }
  render();
}

// ======================================================================
// Views · "live manuscript"
// ======================================================================
const isNarrow = () => window.matchMedia('(max-width: 959px)').matches;
const scrollMode = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const scrollCtrlTop = () => { const c = $('#ctrl'); if (c) c.scrollTop = 0; };
let rendering = false, renderAgain = false;
const ZONES = { ctrl: '#ctrl', desk: '#desk', top: '.topbar' };
const zoneOf = (el) => (el && el.closest ? Object.keys(ZONES).find((z) => el.closest(ZONES[z])) || '' : '');
function render() {
  if (rendering) { renderAgain = true; return; }
  rendering = true;
  S.commitPending = false;
  const ae = document.activeElement;
  const fk = focusKey(ae);
  const zone = zoneOf(ae);
  const wentTo = ae && ae.dataset && ae.dataset.act === 'go';
  try { renderNow(); } finally { rendering = false; }
  if ((fk || zone === 'ctrl') && (!document.activeElement || document.activeElement === document.body)) {
    let el = fk && zone ? document.querySelector(`${ZONES[zone]} ${fk}`) : null;
    if (!el || el.disabled || el.closest('[inert]')) {
      el = zone === 'ctrl' || wentTo ? document.querySelector('#ctrl .cc-head .h1')
        : zone === 'desk' && S.ui.sheet ? $('#codeSheet') : null;
    }
    if (el) el.focus({ preventScroll: true });
  }
  if (renderAgain) { renderAgain = false; render(); }
}
function focusKey(el) {
  if (!el || el === document.body || !el.closest || !el.closest('#work, .topbar')) return null;
  const q = (a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.hasAttribute('data-var')) return ['data-var', 'data-field'].map(q).join('');
  if (el.hasAttribute('data-fac')) return ['data-fac', 'data-field'].filter((a) => el.hasAttribute(a)).map(q).join('');
  if (el.hasAttribute('data-bind')) return q('data-bind');
  if (el.hasAttribute('data-engine')) return q('data-engine');
  if (el.tagName === 'SUMMARY') { const d = el.closest('details[data-key]'); return d ? `details[data-key="${CSS.escape(d.dataset.key)}"] > summary` : null; }
  if (el.hasAttribute('data-act')) {
    const c = el.classList[0];
    return `${el.tagName.toLowerCase()}${c ? '.' + CSS.escape(c) : ''}${['data-act', 'data-route', 'data-v', 'data-col', 'data-file', 'data-sec', 'data-i'].filter((a) => el.hasAttribute(a)).map(q).join('')}`;
  }
  return null;
}
function renderNow() {
  document.documentElement.lang = S.ui.lang;
  try { S.ms = manuscript(S.ui.paperLang); } catch (e) {
    console.error(e);
    S.ms = { secs: [{ id: 'err', html: callout('err', `${t('Error while composing the paper', 'Makale oluşturulurken hata')}: ${esc(e.message)}`), filled: false, label: '' }] };
  }
  renderTop();
  renderCtrl();
  renderPaper();
  renderSheet();
  requestAnimationFrame(afterRender);
  const cw = $('#ctrl');
  if (cw) S.ui.ctrlW = cw.clientWidth;
  const h = `#/${S.route.page}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

// ---------------------------------------------------------------- top bar
function enginePill() {
  const h = engineAvail();
  if (h.checking) return `<span class="pill" data-engine="mplus"><span class="mdot"></span>Mplus<span class="pill-label"> ${t('checking', 'denetleniyor')}</span></span>`;
  if (h.ok) return `<span class="pill" data-engine="mplus" data-tip="${esc(h.path || '')}" tabindex="0"><span class="mdot ${anyActive() ? 'run' : 'ok'}"></span>Mplus ${esc(h.version || '')}<span class="pill-label"> ${t('ready', 'hazır')}</span></span>`;
  if (h.notRunning) return `<button class="pill" data-act="recheck" data-tip="${esc(h.error)}"><span class="mdot bad"></span>${t('Web version', 'Web sürümü')}<span class="pill-label"> · ${t('open the app', 'uygulamayı aç')}</span></button>`;
  return `<span class="pill" data-engine="mplus" data-tip="${esc(h.error || missingMsg())}" tabindex="0"><span class="mdot bad"></span>Mplus<span class="pill-label"> ${t('not found', 'bulunamadı')}</span></span>`;
}
function renderTop() {
  $('#brandSub').textContent = `${t('Dynamic fit index cutoffs', 'Dinamik uyum kesme değerleri')} · ${t('live manuscript', 'canlı makale')}`;
  $('#engineSlot').innerHTML = enginePill();
  $('#projectSlot').innerHTML = `<button class="btn btn-ghost" data-act="projects" aria-haspopup="dialog" aria-label="${t('Projects', 'Projeler')}${S.P ? ': ' + esc(S.P.name) : ''}" data-tip="${S.P ? esc(S.P.name) : t('Choose a project', 'Proje seçin')}">${icon('folder', 16)}<span class="pj-name">${S.P ? esc(S.P.name) : t('Projects', 'Projeler')}</span></button>`;
  $('#langSlot').innerHTML = LANGS.length > 1 ? `<div class="seg seg-sm" role="group" aria-label="${t('Interface language', 'Arayüz dili')}">${LANGS.map((l) => `<button data-act="uiLang" data-v="${l}" aria-pressed="${S.ui.lang === l}" lang="${l}">${l.toUpperCase()}</button>`).join('')}</div>` : '';
  const tr = $('#track');
  tr.innerHTML = trackHtml();
  tr.setAttribute('aria-label', t('Progress', 'İlerleme'));
  $('#ctrl').setAttribute('aria-label', t('Controls', 'Kontroller'));
  $('#desk').setAttribute('aria-label', t('Paper', 'Makale'));
  $('#codeSheet').setAttribute('aria-label', t('Run files', 'Çalıştırma dosyaları'));
  document.title = S.P ? `${S.P.name} · ${APP}` : APP;
}
const hasSource = () => !!(S.P && S.P.source.mode && (S.P.source.mode === 'csv' ? S.table : S.P.source.mode === 'out' ? S.srcText : true));
function stepStates() {
  const P = S.P;
  const src = hasSource();
  const structOk = src && !structErrors().length;
  const info = P ? runInfo() : { active: false, fresh: false, ok: false, rec: null };
  const secs = (S.ms && S.ms.secs || []).filter((s) => s.label);
  const filled = secs.filter((s) => s.filled).length;
  return {
    data: src ? 'done' : 'open',
    roles: structOk ? 'done' : src ? 'prog' : 'open',
    model: !structOk ? 'open' : info.rec && info.fresh ? 'done' : 'prog',
    run: info.active ? 'run' : info.fresh && info.ok ? 'done' : info.rec ? 'prog' : 'open',
    report: secs.length && filled === secs.length ? 'done' : filled ? 'prog' : 'open',
    filled, total: secs.length, structOk, src, info,
  };
}
function trackHtml() {
  const st = stepStates();
  const P = S.P;
  const info = st.info;
  const d = P ? derive() : null;
  const runTip = info.active ? t('Running', 'Çalışıyor') : info.fresh && info.ok ? t('Cutoffs are up to date', 'Kesme değerleri güncel') : info.err ? t('Ended with an error', 'Hatayla bitti') : info.rec && !info.fresh ? t('The model or the settings changed after the last run', 'Son çalıştırmadan sonra model ya da ayarlar değişti') : t('Not run yet', 'Henüz çalıştırılmadı');
  const srcTip = !st.src ? t('No model loaded', 'Model yüklenmedi') : P.source.mode === 'csv' ? t(`${nfL(S.table.nRows)} rows · ${S.table.columns.length} columns`, `${nfL(S.table.nRows)} satır · ${S.table.columns.length} sütun`) : P.source.mode === 'out' ? (P.source.name || SOURCE_OUT) : t('Estimates entered by hand', 'Elle girilen kestirimler');
  const items = [
    { k: 'data', label: t('Data', 'Veri'), tip: srcTip },
    { k: 'roles', label: t('Structure', 'Yapı'), tip: st.structOk ? modelSummary() : t('The factor structure is not complete', 'Faktör yapısı tamamlanmadı') },
    { k: 'model', label: t('Settings', 'Ayarlar'), tip: P ? `${P.design.dataType === 'continuous' ? t('Normal data · ML', 'Normal veri · ML') : d && d.plan ? `${d.plan.dataType === 'categorical' ? t('Ordinal data', 'Sıralı veri') : t('Normal data', 'Normal veri')} · ${d.plan.estimator}` : t('Data type from the model', 'Veri türü modelden')} · ${P.design.reps} ${t('replications', 'tekrar')}` : '' },
    { k: 'run', label: t('Run', 'Çalıştır'), tip: `Mplus · ${runTip}` },
    { k: 'report', label: t('Report', 'Rapor'), tip: t(`Paper draft · ${st.filled}/${st.total} sections`, `Makale taslağı · ${st.filled}/${st.total} bölüm`) },
  ];
  return items.map((it, i) => `${i ? '<span class="trk-sep" aria-hidden="true"></span>' : ''}<button class="trk" data-act="go" data-route="${it.k}"${it.k === S.route.page ? ' aria-current="step"' : ''} data-tip="${esc(it.tip)}">${badge(i + 1, st[it.k], 'step-n', 15)}<span>${it.label}</span></button>`).join('');
}
function modelSummary() {
  const P = S.P;
  if (P.source.mode === 'csv') {
    const f = P.model.factors.filter((x) => x.items.length);
    return t(`${f.length} factor${f.length > 1 ? 's' : ''} · ${modelItems().length} items${P.model.second.on ? ` · second-order ${P.model.second.name}` : ''}`, `${f.length} faktör · ${modelItems().length} madde${P.model.second.on ? ` · ikinci düzey ${P.model.second.name}` : ''}`);
  }
  const d = derive();
  if (!d.spec) return '';
  const st = D.structure(d.spec);
  return t(`${st.first.length} factor${st.first.length > 1 ? 's' : ''} · ${st.items.length} items${st.higher.length ? ` · second-order ${st.higher.join(', ')}` : ''}`, `${st.first.length} faktör · ${st.items.length} madde${st.higher.length ? ` · ikinci düzey ${st.higher.join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- control column
function renderCtrl() {
  const pg = S.route.page;
  let h = '';
  try {
    h = pg === 'roles' ? ctrlStructure() : pg === 'model' ? ctrlSettings() : pg === 'run' ? ctrlRun() : pg === 'report' ? ctrlReport() : ctrlData();
  } catch (e) {
    console.error(e);
    h = `<div class="ctrl-inner">${callout('err', `${t('Error while drawing the page', 'Sayfa çizilirken hata')}: ${esc(e.message)}`)}</div>`;
  }
  $('#ctrl').innerHTML = h;
  $('#work').dataset.pane = S.ui.pane || 'ctrl';
}
const secName = (id) => { const s = S.ms && S.ms.secs.find((x) => x.id === id); return s ? s.label : ''; };
const paperLink = (id, label) => `<button class="link" data-act="scrollPaper" data-sec="${id}">${icon('file', 15)}${esc(label || `${t('In the paper', 'Makalede')}: ${secName(id)}`)}</button>`;
const needSource = (eyebrow, back) => ctrlWrap(ctrlHead(eyebrow, t('Load a model first', 'Önce bir model yükleyin'), t('This step needs data, an Mplus output or estimates entered by hand.', 'Bu adım için veri, bir Mplus çıktısı ya da elle girilmiş kestirimler gerekir.')), callout('info', t('Go to the Data step and choose a source.', 'Veri adımına gidip bir kaynak seçin.')), stepBar({ back, info: t('No model loaded', 'Model yüklenmedi'), tone: 'warn' }));
const delimName = (d) => ({ ',': t('Comma', 'Virgül'), ';': t('Semicolon', 'Noktalı virgül'), '\t': t('Tab', 'Sekme'), '|': t('Pipe', 'Dikey çizgi'), ' ': t('Space', 'Boşluk') }[d] || String(d));
const modeName = (m) => ({ csv: t('Raw data (CSV)', 'Ham veri (CSV)'), out: t('Mplus output', 'Mplus çıktısı'), manual: t('Estimates entered by hand', 'Elle girilen kestirimler') }[m] || '');
const changeSourceBtn = () => `<button class="btn btn-sm btn-ghost" data-act="changeSource">${icon('refresh', 15)}${t('Change source', 'Kaynağı değiştir')}</button>`;

// ---------------------------------------------------------------- 1 · Data
function ctrlData() {
  const P = S.P;
  const eyebrow = t('Step 1 · Data', 'Adım 1 · Veri');
  const mode = P ? P.source.mode : null;
  if (!P || !mode || (mode === 'csv' && !S.table) || (mode === 'out' && !S.srcText)) return ctrlChooseSource(eyebrow);
  if (mode === 'out') return ctrlDataOut(eyebrow);
  if (mode === 'manual') return ctrlDataManual(eyebrow);
  return ctrlDataCsv(eyebrow);
}
function ctrlChooseSource(eyebrow) {
  return ctrlWrap(ctrlHead(eyebrow, t('Bring in your model', 'Modelinizi getirin'), t('Dynamic fit index cutoffs are simulated from the standardized solution of your own model. Start from raw data, from the output of a model you fitted in Mplus, or from estimates reported in a paper.', 'Dinamik uyum kesme değerleri kendi modelinizin standartlaştırılmış çözümünden simüle edilir. Ham veriden, Mplus’ta kestirdiğiniz bir modelin çıktısından ya da bir makalede raporlanan kestirimlerden başlayın.')),
    `<div class="drop" id="drop" data-drop="data">
      <div class="drop-ic" style="margin:2px auto 14px;width:52px;height:52px;border-radius:15px">${icon('table', 24)}</div>
      <h2 class="h2 mb-1">${t('Raw data (CSV)', 'Ham veri (CSV)')}</h2>
      <p class="muted small mb-4">${t('Drop a CSV file here or choose it. You assign the items to factors; the CFA runs in Mplus first, then the simulation. The data stay on this computer.', 'CSV dosyasını buraya bırakın ya da seçin. Maddeleri faktörlere siz atarsınız; önce CFA, sonra simülasyon Mplus’ta çalışır. Veri bu bilgisayarda kalır.')}</p>
      <div class="grid gap-2"><button class="btn btn-primary btn-lg btn-block" data-act="pickData">${icon('file', 18)}${t('Choose CSV file', 'CSV dosyası seç')}</button><button class="btn btn-lg btn-block" data-act="loadSample">${t('Try the sample data', 'Örnek veriyi dene')}</button></div>
      <p class="hint mt-3">${t('Sample data: 480 students, 12 five-point items of a goal-attainment scale (simulated): three first-order factors and a second-order factor.', 'Örnek veri: 480 öğrenci, bir hedef başarısı ölçeğinin 12 beşli maddesi (simülasyon): üç birinci düzey faktör ve bir ikinci düzey faktör.')}</p>
    </div>
    <section class="card">${cardHead(t('Mplus output (.out)', 'Mplus çıktısı (.out)'), t('A CFA or second-order model you already fitted in Mplus, with OUTPUT: STDYX. The standardized loadings, thresholds, N and fit are read from it.', 'Mplus’ta daha önce kestirdiğiniz, OUTPUT: STDYX içeren bir CFA ya da ikinci düzey model. Standart yükler, eşikler, N ve uyum buradan okunur.'), '', `<span class="drop-ic" aria-hidden="true">${icon('file', 20)}</span>`)}
      <div class="card-b"><button class="btn btn-block" data-act="pickOut">${icon('upload', 17)}${t('Choose an Mplus output', 'Mplus çıktısı seç')}</button></div></section>
    <section class="card">${cardHead(t('Standardized estimates', 'Standartlaştırılmış kestirimler'), t('Type the standardized loadings (and thresholds) of a model reported elsewhere, with its sample size — like the manual mode of the dynamic package.', 'Başka bir yerde raporlanmış bir modelin standart yüklerini (ve eşiklerini) örneklem büyüklüğüyle birlikte yazın; dynamic paketinin elle giriş moduna benzer.'), '', `<span class="drop-ic" aria-hidden="true">${icon('edit', 20)}</span>`)}
      <div class="card-b grid gap-2"><button class="btn btn-block" data-act="startManual">${icon('edit', 17)}${t('Enter estimates', 'Kestirim gir')}</button><button class="btn btn-ghost btn-block" data-act="manualExample">${t('Example: A-SAGS (Boivin et al., 2026)', 'Örnek: A-SAGS (Boivin ve ark., 2026)')}</button></div></section>`);
}
function ctrlDataCsv(eyebrow) {
  const P = S.P;
  const tb = S.table;
  const missing = tb.columns.reduce((a, c) => a + (S.stats[c] ? S.stats[c].missing : 0), 0);
  const delim = P.data.delimiter != null ? P.data.delimiter : tb.delimiter;
  const decComma = P.data.decimalComma != null ? P.data.decimalComma : tb.decimalComma;
  const items = new Set(modelItems());
  const rows = tb.columns.map((c) => {
    const s = S.stats[c];
    const open = S.ui.openVar === c;
    const inModel = items.has(c);
    const color = inModel ? '#2C5D9E' : '#AEB6BE';
    const spark = s.coded ? `<span class="tag cobalt">${t('text', 'metin')} → ${nfL(s.nLevels)}</span>` : s.n > 1 ? sparkline(colValues(c), { color, aria: t(`Distribution of ${c}`, `${c} dağılımı`) }) : `<span class="tag warn">${t('no numbers', 'sayı yok')}</span>`;
    const role = c === P.model.id ? t('Case ID', 'Vaka kimliği') : inModel ? t(`Item of ${P.model.factors.find((f) => f.items.includes(c)).name}`, `${P.model.factors.find((f) => f.items.includes(c)).name} maddesi`) : '';
    const sub = [role, s.ints && s.cats && s.cats <= 10 ? t(`${s.cats} categories`, `${s.cats} kategori`) : '', s.missing ? t(`${nfL(s.missing)} missing`, `${nfL(s.missing)} eksik`) : ''].filter(Boolean).join(' · ');
    const detail = open ? `<div class="vr-detail"><dl class="kv small"><dt>${t('Valid n', 'Geçerli n')}</dt><dd class="mono">${nfL(s.n)}</dd><dt>${t('Missing', 'Eksik')}</dt><dd class="mono">${nfL(s.missing)}</dd><dt>${t('Min · max', 'En küçük · en büyük')}</dt><dd class="mono">${nf(s.min)} · ${nf(s.max)}</dd></dl></div>` : '';
    return `<div class="vrow ${open ? 'open' : ''}"><button class="vrow-btn" data-act="toggleVar" data-col="${esc(c)}" aria-expanded="${open}"><span class="vr-name"><b>${esc(c)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="vr-num mono">${nf(s.mean)}<small>${nf(s.sd)}</small></span><span class="vr-spark">${spark}</span></button>${detail}</div>`;
  }).join('');
  const codes = S.ui.missingDraft != null ? S.ui.missingDraft : (P.data.missingCodes || []).join(', ');
  return ctrlWrap(ctrlHead(eyebrow, esc(P.data.name || t('Data', 'Veri')), t('Check the variables and the missing values, then assign the items to factors.', 'Değişkenleri ve eksik değerleri gözden geçirin; ardından maddeleri faktörlere atayın.')),
    `<section class="card">${cardHead(t('File', 'Dosya'), modeName('csv'), `<button class="btn btn-sm" data-act="pickData">${icon('upload', 15)}${t('Replace', 'Değiştir')}</button>${changeSourceBtn()}`)}
      <div class="card-b"><div class="tiles">${tile(t('Rows', 'Satır'), nfL(tb.nRows))}${tile(t('Columns', 'Sütun'), tb.columns.length)}${tile(t('Delimiter', 'Ayırıcı'), delimName(delim), decComma ? t('decimal comma', 'ondalık virgül') : t('decimal point', 'ondalık nokta'))}${tile(t('Missing values', 'Eksik değer'), nfL(missing), missing ? t('cells, all columns', 'hücre, tüm sütunlar') : t('none missing', 'eksik yok'))}</div>
        <div class="field mt-4"><label for="missingCodes">${t('Missing-value codes', 'Eksik değer kodları')}</label><div class="flex gap-2"><input id="missingCodes" class="input input-sm mono" data-bind="missingCodes" value="${esc(codes)}" spellcheck="false"><button class="btn btn-sm btn-tonal" data-act="applyMissing">${t('Apply', 'Uygula')}</button></div><div class="hint">${t('Blank cells and NA always count as missing; list other codes separated by commas.', 'Boş hücreler ve NA her zaman eksik sayılır; başka kodları virgülle ayırarak yazın.')}</div></div></div></section>
    <section class="card">${cardHead(t('Variables', 'Değişkenler'), t('Click a row for details. Navy bars = items of the model.', 'Ayrıntı için bir satıra tıklayın. Lacivert çubuklar = modelin maddeleri.'))}
      <div class="card-b"><div class="vhead"><span>${t('Variable', 'Değişken')}</span><span style="text-align:right">${t('M · SD', 'Ort. · SS')}</span><span>${t('Distribution', 'Dağılım')}</span></div>${rows}</div></section>`,
    stepBar({ info: t(`${nfL(tb.nRows)} rows · ${tb.columns.length} columns loaded`, `${nfL(tb.nRows)} satır · ${tb.columns.length} sütun yüklendi`), actions: nextBtn(t('Structure', 'Yapı'), 'data-act="go" data-route="roles"') }));
}
function fitTiles(fit, est) {
  if (!fit) return '';
  return `<div class="tiles mt-3">${tile('χ²', fin(fit.chisq) ? nf(fit.chisq, 2) : '—', fin(fit.df) ? t(`df = ${fit.df}${est ? ` · ${est}` : ''}`, `sd = ${fit.df}${est ? ` · ${est}` : ''}`) : '')}${tile('CFI', f3(fit.cfi))}${tile('RMSEA', f3(fit.rmsea))}${tile('SRMR', f3(fit.srmr))}</div>`;
}
function ctrlDataOut(eyebrow) {
  const P = S.P;
  const r = S.srcRes;
  const d = derive();
  let body;
  if (!r.ok) body = callout('err', `<b>${t('This output cannot be used', 'Bu çıktı kullanılamaz')}</b><br>${esc(r.error || '')}`);
  else {
    const st = d.spec ? D.structure(d.spec) : null;
    body = `<div class="tiles">${tile(t('Program', 'Program'), `Mplus ${r.version || ''}`.trim())}${tile(t('Estimator', 'Kestirici'), r.estimator || '—')}${tile('N', nfL(r.n))}${tile(t('Items', 'Madde'), st ? st.items.length : '—', st ? t(`${st.first.length} factor${st.first.length > 1 ? 's' : ''}${st.higher.length ? ' + second order' : ''}`, `${st.first.length} faktör${st.higher.length ? ' + ikinci düzey' : ''}`) : '')}</div>
      ${fitTiles(r.fit, r.estimator)}
      ${r.thr.length ? `<p class="hint mt-3">${t(`${new Set(r.thr.map((x) => x.item)).size} items have thresholds (ordered categorical).`, `${new Set(r.thr.map((x) => x.item)).size} maddenin eşikleri var (sıralı kategorik).`)}</p>` : ''}
      ${r.noMeans ? `<p class="hint mt-3">${t('The model was fitted without a mean structure (MODEL = NOMEANSTRUCTURE). The simulation is analyzed the same way, so that SRMR is comparable.', 'Model ortalama yapısı olmadan kestirilmiş (MODEL = NOMEANSTRUCTURE). Simülasyon da aynı biçimde analiz edilir; böylece SRMR karşılaştırılabilir.')}</p>` : ''}
      ${d.specErr ? `<div class="mt-3">${callout('err', esc(d.specErr))}</div>` : ''}`;
  }
  const warn = r.ok && r.warnings && r.warnings.length ? callout('warn', `${t('Mplus reported a warning for this model:', 'Mplus bu model için bir uyarı verdi:')} ${esc(r.warnings[0])}`) : '';
  return ctrlWrap(ctrlHead(eyebrow, esc(P.source.name || SOURCE_OUT), t('The standardized solution of this output is the starting point of the simulation. Check that it is the model you want to evaluate.', 'Bu çıktının standartlaştırılmış çözümü simülasyonun başlangıç noktasıdır. Değerlendirmek istediğiniz model olduğundan emin olun.')),
    `<section class="card">${cardHead(t('Mplus output', 'Mplus çıktısı'), esc(r.title || ''), `<button class="btn btn-sm" data-act="pickOut">${icon('upload', 15)}${t('Replace', 'Değiştir')}</button>${changeSourceBtn()}`)}<div class="card-b">${body}<div class="mt-3"><button class="link" data-act="openSheet" data-file="${SOURCE_OUT}">${icon('file', 15)}${t('Open the output', 'Çıktıyı aç')}</button></div></div></section>${warn}`,
    stepBar({ info: r.ok && !d.specErr ? t(`Model read · N = ${nfL(r.n)}`, `Model okundu · N = ${nfL(r.n)}`) : t('The output cannot be used', 'Çıktı kullanılamaz'), tone: r.ok && !d.specErr ? 'ok' : 'warn', actions: nextBtn(t('Structure', 'Yapı'), `data-act="go" data-route="roles" ${r.ok && !d.specErr ? '' : 'disabled'}`) }));
}
function ctrlDataManual(eyebrow) {
  const P = S.P;
  const d = derive();
  const draft = S.ui.manualDraft != null ? S.ui.manualDraft : P.source.text;
  const n = P.source.n ?? '';
  const fit = P.source.fit || {};
  const st = d.spec ? (() => { try { return D.structure(d.spec); } catch { return null; } })() : null;
  const errs = structErrors();
  const status = !(P.source.text || '').trim() ? '' : d.specErr ? callout('err', esc(d.specErr)) : st ? callout('ok', t(`${st.first.length} factor${st.first.length > 1 ? 's' : ''}, ${st.items.length} items${st.higher.length ? `, second-order ${st.higher.join(', ')}` : ''}${d.spec.thr.length ? `; thresholds for ${new Set(d.spec.thr.map((x) => x.item)).size} items` : ''}.`, `${st.first.length} faktör, ${st.items.length} madde${st.higher.length ? `, ikinci düzey ${st.higher.join(', ')}` : ''}${d.spec.thr.length ? `; ${new Set(d.spec.thr.map((x) => x.item)).size} madde için eşik` : ''}.`)) : '';
  const changed = S.ui.manualDraft != null && S.ui.manualDraft !== P.source.text;
  return ctrlWrap(ctrlHead(eyebrow, t('Standardized estimates', 'Standartlaştırılmış kestirimler'), t('Write one statement per factor with the standardized (STDYX) values. Thresholds make the items ordinal; without them the simulation uses normal data.', 'Her faktör için standartlaştırılmış (STDYX) değerlerle bir ifade yazın. Eşikler maddeleri sıralı yapar; eşik yoksa simülasyon normal veri kullanır.')),
    `<section class="card">${cardHead(t('Model', 'Model'), esc(P.source.name || modeName('manual')), changeSourceBtn())}
      <div class="card-b"><div class="field"><label for="manualText">${t('Standardized model (Mplus or lavaan syntax)', 'Standartlaştırılmış model (Mplus ya da lavaan sözdizimi)')}</label>
        <textarea id="manualText" class="input mono" data-bind="manualText" spellcheck="false" style="height:170px;padding:10px 13px;line-height:1.5;resize:vertical">${esc(draft)}</textarea>
        <div class="hint">${t('Examples: <span class="mono">F1 BY y1*.72 y2*.65 y3*.80;</span> · <span class="mono">G BY F1*.83 F2*.88 F3*.91;</span> · <span class="mono">F1 WITH F2*.45;</span> · <span class="mono">[y1$1*-1.2 y1$2*0.3];</span>', 'Örnekler: <span class="mono">F1 BY y1*.72 y2*.65 y3*.80;</span> · <span class="mono">G BY F1*.83 F2*.88 F3*.91;</span> · <span class="mono">F1 WITH F2*.45;</span> · <span class="mono">[y1$1*-1.2 y1$2*0.3];</span>')}</div></div>
        <div class="grid gap-2 mt-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <div class="field"><label for="manualN">N</label><input id="manualN" class="input input-sm mono" data-bind="manualN" value="${esc(n)}" inputmode="numeric"></div>
          <div class="field"><label for="fitCfi">CFI</label><input id="fitCfi" class="input input-sm mono" data-bind="fitCfi" value="${esc(fit.cfi)}" placeholder="${t('optional', 'isteğe bağlı')}"></div>
          <div class="field"><label for="fitRmsea">RMSEA</label><input id="fitRmsea" class="input input-sm mono" data-bind="fitRmsea" value="${esc(fit.rmsea)}" placeholder="${t('optional', 'isteğe bağlı')}"></div>
          <div class="field"><label for="fitSrmr">SRMR</label><input id="fitSrmr" class="input input-sm mono" data-bind="fitSrmr" value="${esc(fit.srmr)}" placeholder="${t('optional', 'isteğe bağlı')}"></div>
        </div>
        <p class="hint">${t('The observed CFI, RMSEA and SRMR of the model are only used to compare it with the cutoffs in the paper.', 'Modelin gözlenen CFI, RMSEA ve SRMR değerleri yalnız makalede kesme değerleriyle karşılaştırmak için kullanılır.')}</p>
        ${d.spec && !d.spec.thr.length ? `<label class="toggle mt-2"><input type="checkbox" data-bind="manualNoMeans" ${P.source.noMeans ? 'checked' : ''}>${t('This SRMR excludes the mean structure (the default of lavaan and dynamic, or Mplus with MODEL = NOMEANSTRUCTURE): simulate the same way', 'Bu SRMR ortalama yapısını içermiyor (lavaan ve dynamic varsayılanı ya da Mplus’ta MODEL = NOMEANSTRUCTURE): simülasyon da öyle yapılsın')}</label>` : ''}
        <div class="mt-3"><button class="btn btn-primary" data-act="applyManual" ${changed ? '' : 'disabled'}>${icon('check', 16)}${t('Apply the model', 'Modeli uygula')}</button></div>
        <div class="mt-3">${status}</div></div></section>`,
    stepBar({ info: errs.length ? errs[0] : t('Model ready', 'Model hazır'), tone: errs.length ? 'warn' : 'ok', actions: nextBtn(t('Structure', 'Yapı'), `data-act="go" data-route="roles" ${errs.length ? 'disabled' : ''}`) }));
}

// ---------------------------------------------------------------- 2 · Structure
function ctrlStructure() {
  const P = S.P;
  const eyebrow = t('Step 2 · Structure', 'Adım 2 · Yapı');
  const back = { label: t('Data', 'Veri'), attrs: 'data-act="go" data-route="data"' };
  if (!hasSource()) return needSource(eyebrow, back);
  return P.source.mode === 'csv' ? ctrlStructureCsv(eyebrow, back) : ctrlStructureRead(eyebrow, back);
}
function ctrlStructureCsv(eyebrow, back) {
  const P = S.P;
  const cols = S.table.columns.filter((c) => c !== P.model.id && isChoice(c));
  const owner = (c) => P.model.factors.findIndex((f) => f.items.includes(c));
  const facCards = P.model.factors.map((f, i) => {
    const chips = cols.map((c) => {
      const o = owner(c);
      const mine = o === i;
      const tip = o >= 0 && !mine ? ` data-tip="${esc(t(`Now in ${P.model.factors[o].name}; click to move it here`, `Şu an ${P.model.factors[o].name} faktöründe; buraya taşımak için tıklayın`))}"` : '';
      return `<button class="chip l2" data-act="toggleItem" data-i="${i}" data-col="${esc(c)}" aria-pressed="${mine}"${tip}${o >= 0 && !mine ? ' style="opacity:.45"' : ''}>${mine ? icon('check', 14) : ''}${esc(c)}</button>`;
    }).join(' ');
    const bad = !NAME_RE.test(f.name);
    return `<section class="card">${cardHead(`${t('Factor', 'Faktör')} ${i + 1}`, t(`${f.items.length} item${f.items.length === 1 ? '' : 's'}`, `${f.items.length} madde`), `<button class="btn btn-sm btn-ghost" data-act="removeFactor" data-i="${i}" aria-label="${t(`Remove factor ${i + 1}`, `${i + 1}. faktörü kaldır`)}">${icon('trash', 15)}${t('Remove', 'Kaldır')}</button>`, '<span class="lv l2 lg" style="margin-top:6px" aria-hidden="true"></span>')}
      <div class="card-b"><div class="nrow-f mb-3" style="grid-template-columns:112px minmax(0,1fr)"><input class="input input-sm mono ${bad ? 'err' : ''}" maxlength="8" data-fac="${i}" data-field="name" value="${esc(f.name)}" spellcheck="false" aria-label="${t('Mplus name of the factor', 'Faktörün Mplus adı')}"${bad ? ' aria-invalid="true"' : ''}><input class="input input-sm" data-fac="${i}" data-field="label" value="${esc(f.label || '')}" placeholder="${t('Label in the paper', 'Makaledeki etiket')}" aria-label="${t('Label of the factor', 'Faktörün etiketi')}"></div>
        <div class="flex flex-wrap gap-2" role="group" aria-label="${t(`Items of factor ${i + 1}`, `${i + 1}. faktörün maddeleri`)}">${chips}</div></div></section>`;
  }).join('');
  const sec = P.model.second;
  const nf1 = P.model.factors.filter((f) => f.items.length).length;
  const secBad = sec.on && !NAME_RE.test(sec.name);
  const cat = P.model.categorical;
  const det = detectedCategorical();
  const used = modelItems();
  const nameRows = used.map((c) => {
    const v = P.vars[c] || { mplus: '', labelEn: c };
    const bad = !NAME_RE.test(v.mplus) || used.some((o) => o !== c && P.vars[o] && P.vars[o].mplus.toUpperCase() === String(v.mplus).toUpperCase());
    return `<div class="nrow"><div class="nrow-f" style="grid-template-columns:112px minmax(0,1fr)"><input class="input input-sm mono ${bad ? 'err' : ''}" maxlength="8" data-var="${esc(c)}" data-field="mplus" value="${esc(v.mplus)}" spellcheck="false" aria-label="${esc(c)} · ${t('Mplus name', 'Mplus adı')}"${bad ? ' aria-invalid="true"' : ''}><input class="input input-sm" data-var="${esc(c)}" data-field="labelEn" value="${esc(v.labelEn)}" aria-label="${esc(c)} · ${t('Label in the paper', 'Makaledeki etiket')}"></div></div>`;
  }).join('');
  const errs = structErrors();
  const body = `${facCards || callout('info', t('Add a factor and click the items that measure it.', 'Bir faktör ekleyin ve onu ölçen maddelere tıklayın.'))}
    <div><button class="btn" data-act="addFactor">${icon('plus', 16)}${t('Add factor', 'Faktör ekle')}</button></div>
    <section class="card">${cardHead(t('Second-order factor', 'İkinci düzey faktör'), t('A general factor measured by the first-order factors (at least three). The simulation then follows the higher-order procedure (McNeish & Manapat, 2024).', 'Birinci düzey faktörlerin ölçtüğü genel bir faktör (en az üç). Simülasyon bu durumda ikinci düzey modeller için önerilen yöntemi izler (McNeish ve Manapat, 2024).'))}
      <div class="card-b"><label class="toggle"><input type="checkbox" data-bind="secondOn" ${sec.on ? 'checked' : ''} ${nf1 < 3 && !sec.on ? 'disabled' : ''}>${t('Add a second-order factor', 'İkinci düzey faktör ekle')}</label>
      ${sec.on ? `<div class="nrow-f mt-3" style="grid-template-columns:112px minmax(0,1fr)"><input class="input input-sm mono ${secBad ? 'err' : ''}" maxlength="8" data-fac="second" data-field="name" value="${esc(sec.name)}" spellcheck="false" aria-label="${t('Mplus name of the second-order factor', 'İkinci düzey faktörün Mplus adı')}"><input class="input input-sm" data-fac="second" data-field="label" value="${esc(sec.label || '')}" placeholder="${t('Label in the paper', 'Makaledeki etiket')}" aria-label="${t('Label of the second-order factor', 'İkinci düzey faktörün etiketi')}"></div>` : ''}</div></section>
    <section class="card">${cardHead(t('Response format', 'Yanıt biçimi'), det ? t('The items look ordinal (whole numbers, at most 10 categories).', 'Maddeler sıralı görünüyor (tam sayılar, en çok 10 kategori).') : t('The items look continuous.', 'Maddeler sürekli görünüyor.'))}
      <div class="card-b"><div class="seg seg-block" role="group" aria-label="${t('Response format', 'Yanıt biçimi')}"><button data-act="setCat" data-v="auto" aria-pressed="${cat === 'auto'}">${t('Detect', 'Algıla')} (${det ? t('ordinal', 'sıralı') : t('continuous', 'sürekli')})</button><button data-act="setCat" data-v="yes" aria-pressed="${cat === 'yes'}">${t('Ordinal', 'Sıralı')}</button><button data-act="setCat" data-v="no" aria-pressed="${cat === 'no'}">${t('Continuous', 'Sürekli')}</button></div>
      <p class="hint mt-2">${t('Ordinal items are estimated with WLSMV and their thresholds drive the simulation (McNeish, 2023).', 'Sıralı maddeler WLSMV ile kestirilir ve eşikleri simülasyonu belirler (McNeish, 2023).')}</p></div></section>
    ${used.length ? `<section class="card">${cardHead(t('Mplus names and labels', 'Mplus adları ve etiketler'), t('Mplus names: at most 8 characters, letters, digits and _, starting with a letter. The labels name the items in the paper.', 'Mplus adları: en çok 8 karakter; harf, rakam ve _; ilk karakter harf. Etiketler maddeleri makalede adlandırır.'))}<div class="card-b" style="padding-top:8px">${nameRows}<div class="mt-3">${paperLink('measures')}</div></div></section>` : ''}`;
  return ctrlWrap(ctrlHead(eyebrow, t('Factor structure', 'Faktör yapısı'), t('Assign each item to the factor it measures. Navy = your model; the cross-loadings the simulation adds later are amber.', 'Her maddeyi ölçtüğü faktöre atayın. Lacivert = sizin modeliniz; simülasyonun daha sonra eklediği çapraz yükler kehribar renktedir.')),
    body,
    stepBar({ back, info: errs.length ? errs[0] : modelSummary(), tone: errs.length ? 'warn' : 'ok', actions: nextBtn(t('Settings', 'Ayarlar'), `data-act="go" data-route="model" ${errs.length ? 'disabled' : ''}`) }));
}
function ctrlStructureRead(eyebrow, back) {
  const d = derive();
  const errs = structErrors();
  let body;
  if (!d.spec) body = callout('err', esc(d.specErr || errs[0] || t('The model cannot be read.', 'Model okunamadı.')));
  else {
    const st = D.structure(d.spec);
    const fac = st.first.map((f) => {
      const rows = d.spec.by.filter((x) => x.f === f).map((x) => `<tr><td class="mono">${esc(x.ind)}</td><td class="num">${R.apaNoLead(x.est)}</td>${d.spec.thr.length ? `<td class="num">${d.spec.thr.filter((y) => y.item === x.ind).length || '—'}</td>` : ''}</tr>`).join('');
      return `<section class="card">${cardHead(esc(f), t(`${d.spec.by.filter((x) => x.f === f).length} items`, `${d.spec.by.filter((x) => x.f === f).length} madde`), '', '<span class="lv l2 lg" style="margin-top:6px" aria-hidden="true"></span>')}<div class="card-b"><table class="dtab"><thead><tr><th>${t('Item', 'Madde')}</th><th class="num">${t('Loading (STDYX)', 'Yük (STDYX)')}</th>${d.spec.thr.length ? `<th class="num">${t('Thresholds', 'Eşik')}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('');
    const hi = st.higher.map((h) => `<section class="card">${cardHead(t(`Second-order factor ${h}`, `İkinci düzey faktör ${h}`), '', '', '<span class="lv l2 lg" style="margin-top:6px" aria-hidden="true"></span>')}<div class="card-b"><table class="dtab"><thead><tr><th>${t('Factor', 'Faktör')}</th><th class="num">${t('Loading (STDYX)', 'Yük (STDYX)')}</th></tr></thead><tbody>${d.spec.by.filter((x) => x.f === h).map((x) => `<tr><td class="mono">${esc(x.ind)}</td><td class="num">${R.apaNoLead(x.est)}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
    const wi = d.spec.with.length ? `<section class="card">${cardHead(t('Correlations', 'Korelasyonlar'), t('Factor correlations and residual correlations (STDYX).', 'Faktör korelasyonları ve artık korelasyonlar (STDYX).'))}<div class="card-b"><table class="dtab"><tbody>${d.spec.with.map((w) => `<tr><td class="mono">${esc(w.a)} WITH ${esc(w.b)}</td><td class="num">${R.apaNoLead(w.est)}${w.fixed ? ' (fixed)' : ''}</td></tr>`).join('')}</tbody></table></div></section>` : '';
    body = `${errs.length ? callout('err', esc(errs[0])) : ''}${fac}${hi}${wi}<div>${paperLink('t-load')}</div>`;
  }
  return ctrlWrap(ctrlHead(eyebrow, t('Factor structure', 'Faktör yapısı'), t('The structure and the standardized values that the simulation starts from. To change them, change the source in the Data step.', 'Simülasyonun başladığı yapı ve standartlaştırılmış değerler. Değiştirmek için Veri adımında kaynağı değiştirin.')),
    body,
    stepBar({ back, info: errs.length ? errs[0] : modelSummary(), tone: errs.length ? 'warn' : 'ok', actions: nextBtn(t('Settings', 'Ayarlar'), `data-act="go" data-route="model" ${errs.length ? 'disabled' : ''}`) }));
}

// ---------------------------------------------------------------- 3 · Settings
const TYPE_NAME = () => ({ one: t('one-factor model', 'tek faktörlü model'), multi: t('multi-factor model', 'çok faktörlü model'), hier: t('second-order model', 'ikinci düzey model') });
function ctrlSettings() {
  const P = S.P;
  const eyebrow = t('Step 3 · Settings', 'Adım 3 · Ayarlar');
  const back = { label: t('Structure', 'Yapı'), attrs: 'data-act="go" data-route="roles"' };
  if (!hasSource()) return needSource(eyebrow, back);
  const errs = structErrors();
  const d = derive();
  const mode = P.source.mode;
  const ordinal = mode === 'csv' ? categorical() : !!(d.spec && d.spec.thr.length);
  const av = engineAvail();
  const opt = (act, v, cur, title, desc, dis = false) => `<button class="opt" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}" ${dis ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}><div class="opt-t">${title}</div><div class="opt-d">${desc}</div></button>`;
  const est = mode === 'csv' ? cfaEstimator() : null;
  const estCard = mode === 'csv' ? `<section class="card">${cardHead(t('Estimation of the CFA', 'CFA kestirimi'), t('The hypothesized model is fitted to your data in Mplus first.', 'Hipotez modeli önce Mplus’ta verinize uydurulur.'), av.ok ? `<span class="tag ok">${icon('check', 12)} Mplus ${esc(av.version || '')}</span>` : '')}
      <div class="card-b"><div class="seg seg-block" role="group" aria-label="${t('Estimator', 'Kestirici')}">${(ordinal ? ['WLSMV'] : ['ML', 'MLR']).map((e) => `<button data-act="setEstimator" data-v="${e}" aria-pressed="${est === e}">${e}</button>`).join('')}</div>
      <p class="hint mt-2">${ordinal ? t('Ordinal items: mean- and variance-adjusted weighted least squares.', 'Sıralı maddeler: ortalama ve varyansa göre düzeltilmiş ağırlıklandırılmış en küçük kareler.') : t('Continuous items: maximum likelihood (MLR adds robust standard errors; the fit indices are scaled).', 'Sürekli maddeler: en çok olabilirlik (MLR sağlam standart hatalar ekler; uyum indeksleri ölçeklenir).')}</p></div></section>` : '';
  const dt = P.design.dataType;
  const genCard = `<section class="card">${cardHead(t('Data generation', 'Veri üretimi'), t('How the simulated data sets are generated and analyzed.', 'Simülasyon veri setlerinin nasıl üretilip analiz edildiği.'))}
    <div class="card-b"><div class="opt-grid-2">
      ${opt('setDataType', 'auto', dt, ordinal ? t('Ordinal · WLSMV', 'Sıralı · WLSMV') : t('Normal · ML', 'Normal · ML'), ordinal ? t('Ordinal responses from the item thresholds, analyzed with WLSMV, as your model (McNeish, 2023). Recommended for ordinal items.', 'Madde eşiklerinden sıralı yanıtlar, modeliniz gibi WLSMV ile analiz edilir (McNeish, 2023). Sıralı maddeler için önerilir.') : t('Multivariate normal data analyzed with ML, the default of the dynamic package.', 'ML ile analiz edilen çok değişkenli normal veri; dynamic paketinin varsayılanı.'))}
      ${opt('setDataType', 'continuous', ordinal ? dt : 'auto-only', t('Normal · ML (as dynamic)', 'Normal · ML (dynamic gibi)'), t('Multivariate normal data with ML even for ordinal items, as the default functions of the dynamic package (e.g., hier1HB). Only to compare with the R package: these cutoffs are not on the metric of your WLSMV fit, so the report does not compare the two.', 'Sıralı maddelerde bile ML ile çok değişkenli normal veri; dynamic paketinin varsayılan fonksiyonları (ör. hier1HB) gibi. Yalnızca R paketiyle karşılaştırma için: bu kesme değerleri WLSMV uyumunuzla aynı ölçekte değildir, rapor ikisini karşılaştırmaz.'), !ordinal)}
    </div></div></section>`;
  const reps = P.design.reps;
  const repCard = `<section class="card">${cardHead(t('Replications', 'Tekrar sayısı'), t('Data sets per condition. dynamic uses 500 (250 in its functions for ordinal items); fewer runs faster but the cutoffs move more.', 'Koşul başına veri seti. dynamic 500 kullanır (sıralı maddeler için olan fonksiyonlarında 250); daha azı hızlıdır ama kesme değerleri daha çok oynar.'))}
    <div class="card-b"><div class="seg seg-block" role="group" aria-label="${t('Replications', 'Tekrar sayısı')}">${[100, 250, 500, 1000].map((r) => `<button data-act="setReps" data-v="${r}" aria-pressed="${reps === r}">${r}${r === 500 ? ` · ${t('default', 'varsayılan')}` : ''}</button>`).join('')}</div></div></section>`;
  const pol = P.design.policy;
  const polCard = `<section class="card">${cardHead(t('Improper solutions', 'Uygunsuz çözümler'), t('Replications where Mplus reports a non–positive definite residual or latent covariance matrix (e.g., a negative residual variance). Changing this does not need a new run.', 'Mplus’ın artık ya da örtük kovaryans matrisinin pozitif tanımlı olmadığını bildirdiği tekrarlar (ör. negatif artık varyans). Bunu değiştirmek yeniden çalıştırma gerektirmez.'))}
    <div class="card-b"><div class="opt-grid-2">${opt('setPolicy', 'include', pol, t('Retain · as dynamic', 'Tut · dynamic gibi'), t('Every replication counts, as in the dynamic package. The number of improper solutions is reported.', 'Her tekrar sayılır; dynamic paketinde olduğu gibi. Uygunsuz çözüm sayısı raporlanır.'))}${opt('setPolicy', 'exclude', pol, t('Exclude', 'Dışla'), t('Only admissible replications form the distributions. With strong misspecifications few may remain.', 'Dağılımları yalnız uygun tekrarlar oluşturur. Güçlü yanlış belirtmelerde az tekrar kalabilir.'))}</div></div></section>`;
  // where the app departs from dynamic by default: the signs of the misspecifications (only with a negative loading
  // or factor correlation) and Level 1 of one-factor models (only for 10, 11, 16, 17, … eligible items)
  const sg = P.design.signs;
  const anyNeg = !!(d.spec && (d.spec.by.some((x) => x.est < 0) || d.spec.with.some((w) => w.est < 0)));
  const l1d = d.plan && d.plan.l1Differs ? d.plan.misspec : null;
  let signCard = '';
  if (anyNeg || l1d || sg === 'dynamic') {
    const why = [anyNeg ? t('Your model has a negative loading or factor correlation; in the dynamic package the cutoffs then depend on how the items happen to be coded (dynamic issue #7).', 'Modelinizde negatif bir yük ya da faktör korelasyonu var; dynamic paketinde bu durumda kesme değerleri maddelerin nasıl kodlandığına bağlı olur (dynamic issue #7).') : '',
      l1d ? t(`With ${l1d.k} items, Level 1 of McNeish & Wolf (2023a) adds ${l1d.paperL1} residual correlations (about one-third of the items); dynamic rounds down to ${l1d.dynL1}.`, `${l1d.k} maddede McNeish ve Wolf’un (2023a) 1. düzeyi ${l1d.paperL1} artık korelasyon ekler (maddelerin yaklaşık üçte biri); dynamic aşağı yuvarlayıp ${l1d.dynL1} ekler.`) : ''].filter(Boolean).join(' ');
    const title = anyNeg && l1d ? t('Reverse-coded items and Level 1', 'Ters kodlanmış maddeler ve 1. düzey') : l1d ? t('Level 1 of one-factor models', 'Tek faktörlü modellerde 1. düzey') : t('Reverse-coded items', 'Ters kodlanmış maddeler');
    const recLab = anyNeg ? t('Invariant to coding · recommended', 'Kodlamaya duyarsız · önerilen') : t('As the paper · recommended', 'Makaledeki gibi · önerilen');
    const recTxt = [anyNeg ? t('Each misspecification takes the sign that keeps it the same if an item is reverse-coded; with positive loadings this equals dynamic.', 'Her yanlış belirtme, bir madde ters kodlansa da aynı kalacak işareti alır; yükler pozitifken dynamic ile aynıdır.') : '',
      l1d ? t('Level 1 follows the formula of McNeish & Wolf (2023a).', '1. düzey McNeish ve Wolf’un (2023a) formülünü izler.') : ''].filter(Boolean).join(' ');
    signCard = `<section class="card">${cardHead(title, why || t('The settings below only matter for models with negative loadings or for some one-factor models.', 'Aşağıdaki ayarlar yalnız negatif yüklü modellerde ya da bazı tek faktörlü modellerde fark yaratır.'))}
    <div class="card-b"><div class="opt-grid-2">${opt('setSigns', 'invariant', sg, recLab, recTxt || t('Signs invariant to coding; Level 1 of one-factor models as in McNeish & Wolf (2023a).', 'Kodlamaya duyarsız işaretler; tek faktörlü modellerde 1. düzey McNeish ve Wolf’taki (2023a) gibi.'))}${opt('setSigns', 'dynamic', sg, t('As dynamic', 'dynamic gibi'), t('Positive cross-loadings and residual correlations, levels ordered by the signed loadings, one-factor Level 1 rounded down: reproduces the R package exactly.', 'Pozitif çapraz yükler ve artık korelasyonlar, işaretli yüklere göre sıralı düzeyler, tek faktörde aşağı yuvarlanan 1. düzey: R paketini birebir yeniden üretir.'))}</div></div></section>`;
  }
  let prev;
  if (d.plan) {
    const p = d.plan;
    const ruleTxt = p.rule === 'sens'
      ? t('Cutoff rule: the highest sensitivity at 95% specificity, as dynamic’s functions for ordinal items (McNeish, 2023; McNeish & Wolf, 2024); the 95/5 rule is shown in Table 3.', 'Kesme kuralı: %95 özgüllükte en yüksek duyarlılık; dynamic’in sıralı maddelere yönelik fonksiyonları gibi (McNeish, 2023; McNeish ve Wolf, 2024). 95/5 kuralı Tablo 3’tedir.')
      : p.type === 'one'
        ? t('Cutoff rule: 95/5 with a 90/10 fallback (McNeish & Wolf, 2023a, 2023b); the sensitivity at 95% specificity is shown in Table 3.', 'Kesme kuralı: 90/10 yedekli 95/5 (McNeish ve Wolf, 2023a, 2023b); %95 özgüllükteki duyarlılık Tablo 3’tedir.')
        : t('Cutoff rule: 95/5 with a 90/10 fallback (McNeish & Wolf, 2023); the sensitivity at 95% specificity is shown in Table 3.', 'Kesme kuralı: 90/10 yedekli 95/5 (McNeish ve Wolf, 2023); %95 özgüllükteki duyarlılık Tablo 3’tedir.');
    prev = `<p class="small mb-3">${t(`Detected: ${TYPE_NAME()[p.type]} · ${p.dataType === 'categorical' ? 'ordinal data, WLSMV' : 'normal data, ML'} · N = ${nfL(p.nSim)} per data set.`, `Algılanan: ${TYPE_NAME()[p.type]} · ${p.dataType === 'categorical' ? 'sıralı veri, WLSMV' : 'normal veri, ML'} · veri seti başına N = ${nfL(p.nSim)}.`)}</p>
      <p class="hint mb-3">${ruleTxt}</p>
      <div class="grid gap-2">${p.levels.map((l) => `<div class="flex flex-wrap items-center gap-2"><span class="tag">${t('Level', 'Düzey')} ${l.level}</span><span class="tag l1">${esc(l.added)}</span></div>`).join('')}</div>
      ${(p.slevels || []).length ? `<p class="small mt-3 mb-2">${t('Structural misspecification (hier2): correlations between first-order disturbances; each level adds to the previous one.', 'Yapısal yanlış belirtme (hier2): birinci düzey bozulma terimleri arasındaki korelasyonlar; her düzey bir öncekine eklenir.')}</p><div class="grid gap-2">${p.slevels.map((l) => `<div class="flex flex-wrap items-center gap-2"><span class="tag">${t('Level', 'Düzey')} S${l.level}</span><span class="tag l1">${esc(l.added)}</span></div>`).join('')}</div>`
        : p.type === 'hier' && p.structural ? `<p class="hint mt-3">${p.structural.reason === 'saturated' ? t('Structural misspecification (hier2) needs at least four first-order factors; with fewer their covariance matrix is saturated.', 'Yapısal yanlış belirtme (hier2) en az dört birinci düzey faktör gerektirir; daha azında bu faktörlerin kovaryans matrisi doymuştur.') : t('Structural misspecification (hier2) needs at least four first-order factors that load on one second-order factor and have no disturbance correlation.', 'Yapısal yanlış belirtme (hier2), tek bir ikinci düzey faktöre yüklenen ve bozulma korelasyonu olmayan en az dört birinci düzey faktör gerektirir.')}</p>` : ''}
      <p class="hint mt-3">${t(`${p.files.length} Mplus runs: the correct model and each level, each with the hypothesized and the baseline model on the same data.`, `${p.files.length} Mplus çalıştırması: doğru model ve her düzey, her biri aynı veride hipotez ve temel modelle.`)}</p>`;
  } else if (mode === 'csv') {
    prev = callout('info', t('The misspecifications are chosen from the standardized solution, so they appear after the CFA has run.', 'Yanlış belirtmeler standartlaştırılmış çözümden seçilir; bu yüzden CFA çalıştıktan sonra görünür.'));
  } else prev = callout('warn', esc(d.planErr || d.specErr || ''));
  const prevCard = `<section class="card">${cardHead(t('Misspecification levels', 'Yanlış belirtme düzeyleri'), t('Amber = what the simulation adds to the population model but leaves out of the analysis model.', 'Kehribar = simülasyonun popülasyon modeline ekleyip analiz modelinden çıkardığı.'))}<div class="card-b">${prev}<div class="mt-3">${paperLink('analysis')}</div></div></section>`;
  return ctrlWrap(ctrlHead(eyebrow, t('Simulation settings', 'Simülasyon ayarları'), t('The defaults follow the dynamic package. Your choices update the Analysis paragraph of the paper.', 'Varsayılanlar dynamic paketini izler. Seçimleriniz makalenin Analiz paragrafını günceller.')),
    `${!av.ok && !av.checking ? callout('warn', missingHtml(av)) : ''}${estCard}${genCard}${repCard}${polCard}${signCard}${prevCard}`,
    stepBar({ back, info: errs.length ? errs[0] : `${mode === 'csv' ? `CFA ${est} · ` : ''}${dt === 'continuous' || !ordinal ? t('normal data', 'normal veri') : t('ordinal data', 'sıralı veri')} · ${reps} ${t('replications', 'tekrar')}`, tone: errs.length ? 'warn' : 'ok', actions: nextBtn(t('Run', 'Çalıştır'), `data-act="go" data-route="run" ${errs.length ? 'disabled' : ''}`) }));
}

// ---------------------------------------------------------------- 4 · Run
// The output of an input: cfa.inp → cfa.out; dfi_L*.inp → the .out of its plan file
function outOf(inp) {
  if (inp === CFA.input) return CFA.out;
  const f = dfiFiles().find((x) => x.name === inp);
  return f ? f.out : /\.inp$/i.test(inp) ? inp.replace(/\.inp$/i, '.out') : null;
}
const lvLabel = (f) => `${f.level === 0 ? t('Correct model', 'Doğru model') : f.family === 's' ? `${t('Structural level', 'Yapısal düzey')} S${f.level}` : `${t('Level', 'Düzey')} ${f.level}`} · ${f.kind === 'model' ? t('hypothesized model', 'hipotez modeli') : t('baseline model (for CFI)', 'temel model (CFI için)')}`;
// The .out of the run that stopped the study (same order as runInfo), if the code sheet can show it
function failedOut(outs) {
  const P = S.P;
  const c = P.runs.cfa;
  if (P.source.mode === 'csv' && c && c.status && c.status !== 'done' && c.sig === cfaSig()) return c.status !== 'cancelled' && outs.has(CFA.out) ? CFA.out : null;
  const rec = P.runs.dfi;
  if (!rec) return null;
  if (rec.status && rec.status !== 'done') {
    if (rec.status === 'cancelled') return null;
    const files = rec.files || [];
    const bad = files.find((f) => (S.jobs.get(f) || {}).status === 'error') || files.find((f) => { const j = S.jobs.get(f); return j && j.status !== 'done' && j.status !== 'cancelled'; })
      || (rec.status === 'error' ? rec.failed : null); // after a restart the server no longer knows the jobs
    const o = bad ? outOf(bad) : null;
    return o && outs.has(o) ? o : null;
  }
  const m = S.dfi && !S.dfi.ok ? String(S.dfi.error || '').match(/^(\S+\.out)\b/) : null; // summarizeDfi: "<file>.out: …"
  return m && outs.has(m[1]) ? m[1] : null;
}
// The last state of a run file from the project record, for the rows the server no longer knows (after a restart)
function recordedStatus(file) {
  const P = S.P;
  if (file === CFA.input) { const c = P.runs.cfa; return P.source.mode === 'csv' && c && c.sig === cfaSig() && c.status !== 'queued' ? c.status : null; }
  const rec = P.runs.dfi;
  if (!rec || rec.sig !== dfiSig() || !(rec.files || []).includes(file)) return null;
  if (rec.status === 'done') return 'done';
  if (rec.failed === file) return 'error';
  if ((rec.done || []).includes(file)) return 'done';
  if (rec.status === 'cancelled') return 'cancelled';
  if (rec.status === 'error' && !rec.done) { // recorded before rec.done existed: a completed output counts as done
    const f = dfiFiles().find((x) => x.name === file);
    const mc = f ? mcCounts(f) : null;
    if (mc && mc.completed) return 'done';
  }
  return null;
}
// A job that was cancelled before it started: its .out on disk is an older run's (also known after a restart)
const neverRan = (j, file) => (j ? j.status === 'cancelled' && !j.started
  : !!(file && S.P && S.P.runs.dfi && S.P.runs.dfi.status === 'cancelled' && (S.P.runs.dfi.notStarted || []).includes(file)));
function jobRow(file, label, outs) {
  const j = S.jobs.get(file);
  const out = outOf(file);
  const failed = out && out === failedOut(outs); // e.g. NO CONVERGENCE: Mplus ended normally, the study did not
  const st = j && j.status !== 'done' ? j.status : failed ? 'error' : j ? j.status : recordedStatus(file);
  const word = { queued: t('Queued', 'Sırada'), running: t('Running', 'Çalışıyor'), done: t('Finished', 'Bitti'), error: t('Error', 'Hata'), cancelled: t('Cancelled', 'İptal edildi') }[st] || t('Not run', 'Çalışmadı');
  const since = j ? j.started : null; // queued jobs have no clock yet
  const time = isActive(j) && since ? `<span data-since="${since}">${clock(Date.now() - since)}</span>` : j && j.ended && j.started ? dur(j.ended - j.started) : '';
  const outCell = out && outs.has(out) && !isActive(j) && !neverRan(j, file)
    ? `<button class="link mono" data-act="openSheet" data-file="${esc(out)}"${st === 'error' || failed ? ' data-jump="err"' : ''} data-tip="${t('Open the Mplus output', 'Mplus çıktısını aç')}">${esc(out)}</button>`
    : '<span class="muted" aria-hidden="true">—</span>';
  return `<tr><td><button class="link mono" data-act="openSheet" data-file="${esc(file)}">${esc(file)}</button><div class="hint" style="margin-top:0">${esc(label)}</div></td><td>${outCell}</td><td><span class="st ${st || ''}"><i></i>${word}</span></td><td class="num">${time}</td></tr>`;
}
function ctrlRun() {
  const P = S.P;
  const eyebrow = t('Step 4 · Run', 'Adım 4 · Çalıştır');
  const back = { label: t('Settings', 'Ayarlar'), attrs: 'data-act="go" data-route="model"' };
  if (!hasSource()) return needSource(eyebrow, back);
  const errs = runErrors();
  const mode = P.source.mode;
  const head = ctrlHead(eyebrow, t('Run Mplus', 'Mplus ile çalıştır'), mode === 'csv'
    ? t('Run fits your CFA in Mplus, then simulates the correct model and each misspecification level. The cutoffs go into the paper.', 'Çalıştır, önce CFA’nızı Mplus’ta kestirir, ardından doğru modeli ve her yanlış belirtme düzeyini simüle eder. Kesme değerleri makaleye işlenir.')
    : t('Run simulates the correct model and each misspecification level in Mplus on this computer. The cutoffs go into the paper.', 'Çalıştır, doğru modeli ve her yanlış belirtme düzeyini bu bilgisayardaki Mplus’ta simüle eder. Kesme değerleri makaleye işlenir.'));
  if (errs.length) return ctrlWrap(head, callout('warn', `${esc(errs[0])}<div class="mt-2"><button class="btn btn-sm" data-act="go" data-route="roles">${t('Go to the structure', 'Yapıya git')}</button></div>`), stepBar({ back, info: errs[0], tone: 'warn', actions: nextBtn(t('Report', 'Rapor'), 'data-act="go" data-route="report"', '') }));
  const av = engineAvail();
  const info = runInfo();
  const d = derive();
  const checking = !!av.checking;
  const cannot = !av.ok && !checking;
  const files = [];
  if (mode === 'csv') {
    files.push([CFA.input, t('CFA of your data', 'Verinizin CFA’sı')]);
  }
  const plan = d.plan;
  if (plan) plan.files.forEach((f) => files.push([f.name, lvLabel(f)]));
  else if (mode === 'csv') files.push(['dfi_L*.inp', t('written after the CFA', 'CFA’dan sonra yazılır')]);
  const outs = new Set(sheetFiles()); // the outputs the code sheet can show
  const rows = files.map(([f, lab]) => (f.includes('*') ? `<tr><td><span class="mono muted">${esc(f)}</span><div class="hint" style="margin-top:0">${esc(lab)}</div></td><td></td><td></td><td></td></tr>` : jobRow(f, lab, outs))).join('');
  const list = [CFA.input, ...((P.runs.dfi && P.runs.dfi.files) || [])].map((f) => S.jobs.get(f)).filter(Boolean);
  const done = list.filter((j) => j.status === 'done').length;
  const total = mode === 'csv' ? 1 + (plan ? plan.files.length : 0) : plan ? plan.files.length : 0;
  const running = list.find((j) => j.status === 'running');
  const runLabel = info.active ? t('Running…', 'Çalışıyor…') : info.ok && info.fresh ? t('Run again', 'Yeniden çalıştır') : mode === 'csv' ? t('Run CFA and simulation', 'CFA ve simülasyonu çalıştır') : t('Run the simulation', 'Simülasyonu çalıştır');
  const runBtn = `<button class="btn btn-lg btn-block ${info.ok && info.fresh && !info.active ? '' : 'btn-primary'}" data-act="run" ${info.active || S.busy || cannot || checking ? 'disabled' : ''}>${icon('play', 18)}<span class="btn-t">${runLabel}</span></button>`;
  let status = '';
  if (cannot) status = callout('warn', missingHtml(av));
  else if (info.err && !info.active) {
    const fo = failedOut(outs);
    status = callout('err', `<b>${t('The run stopped with an error', 'Çalıştırma hatayla durdu')}</b><br>${esc(info.err)}${fo ? `<div class="mt-2"><button class="btn btn-sm" data-act="openSheet" data-file="${esc(fo)}" data-jump="err">${icon('file', 15)}${t('Open the output', 'Çıktıyı aç')}<span class="mono muted font-normal">${esc(fo)}</span></button></div>` : ''}`);
  }
  else if (info.ok && !info.fresh && !info.active) status = callout('warn', t('The model or the settings changed after the last run. Run again to update the paper.', 'Son çalıştırmadan sonra model ya da ayarlar değişti. Makaleyi güncellemek için yeniden çalıştırın.'));
  else if (info.ok && info.fresh && !info.active) status = callout('ok', `${t('The cutoffs are in the paper.', 'Kesme değerleri makalede.')}<div class="mt-1 flex flex-wrap gap-x-3">${paperLink('results', t('Results', 'Bulgular'))}${paperLink('t-fit', t('Table 2', 'Tablo 2'))}${paperLink('f-dist', t('Figure 1', 'Şekil 1'))}</div>`);
  else if (checking && !info.active) status = callout('info', t('Checking Mplus on this computer…', 'Bu bilgisayardaki Mplus denetleniyor…'), 'refresh');
  const prog = info.active ? `<p class="small mt-3"><b>${done}</b> ${t(`of ${total} runs finished`, `/ ${total} çalıştırma bitti`)}${running ? ` · ${t('running', 'çalışıyor')}: <span class="mono">${esc(running.file)}</span>` : ''}</p>` : '';
  const tail = running && (running.logTail || []).length ? `<div class="log mt-3" aria-label="${t('Log', 'Günlük')}">${esc(running.logTail.join('\n'))}</div>` : '';
  const edited = mode === 'csv' && P.edits.cfa != null ? callout('info', t('cfa.inp was edited by hand: structure and settings changes no longer change it. Open it and choose “Use generated” to go back.', 'cfa.inp elle düzenlendi: yapı ve ayar değişiklikleri artık onu değiştirmez. Geri dönmek için dosyayı açıp “Üretileni kullan”ı seçin.'), 'edit') : '';
  const body = `${status}
    <section class="card">${cardHead(t('Run files', 'Çalıştırma dosyaları'), `<span class="mono" style="overflow-wrap:anywhere">${esc(projectPath(P.id))}</span>`, info.active ? `<button class="btn btn-sm btn-danger" data-act="cancel">${icon('stop', 14)}${t('Cancel', 'İptal')}</button>` : '')}
      <div class="card-b"><div class="table-wrap"><table class="dtab"><thead><tr><th>${t('Mplus input', 'Mplus girdisi')}</th><th>${t('Output', 'Çıktı')}</th><th>${t('Status', 'Durum')}</th><th class="num">${t('Time', 'Süre')}</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${prog}${tail}
        <div class="mt-4">${runBtn}</div>
        <p class="hint mt-2">${t('Click an input to see what Mplus runs, and an output to read what Mplus wrote. Two runs work at the same time.', 'Mplus’ın neyi çalıştırdığını görmek için bir girdiye, Mplus’ın ne yazdığını okumak için bir çıktıya tıklayın. Aynı anda iki çalıştırma yürür.')}</p></div></section>
    ${edited}`;
  let sbInfo, tone = 'ok';
  if (info.active) { sbInfo = t(`Mplus is running · ${done}/${total}`, `Mplus çalışıyor · ${done}/${total}`); tone = 'wait'; }
  else if (cannot) { sbInfo = t('Mplus is not available', 'Mplus kullanılamıyor'); tone = 'warn'; }
  else if (info.err) { sbInfo = t('The last run ended with an error', 'Son çalıştırma hatayla bitti'); tone = 'warn'; }
  else if (info.ok && info.fresh) sbInfo = t('The cutoffs are in the paper', 'Kesme değerleri makalede');
  else if (info.ok) { sbInfo = t('The model changed: run again', 'Model değişti: yeniden çalıştırın'); tone = 'warn'; }
  else if (checking) { sbInfo = t('Checking Mplus…', 'Mplus denetleniyor…'); tone = 'idle'; }
  else if ((info.rec && info.rec.status === 'cancelled') || (P.runs.cfa && P.runs.cfa.status === 'cancelled' && !info.rec)) { sbInfo = t('The last run was cancelled', 'Son çalıştırma iptal edildi'); tone = 'idle'; }
  else { sbInfo = t('Not run yet', 'Henüz çalıştırılmadı'); tone = 'idle'; }
  return ctrlWrap(head, body, stepBar({ back, info: sbInfo, tone, actions: nextBtn(t('Report', 'Rapor'), `data-act="go" data-route="report" ${info.ok && info.fresh && !info.active ? '' : 'disabled'}`) }));
}

// ---------------------------------------------------------------- 5 · Report
// Replication counts of one Monte Carlo output (Requested/Completed of the output, improper solutions of TECH9,
// read by lib/dfi.js). The counts need only the .out: an empty RESULTS text skips reading the replication rows.
const mcMemo = new WeakMap();
function mcCounts(f) {
  const r = S.runs[f.name];
  if (!r || r.out == null) return null;
  if (!mcMemo.has(r)) {
    const m = D.readMcRun(r.out, '');
    mcMemo.set(r, fin(m.completed) ? { requested: m.requested, completed: m.completed, improper: m.improper.size } : { error: m.error || true });
  }
  return mcMemo.get(r);
}
// The Mplus files of the study: the source model (source.out or cfa.out) and every Monte Carlo output
function outputsCard() {
  const P = S.P;
  if (!P) return '';
  const outs = new Set(sheetFiles());
  const rows = [];
  if (P.source.mode === 'out' && outs.has(SOURCE_OUT)) rows.push({ file: SOURCE_OUT, label: `${t('Your model', 'Modeliniz')}${P.source.name && P.source.name !== SOURCE_OUT ? ` · ${P.source.name}` : ''}` });
  if (P.source.mode === 'csv' && outs.has(CFA.out)) rows.push({ file: CFA.out, label: t('CFA of your data', 'Verinizin CFA’sı'), st: CFA.out === failedOut(outs) ? 'error' : undefined });
  for (const f of dfiFiles()) {
    const j = S.jobs.get(f.name);
    if (!outs.has(f.out) || neverRan(j, f.name)) continue;
    rows.push({ file: f.out, label: lvLabel(f), mc: mcCounts(f) || { none: true }, st: (j && j.status) || recordedStatus(f.name) || undefined });
  }
  if (!rows.length) return '';
  const dash = '<span class="muted" aria-hidden="true">—</span>';
  const errCell = (file) => `<td class="num" colspan="2"><button class="link" data-act="openSheet" data-file="${esc(file)}" data-jump="err"><span class="st error"><i></i>${t('Error', 'Hata')}</span></button></td>`;
  const cells = (mc, file, st) => {
    if (st === 'error' || (mc && mc.error)) return errCell(file);
    if (!mc || mc.none) return `<td class="num">${dash}</td><td class="num">${dash}</td>`;
    const lab = t(`${nfL(mc.improper)} improper solution${mc.improper === 1 ? '' : 's'}: open the TECH9 section of ${file}`, `${nfL(mc.improper)} uygunsuz çözüm: ${file} dosyasının TECH9 bölümünü aç`);
    const imp = mc.improper ? `<button class="link mono" data-act="openSheet" data-file="${esc(file)}" data-jump="tech9" aria-label="${esc(lab)}" data-tip="${t('Open the TECH9 messages of this output', 'Bu çıktının TECH9 iletilerini aç')}">${nfL(mc.improper)}</button>` : nfL(mc.improper);
    return `<td class="num">${nfL(mc.completed)}/${nfL(mc.requested)}</td><td class="num">${imp}</td>`;
  };
  const tr = rows.map((r) => `<tr><td><button class="link mono" data-act="openSheet" data-file="${esc(r.file)}">${esc(r.file)}</button><div class="hint" style="margin-top:0">${esc(r.label)}</div></td>${cells(r.mc, r.file, r.st)}</tr>`).join('');
  const info = runInfo();
  const stale = info.rec && !info.fresh && !info.active ? t(' These are from the last run; the model or the settings changed since.', ' Bunlar son çalıştırmanın dosyalarıdır; model ya da ayarlar o zamandan beri değişti.') : '';
  return `<section class="card">${cardHead(t('Mplus outputs', 'Mplus çıktıları'), t('The files Mplus wrote for this study. Click one to read it; errors, warnings and improper solutions are highlighted.', 'Mplus’ın bu çalışma için yazdığı dosyalar. Okumak için birine tıklayın; hatalar, uyarılar ve uygunsuz çözümler vurgulanır.') + stale)}
    <div class="card-b"><div class="table-wrap"><table class="dtab"><thead><tr><th>${t('Output', 'Çıktı')}</th><th class="num">${t('Completed', 'Tamamlanan')}</th><th class="num">${t('Improper', 'Uygunsuz')}</th></tr></thead><tbody>${tr}</tbody></table></div></div></section>`;
}
function ctrlReport() {
  const secs = ((S.ms && S.ms.secs) || []).filter((s) => s.label);
  const filled = secs.filter((s) => s.filled).length;
  const toc = secs.map((s) => `<button class="toc-row" data-act="scrollPaper" data-sec="${s.id}">${badge('', s.filled ? 'done' : 'open', 'toc-b', 11)}<span>${esc(s.label)}</span>${s.filled ? '' : `<small>${t('pending', 'bekliyor')}</small>`}</button>`).join('');
  const langCard = LANGS.length > 1 ? `<section class="card">${cardHead(t('Paper language', 'Makale dili'), t('The interface language does not change the paper.', 'Arayüz dili makaleyi değiştirmez.'))}<div class="card-b"><div class="seg seg-block" role="group" aria-label="${t('Paper language', 'Makale dili')}">${LANGS.map((l) => `<button data-act="paperLang" data-v="${l}" aria-pressed="${S.ui.paperLang === l}">${l === 'tr' ? 'Türkçe' : 'English'}</button>`).join('')}</div></div></section>` : '';
  const fc = !!(S.P && S.P.design.figColor);
  const figCard = `<section class="card">${cardHead(t('Figure 1', 'Şekil 1'), t('Black and white follows APA style for print; color separates the two distributions at a glance.', 'Siyah-beyaz baskı için APA biçemine uyar; renkli çizim iki dağılımı bir bakışta ayırır.'))}<div class="card-b"><div class="seg seg-block" role="group" aria-label="${t('Figure colors', 'Şekil renkleri')}"><button data-act="figColor" data-v="bw" aria-pressed="${!fc}">${t('Black and white', 'Siyah-beyaz')}</button><button data-act="figColor" data-v="color" aria-pressed="${fc}">${t('Color', 'Renkli')}</button></div></div></section>`;
  const csvBtn = S.dfi && S.dfi.ok ? `<section class="card">${cardHead(t('Replications', 'Tekrarlar'), t('Fit indices of every simulated data set (CSV), for your own checks.', 'Her simülasyon veri setinin uyum indeksleri (CSV); kendi denetimleriniz için.'))}<div class="card-b"><button class="btn" data-act="dlReps">${icon('download', 16)}${t('Download replications (CSV)', 'Tekrarları indir (CSV)')}</button></div></section>` : '';
  return ctrlWrap(ctrlHead(t('Step 5 · Report', 'Adım 5 · Rapor'), t('Paper draft', 'Makale taslağı'), t('An APA 7 draft written from the Mplus output. Every number comes from the runs; edit the text with your own interpretation.', 'Mplus çıktısından yazılan bir APA 7 taslağı. Her sayı çalıştırmalardan gelir; metni kendi yorumunuzla düzenleyin.')),
    `<section class="card">${cardHead(t('Sections', 'Bölümler'), t(`${filled}/${secs.length} sections written. Click a section to jump to it.`, `${filled}/${secs.length} bölüm yazıldı. Bir bölüme tıklayınca makalede ona gidilir.`))}<div class="card-b" style="padding-top:8px">${toc}</div></section>
     ${outputsCard()}${langCard}${figCard}${csvBtn}
     ${callout('info', t('Blue-pencil placeholders and yellow highlights only appear on screen; they are not printed or exported.', 'Mavi kalemle çizilen yer tutucular ve sarı vurgular yalnız ekranda görünür; yazdırılan ve indirilen makaleye çıkmaz.'), 'edit')}`,
    stepBar({
      back: { label: t('Run', 'Çalıştır'), attrs: 'data-act="go" data-route="run"' },
      info: t(`${filled}/${secs.length} sections written`, `${filled}/${secs.length} bölüm yazıldı`),
      tone: secs.length && filled === secs.length ? 'ok' : 'idle',
      actions: `<button class="btn btn-lg btn-icon" data-act="print" aria-label="${t('Print / PDF', 'Yazdır / PDF')}" data-tip="${t('Print / PDF', 'Yazdır / PDF')}">${icon('print', 18)}</button><button class="btn btn-primary btn-lg" data-act="dlReport">${icon('download', 17)}<span class="btn-t">${t('Download HTML', 'HTML indir')}</span></button>`,
    }));
}

// ======================================================================
// The live manuscript: sections in order; parts not written yet are blue-pencil placeholders
// ======================================================================
function labelsFor() {
  const m = {};
  const P = S.P;
  if (!P) return m;
  if (P.source.mode === 'csv') {
    for (const [c, v] of Object.entries(P.vars)) if (v.mplus) m[v.mplus.toUpperCase()] = v.labelEn || c;
    P.model.factors.forEach((f) => { m[String(f.name).toUpperCase()] = f.label || f.name; });
    if (P.model.second.on) m[String(P.model.second.name).toUpperCase()] = P.model.second.label || P.model.second.name;
  }
  return m;
}
function manuscript(lang) {
  const X = (en, tr) => tp(lang, en, tr);
  const P = S.P, secs = [];
  const add = (id, html, filled, label = '') => secs.push({ id, html, filled: !!filled, label });
  let tabN = 0, figN = 0;
  const cap = (kind, title) => {
    const n = kind === 'T' ? ++tabN : ++figN;
    const w = kind === 'T' ? [t('Table', 'Tablo'), X('Table', 'Tablo')] : [t('Figure', 'Şekil'), X('Figure', 'Şekil')];
    return { ui: `${w[0]} ${n}`, html: `<p class="tcap"><b>${w[1]} ${n}</b></p><p class="tcap"><i>${esc(title)}</i></p>` };
  };
  const go = (label, route) => `<button class="ph-go" data-act="go" data-route="${route}">${esc(label)}${icon('arrow', 13)}</button>`;
  const ph = (text, action = '') => `<div class="np ph">${icon('edit', 15)}<span>${esc(text)}</span>${action}</div>`;
  const lines = (n = 3) => `<div class="np ph-lines" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i style="width:${i === n - 1 ? 56 : 100 - i * 3}%"></i>`).join('')}</div>`;
  const src = hasSource();
  const mode = P ? P.source.mode : null;
  const d = P ? derive() : { spec: null, plan: null };
  const structOk = src && !structErrors().length;
  const info = P ? runInfo() : null;
  const sum = info && info.fresh && info.ok && !info.active ? S.dfi : null;
  const labels = labelsFor();
  const lab = (x) => labels[String(x).toUpperCase()] || x;
  const st = d.spec ? (() => { try { return D.structure(d.spec); } catch { return null; } })() : null;
  const version = (d.spec && d.spec.version) || (S.health && S.health.engines && S.health.engines.mplus && S.health.engines.mplus.ok ? S.health.engines.mplus.version : null);
  // the structure the paper describes: from the estimates when known, else from the factor assignment
  let factors = [], second = null, catg = false, nCat = null;
  if (st) {
    factors = st.first.map((f) => ({ name: f, label: lab(f), items: d.spec.by.filter((x) => x.f === f && st.items.includes(x.ind)).map((x) => lab(x.ind)) }));
    second = st.higher.length ? { name: st.higher[0], label: lab(st.higher[0]) } : null;
    catg = d.spec.thr.length > 0;
    if (catg) { const k = st.items.map((i) => d.spec.thr.filter((x) => x.item === i).length + 1).filter((x) => x > 1); nCat = [Math.min(...k), Math.max(...k)]; }
  } else if (mode === 'csv' && structOk) {
    factors = P.model.factors.filter((f) => f.items.length).map((f) => ({ name: f.name, label: f.label || f.name, items: f.items.map((c) => (P.vars[c] && P.vars[c].labelEn) || c) }));
    second = P.model.second.on ? { name: P.model.second.name, label: P.model.second.label || P.model.second.name } : null;
    catg = categorical();
    if (catg) { const k = modelItems().map((c) => S.stats[c].cats); nCat = [Math.min(...k), Math.max(...k)]; }
  }
  const ctx = {
    mode, dataName: P && P.data.name, nRows: mode === 'csv' && S.table ? S.table.nRows : NaN, nCols: mode === 'csv' && S.table ? S.table.columns.length : NaN,
    sourceName: P && P.source.name, n: d.spec ? d.spec.n : NaN, factors: structOk || st ? factors : [], second, categorical: catg, nCat,
    cfaEstimator: mode === 'csv' ? (structOk ? cfaEstimator() : null) : d.spec ? d.spec.estimator : null, version,
    plan: structOk && d.plan ? d.plan : null, policy: P ? P.design.policy : 'include', lab,
  };
  const mt = R.methodText(ctx, lang);
  const toData = go(t('Load a model', 'Model yükle'), 'data');
  const toStruct = go(src ? t('Define the structure', 'Yapıyı tanımla') : t('Load a model', 'Model yükle'), src ? 'roles' : 'data');

  // title block
  const date = new Date().toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  add('head', `<div class="ms-run"><span><span lang="en">${APP}</span> · ${X('dynamic fit index cutoffs', 'dinamik uyum kesme değerleri')}</span><span>${X('Draft', 'Taslak')} · ${date}</span></div><h1 class="ms-title">${P ? esc(P.name) : X('Untitled study', 'Adsız çalışma')}</h1><p class="ms-meta">${esc(`${X('Confirmatory factor analysis with dynamic fit index cutoffs', 'Dinamik uyum kesme değerleriyle doğrulayıcı faktör analizi')} · ${R.engineLabel({ version })}`)}</p>`, !!P);

  // Method
  add('method', `<h2 class="rep-h">${X('Method', 'Yöntem')}</h2><h3 class="rep-h3">${X('Data', 'Veri')}</h3>${mt.data || lines(2) + ph(mode === 'csv' ? t('The Data paragraph is completed after the CFA has run (the analysis sample comes from Mplus).', 'Veri paragrafı CFA çalıştıktan sonra tamamlanır (analiz örneklemi Mplus’tan gelir).') : t('The Data paragraph is written here once a model is loaded.', 'Model yüklenince Veri paragrafı burada yazılır.'), mode === 'csv' && S.table ? '' : toData)}`, !!mt.data, t('Method · Data', 'Yöntem · Veri'));
  add('measures', `<h3 class="rep-h3">${X('Measures', 'Ölçümler')}</h3>${mt.measures || lines(2) + ph(t('Define the factor structure; the Measures paragraph is written here.', 'Faktör yapısını tanımlayın; Ölçümler paragrafı burada yazılır.'), toStruct)}`, !!mt.measures, t('Method · Measures', 'Yöntem · Ölçümler'));
  add('analysis', `<h3 class="rep-h3">${X('Analysis', 'Analiz')}</h3>${mt.analysis || lines(3) + ph(mode === 'csv' && structOk ? t('The Analysis paragraph names the misspecification levels, which are chosen from the standardized solution after the CFA has run.', 'Analiz paragrafı, CFA çalıştıktan sonra standartlaştırılmış çözümden seçilen yanlış belirtme düzeylerini anar.') : t('The Analysis paragraph describes the simulation; it is written once the structure is complete.', 'Analiz paragrafı simülasyonu anlatır; yapı tamamlanınca yazılır.'), structOk ? go(t('Go to run', 'Çalıştırmaya git'), 'run') : toStruct)}`, !!mt.analysis, t('Method · Analysis', 'Yöntem · Analiz'));

  // Table 1: standardized loadings
  {
    const c = cap('T', X('Standardized Factor Loadings', 'Standartlaştırılmış Faktör Yükleri'));
    let h = c.html;
    const ok = !!(d.spec && st);
    if (ok) h += `<div class="table-wrap">${R.loadingsTable(d.spec, st, labels, lang, { estimator: ctx.cfaEstimator, version })}</div>`;
    else h += ph(mode === 'csv' ? t('The standardized loadings are tabulated here after the CFA has run.', 'Standartlaştırılmış yükler CFA çalıştıktan sonra burada tablolanır.') : t('The standardized loadings are tabulated here once a model is loaded.', 'Standartlaştırılmış yükler model yüklenince burada tablolanır.'), mode === 'csv' && structOk ? go(t('Go to run', 'Çalıştırmaya git'), 'run') : toStruct);
    add('t-load', `<div class="avoid">${h}</div>`, ok, `${c.ui} · ${t('Standardized loadings', 'Standart yükler')}`);
  }

  // Results
  const resPh = () => {
    if (!structOk) return t('The results are written here after the run.', 'Sonuçlar çalıştırmadan sonra burada yazılır.');
    if (info.active) return t('Mplus is running; the cutoffs appear here when the simulation finishes.', 'Mplus çalışıyor; kesme değerleri simülasyon bitince burada görünür.');
    if (info.err) return t('The last run ended with an error. See the Run step.', 'Son çalıştırma hatayla bitti. Çalıştır adımına bakın.');
    if (info.ok && !info.fresh) return t('The model or the settings changed after the last run. Run again to update the results.', 'Son çalıştırmadan sonra model ya da ayarlar değişti. Sonuçları güncellemek için yeniden çalıştırın.');
    return t('Run the simulation in Mplus; the cutoffs and their comparison with the model are written here.', 'Simülasyonu Mplus’ta çalıştırın; kesme değerleri ve modelle karşılaştırılması burada yazılır.');
  };
  const toRun = go(structOk ? t('Go to run', 'Çalıştırmaya git') : src ? t('Define the structure', 'Yapıyı tanımla') : t('Load a model', 'Model yükle'), structOk ? 'run' : src ? 'roles' : 'data');
  const emp = d.spec ? d.spec.fit : null;
  const interp = sum ? D.interpret(emp, sum) : null;
  const interpS = sum ? D.interpret(emp, sum, undefined, 's') : null; // structural levels of second-order models
  add('results', `<h2 class="rep-h">${X('Results', 'Bulgular')}</h2>${sum ? R.resultsText(emp, sum, d.plan, interp, lang, interpS) : lines(3) + ph(resPh(), toRun)}`, !!sum, t('Results', 'Bulgular'));
  {
    const observed = !!(emp && [emp.srmr, emp.rmsea, emp.cfi].some((x) => Number.isFinite(x)));
    const c = cap('T', observed ? X('Observed Fit and Dynamic Fit Index Cutoffs', 'Gözlenen Uyum ve Dinamik Uyum İndeksi Kesme Değerleri') : X('Dynamic Fit Index Cutoffs', 'Dinamik Uyum İndeksi Kesme Değerleri'));
    const h = c.html + (sum ? `<div class="table-wrap">${R.fitTable(emp, sum, d.plan, lang, lab)}</div>` : ph(t('The cutoffs of every misspecification level are tabulated here after the run.', 'Her yanlış belirtme düzeyinin kesme değerleri çalıştırmadan sonra burada tablolanır.'), toRun));
    add('t-fit', `<div class="avoid">${h}</div>`, !!sum, `${c.ui} · ${t('Fit and cutoffs', 'Uyum ve kesme değerleri')}`);
  }
  {
    // Table 3 holds the other rule: the sensitivity at 95% specificity, or the 95/5 cutoffs when Table 2 has the former
    const c = cap('T', d.plan && d.plan.rule === 'sens' ? X('Simulation Conditions, Improper Solutions, and 95/5 Cutoffs', 'Simülasyon Koşulları, Uygunsuz Çözümler ve 95/5 Kesme Değerleri') : X('Simulation Conditions, Improper Solutions, and Sensitivity', 'Simülasyon Koşulları, Uygunsuz Çözümler ve Duyarlılık'));
    const h = c.html + (sum ? `<div class="table-wrap">${R.conditionsTable(sum, d.plan, lang)}</div>` : ph(t('Completed replications, improper solutions and the sensitivity of the cutoffs are tabulated here after the run.', 'Tamamlanan tekrarlar, uygunsuz çözümler ve kesme değerlerinin duyarlılığı çalıştırmadan sonra burada tablolanır.'), toRun));
    add('t-cond', `<div class="avoid">${h}</div>`, !!sum, `${c.ui} · ${t('Simulation conditions', 'Simülasyon koşulları')}`);
  }
  {
    const c = cap('F', X('Distributions of the Fit Indices Under the Correct and the Misspecified Models', 'Doğru ve Yanlış Belirtilmiş Modellerde Uyum İndekslerinin Dağılımları'));
    let h = c.html;
    if (sum) {
      const use = (rows) => (sum.policy === 'exclude' ? rows.filter((x) => !x.improper) : rows);
      const main = (l, k) => (sum.rule === 'sens' ? l.sens[k].value : l.hb[k].value); // the cutoffs of Table 2
      const row = (l, label) => ({ level: l.level, label, rows: use(sum.byLevel[l.key]), cut: { srmr: main(l, 'srmr'), rmsea: main(l, 'rmsea'), cfi: main(l, 'cfi') } });
      const data = { correct: use(sum.byLevel[0]), levels: [...sum.levels.map((l) => row(l, `${X('Level', 'Düzey')} ${l.level}`)), ...(sum.slevels || []).map((l) => row(l, `${X('Level', 'Düzey')} S${l.level}`))], empirical: emp && fin(emp.cfi) && !d.plan.estMismatch ? emp : null }; // no observed line on ML cutoffs of a WLSMV model
      const color = !!(S.P && S.P.design.figColor);
      const keyEn = color ? 'blue: correct model; orange: misspecified model' : 'grey: correct model; open: misspecified model';
      const keyTr = color ? 'mavi: doğru model; turuncu: yanlış belirtilmiş model' : 'gri: doğru model; açık: yanlış belirtilmiş model';
      h += `<div class="fig">${dfiChart(data, { lang, width: 700, color })}</div><p class="tnote">${X(`<i>Note.</i> Histograms of ${apaRep(d.plan.reps, lang)} replications per condition (${keyEn}). Dashed lines mark the dynamic cutoffs, dotted lines the fixed cutoffs of Hu and Bentler (1999)${data.empirical ? ', and solid lines (or arrows, when off the scale) the observed fit of the model' : ''}.`, `<i>Not.</i> Koşul başına ${apaRep(d.plan.reps, lang)} tekrarın histogramları (${keyTr}). Kesikli çizgiler dinamik kesme değerlerini, noktalı çizgiler Hu ve Bentler’in (1999) sabit kesme değerlerini${data.empirical ? ', düz çizgiler (ölçek dışındaysa oklar) modelin gözlenen uyumunu' : ''} gösterir.`)}</p>`;
    } else h += ph(t('The distributions of the simulated fit indices are drawn here after the run.', 'Simülasyon uyum indekslerinin dağılımları çalıştırmadan sonra burada çizilir.'), toRun);
    add('f-dist', `<div class="avoid">${h}</div>`, !!sum, `${c.ui} · ${t('Distributions', 'Dağılımlar')}`);
  }
  add('refs', `<h2 class="rep-h">${X('References', 'Kaynaklar')}</h2>${R.references({ plan: ctx.plan, version }, lang)}`, true);
  return { secs };
}
const apaRep = (n, lang) => R.apaInt(n, lang);

// Updates the paper: only changed sections are redrawn, and they get the yellow marker sweep
function renderPaper() {
  const ms = S.ms;
  $('#report').lang = S.ui.paperLang;
  const body = $('#paperBody');
  const key = `${S.P ? S.P.id : '-'}|${S.ui.paperLang}|${S.ui.lang}`;
  const norm = (h) => h.replace(/data-since="\d+"/g, '');
  const prev = S.paperPrev;
  const reset = !prev || S.paperKey !== key;
  const quiet = Date.now() < (S.paperQuietUntil || 0);
  const wrap = (s, fresh) => `<section class="ms-sec${s.filled ? '' : ' is-pending'}${fresh && s.filled ? ' ms-fresh' : ''}" data-sec="${s.id}">${s.html}</section>`;
  const ids = ms.secs.map((s) => s.id).join('|');
  if (reset || ids !== S.paperIds) {
    body.innerHTML = ms.secs.map((s) => wrap(s, !reset && !quiet && (!prev.has(s.id) || prev.get(s.id) !== norm(s.html)))).join('');
  } else {
    for (const s of ms.secs) {
      if (prev.get(s.id) === norm(s.html)) continue;
      const el = body.querySelector(`[data-sec="${s.id}"]`);
      if (el) el.outerHTML = wrap(s, !quiet);
    }
  }
  S.paperPrev = new Map(ms.secs.map((s) => [s.id, norm(s.html)]));
  S.paperIds = ids;
  S.paperKey = key;
  renderDeskBar();
}
function renderDeskBar() {
  const secs = ((S.ms && S.ms.secs) || []).filter((s) => s.label);
  const filled = secs.filter((s) => s.filled).length;
  const frac = secs.length ? filled / secs.length : 0;
  const txt = t(`Paper draft · ${filled}/${secs.length} sections`, `Makale taslağı · ${filled}/${secs.length} bölüm`);
  const langSeg = LANGS.length > 1 ? `<span class="db-l">${t('Paper', 'Makale')}</span><div class="seg seg-sm" role="group" aria-label="${t('Paper language', 'Makale dili')}">${LANGS.map((l) => `<button data-act="paperLang" data-v="${l}" aria-pressed="${S.ui.paperLang === l}">${l.toUpperCase()}</button>`).join('')}</div>` : '';
  $('#deskBar').innerHTML = `<button class="btn btn-sm btn-ghost pane-back" data-act="pane" data-v="ctrl">${icon('back', 15)}${t('Controls', 'Kontroller')}</button>
    <div class="db-status" title="${esc(txt)}"><span class="db-meter" aria-hidden="true"><i style="transform:scaleX(${frac.toFixed(3)})"></i></span><span class="db-txt">${esc(txt)}</span></div>
    <div class="db-tools">${langSeg}<div class="btn-group"><button class="btn btn-icon" data-act="print" data-tip="${t('Print / PDF', 'Yazdır / PDF')}" aria-label="${t('Print / PDF', 'Yazdır / PDF')}">${icon('print', 16)}</button><button class="btn btn-icon" data-act="dlReport" data-tip="${t('Download HTML', 'HTML indir')}" aria-label="${t('Download HTML', 'HTML indir')}">${icon('download', 16)}</button></div></div>`;
}

// ---------------------------------------------------------------- code sheet (run files over the paper)
// Mplus highlighting: commands bold, factor names navy, the misspecification lines (added cross-loadings or
// residual correlations of the population model) amber.
function highlightMplus(code, factorNames) {
  const fac = new Set(factorNames.map((x) => String(x).toUpperCase()));
  let cmd = '', mis = false;
  return code.replace(/\n$/, '').split('\n').map((line) => {
    if (/^\s*!\s*ANALYSIS-WORKBENCH/.test(line)) return `<span class="ln"><span class="c-meta">${esc(line)}</span></span>`;
    if (/^\s*!\s*misspecification/i.test(line)) { mis = true; return `<span class="ln"><span class="c-com">${esc(line)}</span></span>`; }
    const ci = line.indexOf('!');
    const bodyTxt = ci >= 0 ? line.slice(0, ci) : line;
    const com = ci >= 0 ? `<span class="c-com">${esc(line.slice(ci))}</span>` : '';
    const m = bodyTxt.match(/^(\s*)((?:TITLE|DATA|VARIABLE|DEFINE|ANALYSIS|MODEL(?: [A-Z]+)?|OUTPUT|SAVEDATA|PLOT|MONTECARLO):)(.*)$/i);
    let pre = '', rest = bodyTxt;
    if (m) { pre = `${m[1]}<span class="c-cmd">${esc(m[2])}</span>`; rest = m[3]; cmd = m[2].toUpperCase(); mis = false; }
    if (cmd === 'TITLE:') return `<span class="ln">${pre}${esc(rest)}${com}</span>`;
    if (mis && /\b(BY|WITH)\b/i.test(rest)) return `<span class="ln">${pre}<span class="c-w">${esc(rest)}</span>${com}</span>`;
    const parts = rest.split(/(\b[A-Za-z_][A-Za-z0-9_]*\b)/);
    const out = parts.map((w, i) => {
      if (i % 2 === 0) return esc(w).replace(/@(-?[\d.]+)/g, '<span class="c-fix">@$1</span>').replace(/\*(-?[\d.]+)/g, '<span class="c-sv">*$1</span>');
      const u = w.toUpperCase();
      if (/^(ON|BY|WITH)$/.test(u) && cmd.startsWith('MODEL')) return `<span class="c-cmd">${esc(w)}</span>`;
      if (cmd.startsWith('MODEL') && fac.has(u)) return `<span class="c-b">${esc(w)}</span>`;
      return esc(w);
    }).join('');
    return `<span class="ln">${pre}${out}${com}</span>`;
  }).join('');
}
// Mplus output (.out): errors and "did not terminate normally" in the error tone, warnings in the warning tone,
// TECH9 replications with an improper solution in the warning tone with a margin rule (the test of readMcRun in
// lib/dfi.js), top-level section headers bold. Built once per text (S.outCache); the jump bar uses the marks.
const OUT_IMPROPER = /NOT POSITIVE DEFINITE|NEGATIVE (RESIDUAL )?VARIANCE|NON-POSITIVE DEFINITE/i;
const OUT_ERR = /^\s*\*\*\* (?:FATAL )?ERROR|^\s*THE MODEL ESTIMATION DID NOT TERMINATE NORMALLY|^\s*NO CONVERGENCE/;
const OUT_WARN = /^\s*\*\*\* WARNING|^\s*WARNING:|^\s*THE STANDARD ERRORS OF THE MODEL PARAMETER ESTIMATES (?:MAY NOT BE TRUSTWORTHY|COULD NOT BE COMPUTED)/;
const OUT_HEAD = /^(?:[A-Z][A-Z0-9 &,.()'-]*[A-Z0-9)]|STD(?:Y|YX)? Standardization)\s*$/;
const OUT_JUMPS = [['sum', /^SUMMARY OF ANALYSIS\s*$/], ['fit', /^MODEL FIT INFORMATION\s*$/], ['res', /^MODEL RESULTS\s*$/], ['stdyx', /^STDYX Standardization\s*$/], ['tech9', /^TECHNICAL 9 OUTPUT\s*$/]];
const isOutFile = (name) => /\.out$/i.test(name);
const OUT_CHUNK = 200;
const outLine = (pre, k) => { const c = pre.children[Math.floor(k / OUT_CHUNK)]; return c ? c.children[k % OUT_CHUNK] : null; };
function highlightOut(text) {
  const lines = String(text).replace(/\r/g, '').replace(/\n$/, '').split('\n');
  const n = lines.length;
  const cls = new Array(n).fill('');
  const tagged = new Uint8Array(n);
  const skip = new Uint8Array(n); // the echoed input and TECH9 are not read by the general rules
  const marks = { err: [], warn: [], improper: 0 };
  const ii = lines.findIndex((l) => /^INPUT INSTRUCTIONS\s*$/.test(l));
  if (ii >= 0) for (let j = ii + 1; j < n && !/^\S/.test(lines[j]); j++) skip[j] = 1;
  const t9 = lines.findIndex((l) => /^TECHNICAL 9 OUTPUT/.test(l));
  if (t9 >= 0) {
    let start = -1, j = t9 + 1;
    const flush = (end) => { // one replication: [start, end)
      if (start < 0) return;
      let last = end - 1;
      while (last > start && !lines[last].trim()) last--;
      if (last === start) return;
      const imp = OUT_IMPROPER.test(lines.slice(start + 1, last + 1).map((s) => s.trim()).join(' ')); // as readMcRun
      for (let k = start; k <= last; k++) cls[k] = imp ? 'o-imp' : 'o-warn';
      cls[start] += ' o-start';
      if (imp) { tagged[start] = 1; marks.improper++; }
    };
    for (; j < n && !/^\S/.test(lines[j]); j++) {
      skip[j] = 1;
      if (/^\s*REPLICATION\s+\d+:/.test(lines[j])) { flush(j); start = j; }
    }
    flush(j);
  }
  for (let i = 0; i < n; i++) {
    if (skip[i]) continue;
    const l = lines[i];
    const kind = OUT_ERR.test(l) ? 'err' : OUT_WARN.test(l) ? 'warn' : '';
    if (kind) { // the message runs to the next blank line (or the next message)
      marks[kind].push(i);
      let j = i;
      do { cls[j] = `o-${kind}`; j++; } while (j < n && j - i < 16 && lines[j].trim() && !skip[j] && !OUT_ERR.test(lines[j]) && !OUT_WARN.test(lines[j]));
      cls[i] += ' o-start';
      i = j - 1;
    } else if (OUT_HEAD.test(l) && /[A-Za-z]{3}/.test(l) && !/\S\s{3,}\S/.test(l) && !/\d\.\d/.test(l) && !/MUTHEN/.test(l)) cls[i] = 'o-h'; // not table rows (e.g. MODINDICES "Y4 WITH Y1 …") or the copyright line
  }
  for (const [k, re] of OUT_JUMPS) { const i = lines.findIndex((l, x) => !skip[x] && re.test(l)); if (i >= 0) marks[k] = [i]; }
  const tag = `<span class="o-tag">${esc(t('improper solution', 'uygunsuz çözüm'))}</span>`;
  // blocks of OUT_CHUNK lines that the browser lays out only near the view (content-visibility); the line
  // numbers are attributes, because CSS counters do not cross such a block
  const parts = [];
  for (let c = 0; c < n; c += OUT_CHUNK) {
    const m = Math.min(OUT_CHUNK, n - c);
    let h = `<div class="o-chunk" style="--n:${m}">`;
    for (let i = c; i < c + m; i++) h += `<span class="ln${cls[i] ? ' ' + cls[i] : ''}" data-n="${i + 1}">${esc(lines[i])}${tagged[i] ? tag : ''}</span>`;
    parts.push(h + '</div>');
  }
  return { html: parts.join(''), marks, lines: n };
}
function outView(name, text) {
  const c = S.outCache.get(name);
  if (c && c.text === text && c.lang === S.ui.lang) return c;
  const v = { ...highlightOut(text), text, lang: S.ui.lang, h: hash(text) };
  S.outCache.set(name, v);
  return v;
}
function jumpBar(v) {
  const m = v.marks;
  const L = { sum: t('Summary', 'Özet'), fit: t('Fit', 'Uyum'), res: t('Results', 'Sonuçlar'), stdyx: 'STDYX', tech9: 'TECH9' };
  const sec = OUT_JUMPS.filter(([k]) => m[k]).map(([k]) => {
    const imp = k === 'tech9' && m.improper ? `<span class="count">${nfL(m.improper)} ${t('improper', 'uygunsuz')}</span>` : '';
    const say = t(`${nfL(m.improper)} replication${m.improper === 1 ? '' : 's'} ended in an improper solution`, `${nfL(m.improper)} tekrar uygunsuz çözümle bitti`);
    const tip = k === 'tech9' && m.improper ? ` data-tip="${esc(say)}" aria-label="${esc(`TECH9: ${say}`)}"` : '';
    return `<button class="jmp" data-act="outJump" data-v="${k}"${tip}>${L[k]}${imp}</button>`;
  }).join('');
  const iss = [['err', t('Errors', 'Hatalar'), t('error', 'hata')], ['warn', t('Warnings', 'Uyarılar'), t('warning', 'uyarı')]].filter(([k]) => m[k].length).map(([k, label, one]) => {
    const many = m[k].length > 1;
    const hint = t(`${nfL(m[k].length)} messages: click again for the next ${one}`, `${nfL(m[k].length)} ileti: sonraki ${one} için yeniden tıklayın`);
    const tip = many ? ` data-tip="${esc(hint)}" aria-label="${esc(`${label}: ${hint}`)}"` : ` aria-label="${esc(`${label}: ${nfL(m[k].length)}`)}"`;
    return `<button class="jmp ${k}" data-act="outJump" data-v="${k}"${tip}>${icon('alert', 14)}${label}<span class="count">${nfL(m[k].length)}</span></button>`;
  }).join('');
  if (!sec && !iss) return '';
  return `<div class="sh-jump" role="group" aria-label="${t('Jump to a part of the output', 'Çıktının bir bölümüne git')}"><span class="sh-jump-l" aria-hidden="true">${t('Jump to', 'Bölüme git')}</span>${sec}${iss ? `<span class="sh-jump-iss">${iss}</span>` : ''}</div>`;
}
// The element that scrolls the sheet's text: the code block itself (a scrolling flex item), else the body
function sheetScroller(el = $('#codeSheet')) {
  const body = el && el.querySelector('.sh-body');
  const code = body && body.querySelector('pre.code, textarea.code-edit');
  return code && code.scrollHeight > code.clientHeight + 1 ? code : body;
}
// Scrolls the open output to a section; errors and warnings step to the next message on every click
function jumpOut(kind, smooth = true) {
  const v = S.outCache.get(S.sheetName);
  const pre = $('#codeSheet pre.code-o');
  const body = sheetScroller();
  let at = v && v.marks[kind];
  if (v && kind === 'err' && (!at || !at.length)) { kind = 'warn'; at = v.marks.warn; } // a failed run without an error line: its warnings
  if (!pre || !body || !at || !at.length) return;
  // layout offsets (pre.code-o is positioned): exact also while the sheet's opening transform still runs
  const origin = body === pre ? 0 : pre.offsetTop - body.offsetTop;
  const y = (k) => { // offset of line k inside pre.code-o (via its block)
    const ln = outLine(pre, k);
    if (!ln) return 0;
    let top = 0;
    for (let e = ln; e && e !== pre; e = e.offsetParent) top += e.offsetTop;
    return top + origin;
  };
  const last = S.ui.jumpLast;
  let i = 0;
  if (at.length > 1) {
    if (last && last.file === S.sheetName && last.kind === kind && (Date.now() - last.at < 1500 || Math.abs(body.scrollTop - last.top) < 4)) i = (last.i + 1) % at.length;
    else { i = at.findIndex((k) => y(k) > body.scrollTop + 14); if (i < 0) i = 0; }
  }
  const top = Math.max(0, Math.min(y(at[i]) - 10, body.scrollHeight - body.clientHeight));
  body.scrollTo({ top, behavior: smooth ? scrollMode() : 'auto' });
  S.ui.jumpLast = { file: S.sheetName, kind, i, top, at: Date.now() };
  const ln = outLine(pre, at[i]);
  if (ln) { ln.classList.remove('o-hit'); void ln.offsetWidth; ln.classList.add('o-hit'); setTimeout(() => ln.classList.remove('o-hit'), 1900); }
}
// File tabs: one scrolling row; the open file stays in view and the edges fade where more tabs are hidden
function tabFades(row) {
  row.classList.toggle('fade-l', row.scrollLeft > 2);
  row.classList.toggle('fade-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
}
function showActiveTab(row) {
  const a = row.querySelector('[aria-pressed="true"]');
  if (a && row.scrollWidth > row.clientWidth) {
    const r = row.getBoundingClientRect(), b = a.getBoundingClientRect();
    if (b.left < r.left + 32) row.scrollLeft += b.left - r.left - 32;
    else if (b.right > r.right - 32) row.scrollLeft += b.right - r.right + 32;
  }
  tabFades(row);
}
function sheetFiles() {
  const P = S.P;
  if (!P) return [];
  const list = [];
  if (P.source.mode === 'out' && S.srcText) list.push(SOURCE_OUT);
  if (P.source.mode === 'csv' && S.table && !structErrors().length) {
    list.push(CFA.input, CFA.data);
    if (S.files.has(CFA.out) && !cfaActive()) list.push(CFA.out);
  }
  for (const f of dfiFiles()) {
    list.push(f.name);
    const j = S.jobs.get(f.name);
    if (S.files.has(f.out) && !isActive(j) && !neverRan(j, f.name)) list.push(f.out);
  }
  return list;
}
async function loadFileText(name) {
  if (S.loadingFile === name) return;
  S.loadingFile = name;
  try { S.fileText.set(name, await getText(name)); } catch (e) { S.fileText.set(name, `(${e.message})`); }
  S.loadingFile = null;
  renderSheet();
}
function sheetText(name) {
  if (name === CFA.input) return buildCfa().input.text;
  if (name === CFA.data) {
    const full = buildCfa().data.text();
    const ls = full.replace(/\n$/, '').split('\n');
    return ls.length > 500 ? `${ls.slice(0, 500).join('\n')}\n${t(`… ${nfL(ls.length - 500)} more rows (the whole file is used in the run)`, `… ${nfL(ls.length - 500)} satır daha (çalıştırmada dosyanın tamamı kullanılır)`)}` : full;
  }
  const f = dfiFiles().find((x) => x.name === name);
  if (f) return f.text;
  return S.fileText.has(name) ? S.fileText.get(name) : null;
}
const isInputFile = (name) => /\.inp$/i.test(name);
function sheetFactorNames() {
  const d = derive();
  if (d.spec) { try { return D.structure(d.spec).factors; } catch { /* fall through */ } }
  const P = S.P;
  return P ? [...P.model.factors.map((f) => f.name), ...(P.model.second.on ? [P.model.second.name] : [])] : [];
}
function renderSheet() {
  const el = $('#codeSheet');
  const sh = S.ui.sheet;
  const files = sheetFiles();
  if (!sh || !S.P || !files.length) {
    if (el.classList.contains('on')) { el.classList.remove('on'); el.inert = true; $('#deskScroll').inert = false; }
    S.sheetKey = null;
    return;
  }
  const name = files.includes(sh.file) ? sh.file : files[0];
  const editable = name === CFA.input;
  const editing = editable && S.ui.editing === name;
  const built = editable ? buildCfa() : null;
  const text = sheetText(name);
  if (text == null) loadFileText(name);
  const ov = text != null && !editing && isOutFile(name) ? outView(name, text) : null;
  const key = [name, editing, S.ui.lang, files.join(','), text == null ? '…' : ov ? ov.h : hash(text)].join('|');
  if (S.sheetKey !== key) {
    // a redraw of the same file (e.g., a new tab after a finished run) keeps the reading position
    const oldBody = sheetScroller(el), oldRow = el.querySelector('.sh-files');
    const keepTop = S.sheetKey && S.sheetName === name && oldBody ? oldBody.scrollTop : 0;
    const keepLeft = oldRow ? oldRow.scrollLeft : 0;
    S.sheetKey = key;
    S.sheetName = name;
    const tabs = files.map((f) => `<button class="sh-file" data-act="sheetFile" data-file="${esc(f)}" aria-pressed="${f === name}"><span class="mdot ${isActive(S.jobs.get(f)) ? 'run' : ''}"></span>${esc(f)}</button>`).join('');
    let tools;
    if (editing) tools = `<button class="btn btn-sm btn-ghost" data-act="cancelEdit">${t('Cancel', 'Vazgeç')}</button><button class="btn btn-sm btn-primary" data-act="saveEdit">${icon('check', 15)}${t('Save', 'Kaydet')}</button>`;
    else tools = `<div class="btn-group" role="group" aria-label="${t('File tools', 'Dosya araçları')}"><button class="btn" data-act="copyFile" data-file="${esc(name)}">${icon('copy', 15)}${t('Copy', 'Kopyala')}</button><button class="btn" data-act="dlFile" data-file="${esc(name)}">${icon('download', 15)}${t('Download', 'İndir')}</button>${editable ? `<span class="sep" aria-hidden="true"></span>${built.input.edited ? `<button class="btn" data-act="resetEdit">${icon('undo', 15)}${t('Use generated', 'Üretileni kullan')}</button>` : ''}<button class="btn" data-act="editFile" data-file="${esc(name)}">${icon('edit', 15)}${t('Edit', 'Düzenle')}</button>` : ''}</div>`;
    let content;
    if (text == null) content = `<pre class="code code-out">${t('Loading…', 'Yükleniyor…')}</pre>`;
    else if (editing) content = `<textarea class="code-edit" id="codeEdit" spellcheck="false" aria-label="${esc(name)}">${esc(text)}</textarea>`;
    else if (isInputFile(name)) content = `<pre class="code" aria-label="${esc(name)}">${highlightMplus(text, sheetFactorNames())}</pre>`;
    else if (ov) content = `<pre class="code code-o" aria-label="${esc(name)}">${ov.html}</pre>`;
    else content = `<pre class="code code-out" aria-label="${esc(name)}">${esc(text)}</pre>`;
    el.innerHTML = `<div class="sh-head"><div class="sh-title">${icon('file', 16)}${t('Run files', 'Çalıştırma dosyaları')} <span class="muted font-normal">· Mplus</span></div>
        <div class="sh-files" role="group" aria-label="${t('Files', 'Dosyalar')}">${tabs}</div>
        ${tools}
        <button class="btn btn-sm btn-icon btn-ghost sh-close" data-act="closeSheet" aria-label="${t('Close', 'Kapat')}" data-tip="${t('Close (Esc)', 'Kapat (Esc)')}">${icon('x', 17)}</button></div>
      ${ov ? jumpBar(ov) : ''}<div class="sh-body">${content}</div>`;
    const body = sheetScroller(el), row = el.querySelector('.sh-files');
    if (keepTop && body) body.scrollTop = keepTop;
    if (row) { row.scrollLeft = keepLeft; showActiveTab(row); }
  }
  if (!el.classList.contains('on')) { el.classList.add('on'); el.inert = false; $('#deskScroll').inert = true; }
  // opened from an error (or another jump): go to that part once the output is shown
  if (sh.jump && ov && sh.file === name) { const k = sh.jump; sh.jump = null; requestAnimationFrame(() => jumpOut(k, false)); }
}

// Paper focus: sections related to the current step get a pencil line in the margin
function focusIds() {
  return { data: ['method'], roles: ['measures', 't-load'], model: ['analysis'], run: ['results', 't-fit', 't-cond', 'f-dist'] }[S.route.page] || [];
}
function scrollToSec(id, force = false) {
  const sc = $('#deskScroll');
  const el = document.querySelector(`#paperBody [data-sec="${id}"]`);
  if (!sc || !el) return;
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 84;
  const inView = top > sc.scrollTop - 10 && top < sc.scrollTop + sc.clientHeight * 0.45;
  if (force || !inView) sc.scrollTo({ top: Math.max(0, top), behavior: scrollMode() });
}
function focusPaper() {
  const ids = focusIds();
  document.querySelectorAll('#paperBody .ms-sec.is-focus').forEach((x) => x.classList.remove('is-focus'));
  ids.forEach((id) => { const el = document.querySelector(`#paperBody [data-sec="${id}"]`); if (el) el.classList.add('is-focus'); });
  const key = `${S.P ? S.P.id : ''}|${S.route.page}`;
  if (S.ui.focusKey !== key) {
    S.ui.focusKey = key;
    if (S.route.page === 'report') { const sc = $('#deskScroll'); if (sc) sc.scrollTo({ top: 0, behavior: scrollMode() }); }
    else if (ids.length) scrollToSec(ids[0]);
  }
}
function afterRender() {
  const selTrk = document.querySelector('.track [aria-current="step"]');
  if (selTrk) {
    const tr = selTrk.parentElement;
    if (tr.scrollWidth > tr.clientWidth) {
      const x = selTrk.getBoundingClientRect().left - tr.getBoundingClientRect().left + tr.scrollLeft;
      tr.scrollLeft = Math.max(0, x - (tr.clientWidth - selTrk.offsetWidth) / 2);
    }
  }
  const tabRow = $('#codeSheet .sh-files');
  if (tabRow) tabFades(tabRow);
  focusPaper();
}

// ======================================================================
// Events
// ======================================================================
const invalidate = () => { S.derived = null; };
const ACT = {
  go(el) {
    const page = el.dataset.route;
    if (!PAGES.includes(page)) return;
    if (page !== S.route.page) history.pushState(null, '', `#/${page}`);
    S.route = { page };
    S.ui.pane = 'ctrl';
    render();
    scrollCtrlTop();
  },
  pane(el) {
    S.ui.pane = el.dataset.v === 'paper' ? 'paper' : 'ctrl';
    $('#work').dataset.pane = S.ui.pane;
    if (S.ui.pane === 'paper') requestAnimationFrame(() => { const ids = focusIds(); if (ids.length) scrollToSec(ids[0], true); });
  },
  scrollPaper(el) {
    if (S.ui.sheet) { S.ui.sheet = null; S.ui.editing = null; renderSheet(); }
    if (isNarrow()) { S.ui.pane = 'paper'; $('#work').dataset.pane = 'paper'; }
    requestAnimationFrame(() => scrollToSec(el.dataset.sec, true));
  },
  uiLang(el) {
    S.ui.lang = pickLang(el.dataset.v);
    S.ui.paperLang = S.ui.lang;
    store.set('aa.lang', S.ui.lang);
    store.set('aa.paperLang', S.ui.paperLang);
    render();
  },
  paperLang(el) { S.ui.paperLang = pickLang(el.dataset.v); store.set('aa.paperLang', S.ui.paperLang); render(); },
  pickData() { $('#fileData').click(); },
  pickOut() { $('#fileOut').click(); },
  async loadSample() {
    try {
      const res = await fetch('data/sample.csv'); // relative: also next to the web version
      if (!res.ok) throw new Error(t('The sample data were not found (data/sample.csv).', 'Örnek veri bulunamadı (data/sample.csv).'));
      const txt = await res.text();
      if (!S.P || S.P.source.mode) await createProject('Sample · goal attainment');
      await loadDataText(txt, SAMPLE.file, { sample: true });
    } catch (e) { toast(e.message, 'err'); }
  },
  async startManual() { if (S.P && S.P.source.mode) await createProject('Hand-entered model'); await startManual(false); },
  async manualExample() { if (S.P && S.P.source.mode) await createProject('Example · A-SAGS (hand entry)'); await startManual(true); },
  async changeSource() {
    if (anyActive()) { toast(t('Wait for the running jobs to finish or cancel them first.', 'Önce çalışan işlerin bitmesini bekleyin ya da onları iptal edin.'), 'err'); return; }
    if (!(await confirmDlg(t('Change the source?', 'Kaynak değiştirilsin mi?'), t('The data or model of this project, the structure and the results are replaced. The files stay in the project folder.', 'Bu projenin verisi ya da modeli, yapısı ve sonuçları değiştirilir. Dosyalar proje klasöründe kalır.'), t('Change', 'Değiştir'), true))) return;
    S.P.source.mode = null;
    S.table = null; S.srcText = null; S.srcRes = null; invalidate();
    save();
    S.route = { page: 'data' };
    render();
  },
  toggleVar(el) { S.ui.openVar = S.ui.openVar === el.dataset.col ? null : el.dataset.col; render(); },
  async applyMissing() {
    const raw = S.ui.missingDraft != null ? S.ui.missingDraft : (S.P.data.missingCodes || []).join(', ');
    const codes = raw.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    S.P.data.missingCodes = codes;
    S.ui.missingDraft = null;
    const tb = parseTable(toCsv(S.table, S.table.columns), { missingCodes: codes });
    S.table = tb;
    computeStats();
    S.P.data.rev = (S.P.data.rev || 0) + 1;
    try { await putFile('data.csv', toCsv(tb, tb.columns)); } catch (e) { toast(e.message, 'err'); }
    invalidate();
    save();
    render();
    toast(t('Missing-value codes applied.', 'Eksik değer kodları uygulandı.'));
  },
  applyManual() {
    if (S.ui.manualDraft == null) return;
    S.P.source.text = S.ui.manualDraft;
    S.ui.manualDraft = null;
    invalidate();
    save();
    render();
  },
  addFactor() {
    const P = S.P;
    const used = new Set(P.model.factors.map((f) => String(f.name).toUpperCase()));
    let k = P.model.factors.length + 1;
    while (used.has(`F${k}`)) k++;
    P.model.factors.push({ name: `F${k}`, label: `Factor ${k}`, items: [] });
    save();
    render();
  },
  removeFactor(el) {
    const i = Number(el.dataset.i);
    S.P.model.factors.splice(i, 1);
    if (S.P.model.factors.filter((f) => f.items.length).length < 3) S.P.model.second.on = false;
    save();
    render();
  },
  toggleItem(el) {
    const i = Number(el.dataset.i), c = el.dataset.col;
    const fs = S.P.model.factors;
    const mine = fs[i].items.includes(c);
    fs.forEach((f) => { f.items = f.items.filter((x) => x !== c); });
    if (!mine) fs[i].items = S.table.columns.filter((x) => x === c || fs[i].items.includes(x));
    save();
    render();
  },
  setCat(el) { S.P.model.categorical = ['auto', 'yes', 'no'].includes(el.dataset.v) ? el.dataset.v : 'auto'; save(); render(); },
  setEstimator(el) { S.P.design.estimator = el.dataset.v; save(); render(); },
  setDataType(el) { if (el.dataset.v === 'auto-only') return; S.P.design.dataType = el.dataset.v === 'continuous' ? 'continuous' : 'auto'; invalidate(); save(); render(); },
  setReps(el) { S.P.design.reps = Number(el.dataset.v); invalidate(); save(); render(); },
  setPolicy(el) { S.P.design.policy = el.dataset.v === 'exclude' ? 'exclude' : 'include'; if (Object.keys(S.runs).length) summarize(); save(); render(); },
  setSigns(el) { S.P.design.signs = el.dataset.v === 'dynamic' ? 'dynamic' : 'invariant'; invalidate(); save(); render(); },
  figColor(el) { S.P.design.figColor = el.dataset.v === 'color'; save(); render(); },
  async recheck() {
    if (HOSTED) { connectDlg(); return; } // the web version: offer or open the app on this computer
    try { S.health = await api('/health?refresh=1'); } catch (e) { toast(e.message, 'err'); }
    render();
  },
  run() { runAll(); },
  cancel() { cancelRun(); },
  dlReps() {
    if (!S.dfi || !S.dfi.ok) return;
    const head = ['level', 'rep', 'chisq', 'df', 'pvalue', 'rmsea', 'srmr', 'cfi', 'tli', 'chisq_base', 'df_base', 'improper'];
    const body = S.dfi.rows.map((r) => [r.level, r.rep, r.chisq, r.df, r.pvalue, r.rmsea, r.srmr, r.cfi, r.tli, r.chisqBase, r.dfBase, r.improper ? 1 : 0].join(','));
    download(`${S.P.id}_dfi_replications.csv`, [head.join(','), ...body].join('\n') + '\n', 'text/csv');
  },
  openSheet(el) {
    const key = focusKey(el);
    if (key && !el.closest('#codeSheet')) S.ui.sheetReturn = { key, i: [...document.querySelectorAll(key)].indexOf(el) };
    S.ui.sheet = { file: el.dataset.file, jump: el.dataset.jump || null };
    S.ui.editing = null;
    if (isNarrow()) S.ui.pane = 'paper';
    render();
    setTimeout(() => { const sh = $('#codeSheet'); if (sh) sh.focus({ preventScroll: true }); }, 60);
  },
  closeSheet() {
    S.ui.sheet = null; S.ui.editing = null;
    if (isNarrow()) S.ui.pane = 'ctrl';
    render();
    const r = S.ui.sheetReturn;
    S.ui.sheetReturn = null;
    const back = r && (document.querySelectorAll(r.key)[r.i] || document.querySelector(r.key));
    const ae = document.activeElement;
    if (back && !back.disabled && (!ae || ae === document.body || ae.closest('#codeSheet'))) back.focus({ preventScroll: true });
  },
  sheetFile(el) { if (S.ui.sheet) { S.ui.sheet = { file: el.dataset.file, jump: null }; S.ui.editing = null; render(); } },
  outJump(el) { jumpOut(el.dataset.v); },
  copyFile(el) {
    const txt = el.dataset.file === CFA.data ? buildCfa().data.text() : sheetText(el.dataset.file);
    if (txt == null) return;
    navigator.clipboard.writeText(txt).then(() => toast(t('Copied to the clipboard.', 'Panoya kopyalandı.')), () => toast(t('The clipboard is not available.', 'Pano kullanılamıyor.'), 'err'));
  },
  dlFile(el) {
    const txt = el.dataset.file === CFA.data ? buildCfa().data.text() : sheetText(el.dataset.file);
    if (txt != null) download(el.dataset.file, txt);
  },
  editFile(el) { S.ui.editing = el.dataset.file; render(); setTimeout(() => { const ta = $('#codeEdit'); if (ta) ta.focus(); }, 30); },
  cancelEdit() { S.ui.editing = null; render(); },
  saveEdit() {
    const ta = $('#codeEdit');
    if (!ta) return;
    const built = buildCfa();
    if (ta.value === built.input.generated) delete S.P.edits.cfa; else S.P.edits.cfa = ta.value;
    S.ui.editing = null;
    save();
    render();
    toast(S.P.edits.cfa != null ? t('Saved. Runs now use your edited file.', 'Kaydedildi. Çalıştırmalar artık düzenlediğiniz dosyayı kullanır.') : t('No changes to the generated file.', 'Üretilen dosyada değişiklik yok.'));
  },
  resetEdit() { delete S.P.edits.cfa; save(); render(); toast(t('Back to the generated file.', 'Üretilen dosyaya dönüldü.')); },
  print() { window.print(); },
  dlReport() {
    const art = $('#report').cloneNode(true);
    art.querySelectorAll('.np, .ms-sec.is-pending').forEach((x) => x.remove());
    art.querySelectorAll('.ms-sec').forEach((x) => x.classList.remove('ms-fresh', 'is-focus'));
    art.querySelectorAll('[data-tip], [tabindex]').forEach((x) => { x.removeAttribute('data-tip'); x.removeAttribute('tabindex'); });
    const css = [...document.querySelectorAll('style')].map((x) => x.textContent).join('\n');
    const html = `<!doctype html><html lang="${S.ui.paperLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${S.P ? esc(S.P.name) + ' — ' : ''}${APP}</title><link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=Familjen+Grotesk:wght@400;600&display=swap" rel="stylesheet"><style>${css}html,body{height:auto;overflow:visible;display:block;background:#fff}body::before{display:none}.paper-sheet{max-width:860px;margin:24px auto;box-shadow:none}</style></head><body>${art.outerHTML}</body></html>`;
    download(`${S.P ? S.P.id : 'dfi'}_${S.ui.paperLang === 'tr' ? 'rapor' : 'report'}.html`, html, 'text/html');
  },
  projects() { openProjectsDialog(); },
};

async function openProjectsDialog() {
  try { S.projects = await api('/projects'); } catch { /* keep the old list */ }
  const d = $('#dlg');
  d.onclose = null;
  d.innerHTML = `<div class="p-6"><div class="flex items-center justify-between mb-4"><h2 class="h2">${t('Projects', 'Projeler')}</h2><button class="btn btn-ghost icon-btn" data-dlg-close aria-label="${t('Close', 'Kapat')}">${icon('x')}</button></div>
    <div class="grid gap-1 mb-5" style="max-height:300px;overflow:auto">${S.projects.length ? S.projects.map((p) => `<button class="step" data-open-project="${esc(p.id)}" ${S.P && S.P.id === p.id ? 'aria-current="page"' : ''}><span class="step-n">${icon('folder', 14)}</span><span>${esc(p.name)}<span class="step-meta mono">${esc(projectPath(p.id))}</span></span></button>`).join('') : `<p class="small muted">${t('No projects yet.', 'Henüz proje yok.')}</p>`}</div>
    <form id="newProj" class="flex gap-2"><input class="input" name="name" placeholder="${t('New project name', 'Yeni proje adı')}" required aria-label="${t('New project name', 'Yeni proje adı')}"><button class="btn btn-primary">${icon('plus', 16)}${t('Create', 'Oluştur')}</button></form>
    <p class="hint mt-3">${t('Each project is a folder on this computer (the path is shown under its name); the data, the run files and the outputs are kept there.', 'Her proje bu bilgisayarda bir klasördür (yolu adının altında yazar); veri, çalıştırma dosyaları ve çıktılar orada saklanır.')}</p></div>`;
  d.showModal();
  d.onclick = async (e) => {
    if (e.target.closest('[data-dlg-close]') || e.target === d) { d.close(); return; }
    const b = e.target.closest('[data-open-project]');
    if (b) { d.close(); S.route = { page: 'data' }; try { await openProject(b.dataset.openProject); } catch (err) { toast(err.message, 'err'); } }
  };
  $('#newProj', d).onsubmit = async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('name') || '').trim();
    if (!name) return;
    d.close();
    S.route = { page: 'data' };
    try { await createProject(name); } catch (err) { toast(err.message, 'err'); }
  };
}

// A redraw caused by a field change waits until the pointer is released (a synchronous redraw swallowed clicks)
let ptrDown = false;
function commitRender() {
  S.commitPending = true;
  if (!ptrDown) setTimeout(() => { if (S.commitPending) render(); }, 0);
}
function bindVar(el, commit) {
  const v = S.P && S.P.vars[el.dataset.var];
  if (!v) return;
  v[el.dataset.field] = el.dataset.field === 'mplus' ? el.value.trim() : el.value;
  if (el.dataset.field === 'labelEn') v.labelTr = el.value;
  save();
  if (commit) commitRender();
}
function bindFactor(el, commit) {
  const P = S.P;
  if (!P) return;
  const f = el.dataset.fac === 'second' ? P.model.second : P.model.factors[Number(el.dataset.fac)];
  if (!f) return;
  f[el.dataset.field] = el.dataset.field === 'name' ? el.value.trim() : el.value;
  save();
  if (commit) commitRender();
}
function bindField(el, commit) {
  const P = S.P;
  if (!P) return;
  const b = el.dataset.bind;
  if (b === 'missingCodes') { S.ui.missingDraft = el.value; return; }
  if (b === 'manualText') { S.ui.manualDraft = el.value; if (commit) commitRender(); return; }
  if (b === 'manualN') { P.source.n = el.value.trim() === '' ? null : Number(el.value); invalidate(); save(); if (commit) commitRender(); return; }
  const fk = { fitCfi: 'cfi', fitRmsea: 'rmsea', fitSrmr: 'srmr' }[b];
  if (fk) { P.source.fit[fk] = el.value.trim(); invalidate(); save(); if (commit) commitRender(); return; }
  if (b === 'secondOn') { P.model.second.on = el.checked; save(); commitRender(); }
  if (b === 'manualNoMeans') { P.source.noMeans = el.checked; invalidate(); save(); commitRender(); }
}
function bindGlobal() {
  document.addEventListener('pointerdown', () => { ptrDown = true; }, true);
  const ptrEnd = () => { ptrDown = false; if (S.commitPending) setTimeout(() => { if (S.commitPending) render(); }, 0); };
  document.addEventListener('pointerup', ptrEnd, true);
  document.addEventListener('pointercancel', ptrEnd, true);
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !S.ui.sheet || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    const ta = $('#codeEdit');
    if (S.ui.editing && ta && ta.value !== buildCfa().input.text) { toast(t('Save or cancel your edit first.', 'Önce düzenlemeyi kaydedin ya da vazgeçin.')); return; }
    ACT.closeSheet();
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-var]')) bindVar(e.target, true);
    else if (e.target.matches('[data-fac]')) bindFactor(e.target, true);
    else if (e.target.matches('[data-bind]')) bindField(e.target, true);
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-var]')) bindVar(e.target, false);
    else if (e.target.matches('[data-fac]')) bindFactor(e.target, false);
    else if (e.target.matches('[data-bind]') && e.target.type !== 'checkbox') bindField(e.target, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-bind="missingCodes"]')) { e.preventDefault(); ACT.applyMissing(); }
  });
  $('#fileData').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (S.P && S.P.source.mode && !(await confirmDlg(t('Replace the source?', 'Kaynak değiştirilsin mi?'), t('The new file replaces the data or model, the structure and the results of this project.', 'Yeni dosya bu projenin verisini ya da modelini, yapısını ve sonuçlarını değiştirir.'), t('Replace', 'Değiştir'), true))) return;
    loadDataText(await f.text(), f.name);
  });
  $('#fileOut').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (S.P && S.P.source.mode && !(await confirmDlg(t('Replace the source?', 'Kaynak değiştirilsin mi?'), t('The output replaces the data or model, the structure and the results of this project.', 'Çıktı bu projenin verisini ya da modelini, yapısını ve sonuçlarını değiştirir.'), t('Replace', 'Değiştir'), true))) return;
    const buf = await f.arrayBuffer();
    loadOutText(new TextDecoder('latin1').decode(buf), f.name);
  });
  // drag and drop (CSV, or an Mplus .out)
  document.addEventListener('dragover', (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { const z = e.target.closest('[data-drop]'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', async (e) => {
    const z = e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (/\.out$/i.test(f.name)) loadOutText(new TextDecoder('latin1').decode(await f.arrayBuffer()), f.name);
    else loadDataText(await f.text(), f.name);
  });
  // tooltip
  const tip = $('#tip');
  const place = (x, y) => { const r = tip.getBoundingClientRect(); let lx = x + 14, ty = y + 14; if (lx + r.width > innerWidth - 8) lx = x - r.width - 14; if (ty + r.height > innerHeight - 8) ty = y - r.height - 14; tip.style.left = lx + 'px'; tip.style.top = ty + 'px'; };
  const show = (el, x, y) => { tip.textContent = el.getAttribute('data-tip'); tip.classList.add('on'); place(x, y); };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el.getAttribute('data-tip')) { show(el, e.clientX, e.clientY); return; }
    tip.classList.remove('on');
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el.getAttribute('data-tip') && e.target.matches(':focus-visible')) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.bottom); } });
  document.addEventListener('focusout', () => tip.classList.remove('on'));
  window.addEventListener('hashchange', () => { const prev = S.route.page; routeFromHash(); if (S.route.page !== prev) { S.ui.pane = 'ctrl'; render(); scrollCtrlTop(); } });
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const c = $('#ctrl'), w = c ? c.clientWidth : 0, ae = document.activeElement;
      const typing = ae && $('#work').contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
      if (typing || Math.abs(w - (S.ui.ctrlW || 0)) < 24) { afterRender(); return; }
      render();
    }, 220);
  });
  document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.matches && d.matches('details[data-key]')) S.ui.openDetails[d.dataset.key] = d.open; }, true);
  // file tabs of the code sheet: a vertical mouse wheel scrolls the row sideways; the faded edges follow the scroll
  $('#codeSheet').addEventListener('wheel', (e) => { // on the sheet only: page scrolling elsewhere stays passive
    const row = e.target.closest && e.target.closest('.sh-files');
    if (!row || e.ctrlKey || row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    e.preventDefault();
    row.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
  }, { passive: false });
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('sh-files')) tabFades(e.target); }, true);
}
function routeFromHash(h = location.hash) {
  const p = String(h || '').replace(/^#\/?/, '').split('/')[0];
  if (PAGES.includes(p)) S.route = { page: p };
}
// After a lost connection the server replays only queued and running jobs: ask for the others, and notice
// a job the server no longer knows (it was restarted while the job ran)
async function syncJobs() {
  if (!S.P) return;
  let list;
  try { list = await api('/jobs'); } catch { return; }
  const files = [CFA.input, ...((S.P.runs.dfi && S.P.runs.dfi.files) || [])];
  for (const f of files) {
    if (!S.P) return;
    const cur = S.jobs.get(f);
    const mine = list.filter((j) => j.project === S.P.id && j.file === f).sort((a, b) => (b.created || 0) - (a.created || 0));
    const same = cur && mine.find((j) => j.id === cur.id);
    if (same) onJob(same);
    else if (mine[0] && (!cur || (mine[0].created || 0) > (cur.created || 0))) onJob(mine[0]);
    else if (isActive(cur)) {
      const lost = { ...cur, status: 'error', ended: Date.now(), error: t('The server was restarted while this run was in progress, so the run was lost. Run it again.', 'Bu çalıştırma sürerken sunucu yeniden başlatıldı; çalıştırma yarıda kaldı. Yeniden çalıştırın.') };
      S.jobs.set(f, lost);
      jobFinished(lost);
    }
  }
}
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('job', (ev) => { try { onJob(JSON.parse(ev.data)); } catch (e) { console.warn(e); } });
  es.addEventListener('open', () => { syncJobs(); });
  es.onerror = () => { /* the browser reconnects */ };
  setInterval(() => { document.querySelectorAll('[data-since]').forEach((x) => { x.textContent = clock(Date.now() - Number(x.dataset.since)); }); }, 1000);
}

// The web version: the first window offers the Windows app; once the app runs on this computer (it opens its own tab
// when it starts), the window links to it. The web version itself keeps no projects and runs nothing.
let connecting = null;
function connectDlg() {
  if (connecting) return connecting;
  connecting = new Promise((resolve) => {
    const d = $('#dlg');
    d.onclose = null;
    const li = (n, s) => `<li class="flex gap-3"><span class="step-n">${n}</span><span>${s}</span></li>`;
    const head = (title) => `<div class="flex items-start justify-between gap-3 mb-2"><h2 class="h2">${title}</h2><button class="btn btn-ghost icon-btn" data-dlg-close aria-label="${t('Close', 'Kapat')}">${icon('x')}</button></div>`;
    const offer = () => `<div class="p-6">${head(t('Run Dynamic Fit for Mplus on your computer', 'Dynamic Fit for Mplus’ı bilgisayarınızda çalıştırın'))}
      <p class="text-ink-2 small mb-4">${t('The simulations run in Mplus on your own computer, so the analyses are done in the Windows app. Your data never leave your computer.', 'Simülasyonlar kendi bilgisayarınızdaki Mplus’ta çalışır; bu yüzden analizler Windows uygulamasında yapılır. Verileriniz bilgisayarınızdan çıkmaz.')}</p>
      <ol class="grid gap-3 small mb-5">${li(1, t('Download <b>DynamicFitMplus.exe</b> (89 MB). It needs Windows and Mplus 8.x; nothing is installed.', '<b>DynamicFitMplus.exe</b> dosyasını indirin (89 MB). Windows ve Mplus 8.x gerekir; kurulum yapılmaz.'))}${li(2, t('Start it. The file is not signed, so Windows may ask once: <i>More info → Run anyway</i>.', 'Başlatın. Dosya imzasız olduğundan Windows bir kez sorabilir: <i>Ek bilgi → Yine de çalıştır</i>.'))}${li(3, t('The app opens in a new browser tab. Your projects are saved in a <i>projects</i> folder next to the file.', 'Uygulama tarayıcıda yeni bir sekmede açılır. Projeleriniz dosyanın yanındaki <i>projects</i> klasörüne kaydedilir.'))}</ol>
      <div class="flex flex-wrap items-center gap-2"><a class="btn btn-primary" href="${EXE_URL}" download autofocus>${icon('download', 16)}${t('Download for Windows', 'Windows için indir')}</a><button class="btn" data-dlg-retry>${icon('refresh', 16)}${t('It is running', 'Çalışıyor')}</button></div>
      <p class="hint mt-3" id="connState" role="status">${t('Looking for the app on this computer…', 'Uygulama bu bilgisayarda aranıyor…')}</p>
      <p class="hint mt-1">${t('You can close this window to look around; the analyses need the app. An app older than version 1.0.4 is not found from here, but its own tab works.', 'Göz atmak için bu pencereyi kapatabilirsiniz; analizler için uygulama gerekir. 1.0.4’ten eski bir uygulama buradan bulunamaz, ama kendi sekmesi çalışır.')}</p></div>`;
    const found = (p) => `<div class="p-6">${head(t('The app is running on this computer', 'Uygulama bu bilgisayarda çalışıyor'))}
      <p class="text-ink-2 small mb-5">${t('Dynamic Fit for Mplus is running and has its own tab. Continue there, or open it in this tab.', 'Dynamic Fit for Mplus çalışıyor ve kendi sekmesinde açık. Orada devam edin ya da bu sekmede açın.')}</p>
      <div class="flex flex-wrap items-center gap-2"><a class="btn btn-primary" href="http://localhost:${p}/" autofocus>${icon('arrow', 16)}${t('Open the app', 'Uygulamayı aç')}</a></div>
      <p class="hint mt-3 mono">http://localhost:${p}/</p></div>`;
    let stop = false, timer = null;
    const done = () => { if (stop) return; stop = true; clearInterval(timer); if (d.open) d.close(); connecting = null; resolve(); };
    const tryNow = async (first = false) => {
      const p = await findRunner();
      if (stop) return;
      if (p) { clearInterval(timer); d.innerHTML = found(p); return; }
      if (first) return;
      const s = $('#connState', d);
      if (s) s.textContent = t('Not running yet; checking every few seconds.', 'Henüz çalışmıyor; birkaç saniyede bir yeniden bakılıyor.');
    };
    d.innerHTML = offer();
    d.showModal();
    tryNow(true);
    timer = setInterval(() => tryNow(), 3000);
    d.oncancel = () => done(); // Escape
    d.onclick = (e) => {
      if (e.target.closest('[data-dlg-close]') || e.target === d) done();
      else if (e.target.closest('[data-dlg-retry]')) tryNow();
    };
  });
  return connecting;
}

let initialHash = '';
async function init() {
  bindGlobal();
  initialHash = location.hash;
  routeFromHash();
  if (initialHash) history.replaceState(null, '', initialHash);
  if (HOSTED) { S.health = { engines: {}, offline: true }; render(); connectDlg(); return; } // the web version
  render();
  api('/health').then((h) => { S.health = h; }, () => { S.health = { engines: {}, offline: true }; }).then(() => render());
  connectEvents();
  try {
    S.projects = await api('/projects');
    const last = store.get('aa.last');
    const pick = S.projects.find((p) => p.id === last) || S.projects[0];
    if (pick) { await openProject(pick.id); routeFromHash(initialHash); }
  } catch (e) { toast(e.message, 'err'); }
  render();
}
init();
