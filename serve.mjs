// Dynamic Fit for Mplus — local server (zero dependencies, Node 18+).
// Serves the interface (public/ at "/", data/ at "/data/"), a small JSON API for projects and their files,
// runs Mplus / R jobs (queue, 2 at a time) and streams every job change as Server-Sent Events.
//   node serve.mjs              → http://localhost:3401 (next free port, up to +20, if busy)
//   node serve.mjs --open       → also opens the browser
// Environment: PORT, PROJECTS_DIR (default ./projects), MPLUS_PATH (Mplus.exe), RSCRIPT_PATH (Rscript.exe),
//              WEB_ORIGINS (web pages that may ask whether the app is running; default the published web version;
//              "none" turns this off)
// Only this computer can connect: the server listens on the loopback address and refuses requests that
// come from other host names or other web sites. The one exception: the published web version of the app may
// ask GET /api/health whether the app is running (it then offers a link to it); it gets the name, version and
// port, nothing else, and cannot read or change projects or run anything.
import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectMplus, detectR, runEngine, outputsFor, ENGINE_IDS } from './engines.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Set by the single-file Windows build (tools/build-exe.mjs): embedded interface files; projects/ next to the .exe
const SEA = globalThis.__SEA__ || null;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PROJECTS = path.resolve(process.env.PROJECTS_DIR || path.join(ROOT, 'projects'));
const PREFERRED_PORT = Number.parseInt(process.env.PORT, 10) || 3401;
const PORT_SPAN = 20;
const CONCURRENCY = 2;
const JSON_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 100 * 1024 * 1024;
const MAX_JOBS = 200;
const TAIL_LINES = 40;
const ALL_ENGINES = ['mplus', 'r', 'webr'];
const APP_VERSION = '1.0.4';
// web pages (exact origins) that may ask whether the app is running: the published web version of the app
const WEB_ORIGINS = new Set(String(process.env.WEB_ORIGINS ?? 'https://cahitgs.github.io').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none'));
let PORT = PREFERRED_PORT;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.inp': 'text/plain; charset=utf-8', '.out': 'text/plain; charset=utf-8', '.dat': 'text/plain; charset=utf-8',
  '.r': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
};
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const FILE_EXT = new Set(['.inp', '.out', '.dat', '.csv', '.json', '.txt', '.r', '.log']); // compared in lower case (.R and .r)
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i; // reserved Windows names
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_EXT = { mplus: '.inp', r: '.r' };

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// ---------- responses ----------
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(payload);
}
function sendError(res, status, code, message, extraHeaders = {}) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(JSON.stringify({ error: message, code }));
}

async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'TOO_LARGE', `The request body is too large (limit ${Math.round(limit / 1048576)} MB).`);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'TOO_LARGE', `The request body is too large (limit ${Math.round(limit / 1048576)} MB).`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readJson(req, { optional = false } = {}) {
  const buf = await readBody(req, JSON_LIMIT);
  const txt = buf.toString('utf8').replace(/^\u{FEFF}/u, '');
  if (!txt.trim()) {
    if (optional) return {};
    throw new HttpError(400, 'BAD_JSON', 'The request body is empty; a JSON object is expected.');
  }
  let v;
  try { v = JSON.parse(txt); } catch { throw new HttpError(400, 'BAD_JSON', 'The request body is not valid JSON.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'BAD_JSON', 'A JSON object is expected.');
  return v;
}

// Writes via a temporary file + rename, so readers never see half a file.
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, data);
  for (let i = 0; i < 5; i++) {
    try { await fs.rename(tmp, file); return; } catch (e) {
      if (i === 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) break;
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
  await fs.rm(tmp, { force: true }).catch(() => {});
  await fs.writeFile(file, data); // the target is locked by another program: plain write
}

// ---------- validation ----------
function checkId(id) {
  if (!ID_RE.test(String(id || ''))) throw new HttpError(400, 'BAD_ID', 'Invalid project id.');
  return id;
}
function checkFile(name) {
  const n = String(name || '');
  if (!FILE_RE.test(n) || !FILE_EXT.has(path.extname(n).toLowerCase()) || DEVICE_NAME.test(n)) {
    throw new HttpError(400, 'BAD_NAME', 'Invalid file name. Use letters, digits, "_", "." and "-" (at most 80 characters) with one of the extensions .inp .out .dat .csv .json .txt .R .log.');
  }
  if (n.toLowerCase() === 'project.json') throw new HttpError(400, 'RESERVED_NAME', 'project.json is managed through /api/projects/:id.');
  return n;
}
// Splits the raw request path into decoded segments; refuses dot segments, encoded slashes and other tricks.
function splitPath(rawPath) {
  let p = rawPath;
  if (!p.startsWith('/')) {
    try { p = new URL(p).pathname; } catch { throw new HttpError(400, 'BAD_PATH', 'Invalid path.'); }
  }
  return p.split('/').slice(1).map((s) => {
    let d;
    try { d = decodeURIComponent(s); } catch { throw new HttpError(400, 'BAD_PATH', 'Invalid path encoding.'); }
    if (d === '.' || d === '..' || /[\\/\0:]/.test(d)) throw new HttpError(400, 'BAD_PATH', 'Invalid path.');
    return d;
  });
}
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const m = host.match(/^(\[[0-9a-f:.]+\]|[^:]+)(?::\d+)?$/);
  return !!m && LOOPBACK.has(m[1]);
}
// The web version's origin when the request comes from it, else null (it may only read GET /api/health).
const webOrigin = (req) => (typeof req.headers.origin === 'string' && WEB_ORIGINS.has(req.headers.origin) ? req.headers.origin : null);
// State-changing requests must come from this app's own pages (or from a non-browser client).
function originAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const u = new URL(origin);
    return LOOPBACK.has(u.hostname) && Number(u.port || 80) === PORT;
  } catch { return false; }
}

// ---------- projects ----------
function slug(s) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  const t = String(s || '').replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c]).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'project';
}
async function readProject(dir) {
  const txt = await fs.readFile(path.join(dir, 'project.json'), 'utf8').catch(() => null);
  if (txt === null) return null;
  try { return JSON.parse(txt.replace(/^\u{FEFF}/u, '')); } catch { throw new HttpError(500, 'BAD_PROJECT_FILE', 'project.json of this project is not valid JSON.'); }
}
async function projectDir(id) {
  const dir = path.join(PROJECTS, checkId(id));
  if (!fss.existsSync(path.join(dir, 'project.json'))) throw new HttpError(404, 'NO_PROJECT', `Project not found: ${id}`);
  return dir;
}
async function listProjects() {
  await fs.mkdir(PROJECTS, { recursive: true });
  const list = [];
  for (const d of await fs.readdir(PROJECTS, { withFileTypes: true })) {
    if (!d.isDirectory() || !ID_RE.test(d.name)) continue;
    const pj = await readProject(path.join(PROJECTS, d.name)).catch(() => null);
    if (pj) list.push({ id: d.name, name: typeof pj.name === 'string' && pj.name ? pj.name : d.name, updated: pj.updated || pj.created || null });
  }
  list.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  return list;
}
async function createProject(body) {
  await fs.mkdir(PROJECTS, { recursive: true });
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled project';
  const base = slug(name);
  let id = base;
  for (let n = 2; fss.existsSync(path.join(PROJECTS, id)); n++) id = `${base}-${n}`;
  for (const [jid, j] of jobs) if (j.project === id && !isActive(j)) jobs.delete(jid); // jobs of an older folder with this id
  const now = new Date().toISOString();
  const engine = ALL_ENGINES.includes(body.engine) ? body.engine : null;
  const pj = {
    id, name, created: now, updated: now,
    data: { file: 'data.csv', name: null, missingCodes: ['-999'] },
    roles: { dv: null, ivs: [], id: null },
    vars: {},
    design: { engine, estimator: 'ML' },
    runs: {},
  };
  await fs.mkdir(path.join(PROJECTS, id), { recursive: true });
  await writeAtomic(path.join(PROJECTS, id, 'project.json'), JSON.stringify(pj, null, 2));
  return pj;
}
async function saveProject(id, dir, body) {
  const cur = (await readProject(dir).catch(() => null)) || {};
  const now = new Date().toISOString();
  const next = { ...body, id, created: cur.created || body.created || now, updated: now };
  await writeAtomic(path.join(dir, 'project.json'), JSON.stringify(next, null, 2));
  return { ok: true, updated: now };
}
async function listFiles(dir) {
  const files = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (!d.isFile() || !FILE_RE.test(d.name) || !FILE_EXT.has(path.extname(d.name).toLowerCase())) continue;
    if (d.name.toLowerCase() === 'project.json') continue;
    const st = await fs.stat(path.join(dir, d.name)).catch(() => null);
    if (st) files.push({ name: d.name, size: st.size, mtime: Math.round(st.mtimeMs) });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- jobs ----------
const jobs = new Map(); // id → job (insertion order = creation order)
const queue = [];
let running = 0;
let jobSeq = 0;
const clients = new Set();
const isActive = (j) => j.status === 'queued' || j.status === 'running';

function publicJob(j) {
  return {
    id: j.id, project: j.project, engine: j.engine, file: j.file, outFile: j.outFile, logFile: j.logFile,
    status: j.status, exitCode: j.exitCode, created: j.created, started: j.started, ended: j.ended,
    logTail: j.logTail.slice(-TAIL_LINES), error: j.error, outExists: j.outExists,
  };
}
function sseFrame(event, data) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function emitJob(j, { throttle = false } = {}) {
  const now = Date.now();
  if (throttle && now - (j._emitted || 0) < 500) {
    if (!j._timer) j._timer = setTimeout(() => { j._timer = null; emitJob(j); }, 500 - (now - (j._emitted || 0)));
    return;
  }
  if (j._timer) { clearTimeout(j._timer); j._timer = null; }
  j._emitted = now;
  broadcast(sseFrame('job', publicJob(j)));
}
function trimJobs() {
  if (jobs.size <= MAX_JOBS) return;
  for (const [id, j] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (!isActive(j)) jobs.delete(id);
  }
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const j = queue.shift();
    if (j.status === 'queued') startJob(j);
  }
}

// First "*** ERROR" of an Mplus output → "Mplus error in the MODEL command: Unknown variable(s) …"
function mplusFirstError(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const i = lines.findIndex((l) => /^\*\*\* ERROR/.test(l));
  if (i < 0) return '';
  const where = (lines[i].match(/^\*\*\* ERROR in (\w+) command/) || [])[1];
  const msg = [lines[i].replace(/^\*\*\* ERROR( in \w+ command)?/, '').trim()];
  for (let k = i + 1; k < lines.length && /^\s+\S/.test(lines[k]); k++) msg.push(lines[k].trim());
  const body = msg.filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return `Mplus error${where ? ` in the ${where} command` : ''}: ${body}`;
}
// First error line of an R log → "R error: <message>"
function rFirstError(lines) {
  const i = lines.findIndex((l) => /^(ERROR: |Error\b|Hata|Fehler)/.test(l));
  if (i < 0) return '';
  let msg = /:\s*$/.test(lines[i]) && lines[i + 1] ? `${lines[i]} ${lines[i + 1].trim()}` : lines[i];
  msg = msg.replace(/^(ERROR: |(Error|Hata|Fehler)( in [^:]*?)?\s*:\s*)/, '').trim();
  return `R error: ${msg}`;
}
async function failureMessage(j, dir, res) {
  if (j.engine === 'mplus') {
    if (res.outExists) {
      const out = await fs.readFile(path.join(dir, j.outFile), 'latin1').catch(() => '');
      const first = mplusFirstError(out);
      if (first) return first;
      if (res.exitCode !== 0) return `Mplus exited with code ${res.exitCode}. See ${j.outFile}.`;
    }
    return res.exitCode === 0 ? `Mplus did not write ${j.outFile}.` : `Mplus exited with code ${res.exitCode} without writing ${j.outFile}.`;
  }
  const first = rFirstError(res.logTail);
  if (res.exitCode !== 0) return first || `R exited with code ${res.exitCode}. See ${j.logFile}.`;
  return `R did not write ${j.outFile}. See ${j.logFile}.`;
}

async function startJob(j) {
  running++;
  j.status = 'running';
  j.started = Date.now();
  emitJob(j);
  let dir;
  try {
    dir = await projectDir(j.project);
    const res = await runEngine({
      engine: j.engine, dir, file: j.file, signal: j.ctrl.signal,
      onStart: ({ pid }) => { j.pid = pid; },
      onLog: (line) => {
        j.logTail.push(line);
        if (j.logTail.length > TAIL_LINES) j.logTail.shift();
        emitJob(j, { throttle: true });
      },
    });
    j.logTail = res.logTail.slice(-TAIL_LINES);
    j.exitCode = res.exitCode;
    j.outExists = res.outExists;
    if (res.aborted || j.ctrl.signal.aborted) finish(j, 'cancelled');
    else if (res.exitCode === 0 && res.outExists) finish(j, 'done');
    else finish(j, 'error', await failureMessage(j, dir, res));
  } catch (e) {
    finish(j, j.ctrl.signal.aborted ? 'cancelled' : 'error', String(e.message || e));
  }
}
function finish(j, status, error = null) {
  if (j.ended) return;
  j.status = status;
  j.ended = Date.now();
  if (error) j.error = error;
  j.pid = null;
  if (j.started) running = Math.max(0, running - 1);
  emitJob(j);
  pump();
}
function cancelJob(j) {
  if (j.status === 'queued') {
    const i = queue.indexOf(j);
    if (i >= 0) queue.splice(i, 1);
    j.status = 'cancelled';
    j.ended = Date.now();
    emitJob(j);
    return { ok: true, status: j.status };
  }
  if (j.status === 'running') {
    j.ctrl.abort(); // runEngine kills the process tree; the job ends as "cancelled"
    return { ok: true, status: 'running' };
  }
  return { ok: false, status: j.status };
}
async function queueRun(id, dir, body) {
  const engine = String(body.engine || '');
  if (engine === 'webr') throw new HttpError(400, 'BAD_ENGINE', 'webR runs in the browser; the server only runs "mplus" and "r".');
  if (!ENGINE_IDS.includes(engine)) throw new HttpError(400, 'BAD_ENGINE', 'Unknown engine. Use "mplus" or "r".');
  // only the engines the interface uses (ENGINES in app.js; this app: Mplus only), so that R scripts cannot be run
  const usable = appEngines();
  if (usable && !usable.includes(engine)) throw new HttpError(403, 'ENGINE_OFF', `This app does not run ${engine === 'r' ? 'R' : engine}.`);
  const file = checkFile(body.file);
  if (path.extname(file).toLowerCase() !== RUN_EXT[engine]) {
    throw new HttpError(400, 'BAD_FILE_TYPE', engine === 'mplus' ? 'Mplus runs .inp files.' : 'R runs .R files.');
  }
  const { outFile, logFile } = outputsFor(engine, file);
  for (const f of [outFile, logFile]) if (f && !FILE_RE.test(f)) throw new HttpError(400, 'BAD_NAME', 'The file name is too long for its output file names.');
  if (!fss.existsSync(path.join(dir, file))) throw new HttpError(404, 'NO_FILE', `File not found: ${file}`);
  const info = engine === 'mplus' ? await detectMplus() : await detectR();
  if (!info.ok) throw new HttpError(409, 'ENGINE_MISSING', info.error || `${engine === 'mplus' ? 'Mplus' : 'R'} is not available.`);
  const dup = [...jobs.values()].find((x) => x.project === id && x.engine === engine && x.file === file && isActive(x));
  if (dup) return { jobId: dup.id, duplicate: true };
  const j = {
    id: `j${Date.now().toString(36)}${(++jobSeq).toString(36)}`, project: id, engine, file, outFile, logFile,
    status: 'queued', exitCode: null, created: Date.now(), started: null, ended: null, logTail: [], error: null,
    outExists: false, ctrl: new AbortController(), pid: null,
  };
  jobs.set(j.id, j);
  queue.push(j);
  trimJobs();
  emitJob(j);
  pump();
  return { jobId: j.id };
}

// ---------- API ----------
function only(method, ...allowed) {
  if (!allowed.includes(method) && !(method === 'HEAD' && allowed.includes('GET'))) {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Method ${method} is not allowed here.`);
  }
}
async function health(res, refresh) {
  const [m, r] = await Promise.all([detectMplus({ refresh }), detectR({ refresh })]);
  send(res, 200, {
    engines: {
      mplus: { ok: m.ok, path: m.path, version: m.version, error: m.error, demo: m.demo, asciiWorkaround: m.asciiWorkaround },
      r: { ok: r.ok, path: r.path, version: r.version, jsonlite: r.jsonlite, error: r.error, asciiWorkaround: r.asciiWorkaround },
    },
    cpus: os.cpus().length, port: PORT, platform: process.platform, concurrency: CONCURRENCY, projectsDir: PROJECTS,
    app: 'dynamic-fit-mplus', version: APP_VERSION,
  });
}
function events(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (req.method === 'HEAD') { res.end(); return; }
  res.on('error', () => clients.delete(res));
  req.on('close', () => clients.delete(res));
  res.write('retry: 3000\n\n');
  // a (re)connecting page learns about jobs that are still queued or running; finished ones: GET /api/jobs
  for (const j of jobs.values()) if (isActive(j)) res.write(sseFrame('job', publicJob(j)));
  clients.add(res);
}
function broadcast(frame) {
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

async function api(req, res, parts, query) {
  const method = req.method;
  if (!['GET', 'HEAD'].includes(method) && !originAllowed(req)) throw new HttpError(403, 'BAD_ORIGIN', 'Requests from other web sites are not allowed.');
  const [a, b, c, d] = parts;
  // re-detecting the engines starts Mplus: only this app's own pages may ask for it
  if (a === 'health' && parts.length === 1) { only(method, 'GET'); return health(res, query.get('refresh') === '1' && originAllowed(req)); }
  if (a === 'events' && parts.length === 1) { only(method, 'GET'); return events(req, res); }
  if (a === 'jobs') {
    if (parts.length === 1) { only(method, 'GET'); return send(res, 200, [...jobs.values()].map(publicJob)); }
    const j = jobs.get(b);
    if (!j) throw new HttpError(404, 'NO_JOB', 'Job not found.');
    if (parts.length === 2) { only(method, 'GET'); return send(res, 200, publicJob(j)); }
    if (parts.length === 3 && c === 'cancel') { only(method, 'POST'); return send(res, 200, cancelJob(j)); }
  }
  if (a === 'projects') {
    if (parts.length === 1) {
      only(method, 'GET', 'POST');
      if (method === 'POST') return send(res, 201, await createProject(await readJson(req, { optional: true })));
      return send(res, 200, await listProjects());
    }
    const dir = await projectDir(b);
    if (parts.length === 2) {
      only(method, 'GET', 'PUT');
      if (method === 'PUT') return send(res, 200, await saveProject(b, dir, await readJson(req)));
      return send(res, 200, await fs.readFile(path.join(dir, 'project.json')));
    }
    if (c === 'files' && parts.length === 3) { only(method, 'GET'); return send(res, 200, await listFiles(dir)); }
    if (c === 'files' && parts.length === 4) {
      only(method, 'GET', 'PUT');
      const name = checkFile(d);
      const fp = path.join(dir, name);
      if (method === 'PUT') {
        const buf = await readBody(req, FILE_LIMIT);
        await writeAtomic(fp, buf);
        return send(res, 200, { ok: true, name, size: buf.length });
      }
      const st = await fs.stat(fp).catch(() => null);
      if (!st || !st.isFile()) throw new HttpError(404, 'NO_FILE', `File not found: ${name}`);
      return send(res, 200, await fs.readFile(fp), MIME[path.extname(name).toLowerCase()] || 'text/plain; charset=utf-8');
    }
    if (c === 'run' && parts.length === 3) { only(method, 'POST'); return send(res, 202, await queueRun(b, dir, await readJson(req))); }
  }
  throw new HttpError(404, 'UNKNOWN_ENDPOINT', `Unknown API endpoint: ${method} /api/${parts.join('/')}`);
}

// ---------- static files ----------
async function serveStatic(req, res, segs) {
  only(req.method, 'GET');
  let base = PUBLIC;
  let rel = segs;
  if (segs[0] === 'data' && segs.length > 1) { base = DATA; rel = segs.slice(1); }
  if (rel.every((s) => s === '')) rel = ['index.html'];
  if (rel.some((s) => s.startsWith('.'))) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  const file = path.join(base, ...rel);
  const r = path.relative(base, file);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new HttpError(403, 'FORBIDDEN', 'Forbidden.');
  if (SEA) {
    // single-file build (tools/build-exe.mjs): the interface is embedded in the executable
    const get = SEA.assets.get(`${base === DATA ? 'data' : 'public'}/${r.split(path.sep).join('/')}`);
    if (!get) throw new HttpError(404, 'NOT_FOUND', `Not found: /${segs.join('/')}`);
    return send(res, 200, get(), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  }
  const st = await fs.stat(file).catch(() => null);
  if (!st || !st.isFile()) throw new HttpError(404, 'NOT_FOUND', `Not found: /${segs.join('/')}`);
  send(res, 200, await fs.readFile(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
}

async function handler(req, res) {
  try {
    if (!hostAllowed(req)) throw new HttpError(403, 'BAD_HOST', 'Use http://localhost or http://127.0.0.1 to open Dynamic Fit for Mplus.');
    const q = req.url.indexOf('?');
    const rawPath = q >= 0 ? req.url.slice(0, q) : req.url;
    const query = new URLSearchParams(q >= 0 ? req.url.slice(q + 1) : '');
    const segs = splitPath(rawPath);
    if (segs[0] === 'api') {
      const rest = segs.slice(1).filter((s) => s !== '');
      // the web version (another origin) may only learn whether the app runs here, and on which port; this answer and
      // its preflight (Chrome's check for pages that call a server on this computer) are all it can read
      const wo = webOrigin(req);
      if (wo && rest.length === 1 && rest[0] === 'health') {
        res.setHeader('Access-Control-Allow-Origin', wo);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          const h = { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' };
          if (req.headers['access-control-request-private-network'] === 'true') h['Access-Control-Allow-Private-Network'] = 'true';
          res.writeHead(204, h);
          return res.end();
        }
        only(req.method, 'GET');
        return send(res, 200, { app: 'dynamic-fit-mplus', version: APP_VERSION, port: PORT });
      }
      return await api(req, res, rest, query);
    }
    return await serveStatic(req, res, segs);
  } catch (e) {
    if (e instanceof HttpError) {
      return sendError(res, e.status, e.code, e.message, e.status === 413 ? { Connection: 'close' } : {});
    }
    console.error('  Server error:', e);
    return sendError(res, 500, 'INTERNAL', `Internal server error: ${e.message || e}`);
  }
}

// ---------- start ----------
function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', (e) => resolve(!['EADDRINUSE', 'EACCES'].includes(e.code)));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}
function listen(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => { srv.off('error', reject); resolve(srv); });
  });
}
// Engines this app is configured for (const ENGINES = [...] in public/app.js) — for the console messages only
function appEngines() {
  try {
    const src = SEA ? SEA.assets.get('public/app.js')().toString('utf8') : fss.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
    const m = src.match(/const\s+ENGINES\s*=\s*\[([^\]]*)\]/);
    if (m) return [...m[1].matchAll(/['"](\w+)['"]/g)].map((x) => x[1]);
  } catch { /* not there */ }
  return null;
}

await fs.mkdir(PROJECTS, { recursive: true });
let server = null;
for (let p = PREFERRED_PORT; p <= PREFERRED_PORT + PORT_SPAN && !server; p++) {
  if (!(await portFree(p, '0.0.0.0'))) continue;
  try { server = await listen(p); PORT = p; } catch (e) { if (!['EADDRINUSE', 'EACCES'].includes(e.code)) throw e; }
}
if (!server) {
  console.error(`  No free port between ${PREFERRED_PORT} and ${PREFERRED_PORT + PORT_SPAN}. Set another start port with PORT.`);
  process.exit(1);
}
const server6 = http.createServer(handler);
server6.on('error', () => { /* no IPv6 loopback: IPv4 only */ });
server6.listen(PORT, '::1');

const url = `http://localhost:${PORT}`;
console.log(`\n  Dynamic Fit for Mplus → ${url}`);
if (PORT !== PREFERRED_PORT) console.log(`  (port ${PREFERRED_PORT} is in use, so ${PORT} is used)`);
console.log(`  Projects: ${PROJECTS}`);
console.log('  Stop with Ctrl+C\n');
const configured = appEngines();
Promise.all([detectMplus(), detectR()]).then(([m, r]) => {
  const note = (id) => (configured && !configured.includes(id) ? ' (not used by this app)' : '');
  console.log(m.ok ? `  Mplus ${m.version} → ${m.path}${note('mplus')}` : `  Mplus: ${m.error}${note('mplus')}`);
  console.log(r.ok ? `  R ${r.version} → ${r.path} (jsonlite: ${r.jsonlite ? 'yes' : 'no'})${note('r')}` : `  R: ${r.error}${note('r')}`);
  if (configured && configured.includes('webr')) console.log('  webR runs in the browser (needs internet the first time).');
});
setInterval(() => broadcast(': ping\n\n'), 20000).unref();

// the .exe opens the browser by itself (double-click); --no-open turns that off
if (process.argv.includes('--open') || (SEA && !process.argv.includes('--no-open'))) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
}

// Stop running engines (whole process trees) when the server stops
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const j of jobs.values()) if (j.status === 'running') j.ctrl.abort();
  for (const c of clients) c.end();
  server.close();
  server6.close();
  setTimeout(() => process.exit(0), 600).unref();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
