// Local engine adapters of the Analysis Workbench (server side, zero dependencies).
//   detectMplus()  → {ok, path, version, demo, error, asciiWorkaround}      (cached; {refresh: true} re-checks)
//   detectR()      → {ok, path, version, jsonlite, error, asciiWorkaround}  (cached; {refresh: true} re-checks)
//   runEngine({engine, dir, file, onStart, onLog, signal}) → {exitCode, outFile, logFile, logTail, outExists, aborted, asciiTemp}
// Overrides: MPLUS_PATH (Mplus.exe), RSCRIPT_PATH (Rscript.exe).
//
// Folders with non-ASCII characters: the engines are started with the project folder as working directory
// and only relative, ASCII file names. Detection test-runs each engine in a folder named "Ş ı probe";
// only if that fails on this machine (while an ASCII folder works) runEngine copies the inputs to an ASCII
// temp folder (os.tmpdir()/aa-*), runs there and copies the outputs back — transparently.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StringDecoder } from 'node:string_decoder';

export const ENGINE_IDS = ['mplus', 'r'];
const IS_WIN = process.platform === 'win32';
const TAIL_LINES = 40;

export class EngineError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export const isAscii = (s) => /^[\x20-\x7e]*$/.test(String(s));

function run(cmd, args, { cwd, timeout = 30000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, env: env || process.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, error: err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ---------- ASCII temp root ----------
let tmpRoot = null;
export async function asciiTempRoot() {
  if (tmpRoot) return tmpRoot;
  const cands = [os.tmpdir()];
  if (IS_WIN) cands.push(path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents'), `${process.env.SystemDrive || 'C:'}\\Temp`);
  for (const c of cands) {
    if (!isAscii(c)) continue;
    try {
      await fs.mkdir(c, { recursive: true });
      await fs.access(c, fss.constants.W_OK);
      return (tmpRoot = c);
    } catch { /* next */ }
  }
  return (tmpRoot = os.tmpdir());
}

async function probeDirs() {
  const root = await fs.mkdtemp(path.join(await asciiTempRoot(), 'aa-probe-'));
  const ascii = path.join(root, 'ascii');
  const nonAscii = path.join(root, 'Ş ı probe');
  await fs.mkdir(ascii, { recursive: true });
  await fs.mkdir(nonAscii, { recursive: true });
  return { root, ascii, nonAscii, cleanup: () => fs.rm(root, { recursive: true, force: true }).catch(() => {}) };
}

// ---------- Mplus ----------
function mplusCandidates() {
  const list = [];
  if (IS_WIN) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (base) list.push(path.join(base, 'Mplus', 'Mplus.exe'));
    }
  } else {
    list.push('/Applications/Mplus/mplus', '/opt/mplus/mplus', '/usr/local/bin/mplus');
  }
  return [...new Set(list)];
}

const PROBE_DAT = '1 2\n2 1\n3 4\n4 3\n5 5\n';
const PROBE_INP = 'TITLE: probe;\nDATA: FILE = p.dat;\nVARIABLE: NAMES = a b;\nANALYSIS: TYPE = BASIC;\n';

async function mplusProbe(exe, dir) {
  await fs.writeFile(path.join(dir, 'p.dat'), PROBE_DAT);
  await fs.writeFile(path.join(dir, 'p.inp'), PROBE_INP);
  const res = await run(exe, ['p.inp', 'p.out'], { cwd: dir, timeout: 60000 });
  const out = await fs.readFile(path.join(dir, 'p.out'), 'latin1').catch(() => '');
  const m = out.match(/Mplus VERSION ([\d.]+)( DEMO)?/);
  const err = (out.match(/\*\*\* ERROR[^\n]*\n\s*([^\n]+)/) || [])[1];
  return { ok: !!m && /Elapsed Time/.test(out), version: m ? m[1] : null, demo: !!(m && m[2]), error: err ? err.trim() : res.error ? String(res.error.message || res.error).split('\n')[0] : null };
}

let mplusCache = null;
export function detectMplus({ refresh = false } = {}) {
  if (!mplusCache || refresh) mplusCache = detectMplusNow();
  return mplusCache;
}
async function detectMplusNow() {
  const info = { ok: false, path: null, version: null, demo: false, error: null, asciiWorkaround: false };
  let exe = null;
  if (process.env.MPLUS_PATH) {
    exe = process.env.MPLUS_PATH;
    if (!fss.existsSync(exe)) { info.error = `MPLUS_PATH is set but the file does not exist: ${exe}`; return info; }
  } else {
    exe = mplusCandidates().find((p) => fss.existsSync(p)) || null;
    if (!exe && IS_WIN) {
      const w = await run('where', ['Mplus.exe'], { timeout: 10000 });
      exe = w.stdout.split(/\r?\n/).map((s) => s.trim()).find((p) => p && fss.existsSync(p)) || null;
    }
  }
  if (!exe) { info.error = 'Mplus was not found. Install Mplus or set MPLUS_PATH to the full path of Mplus.exe.'; return info; }
  info.path = exe;
  const dirs = await probeDirs();
  try {
    let p = await mplusProbe(exe, dirs.nonAscii);
    if (!p.ok) {
      const q = await mplusProbe(exe, dirs.ascii);
      if (q.ok) { info.asciiWorkaround = true; p = q; }
    }
    if (p.ok) {
      info.ok = true;
      info.version = p.version + (p.demo ? ' (demo)' : '');
      info.demo = p.demo;
    } else {
      info.error = `Mplus was found but its test run failed (licence or installation problem?)${p.error ? ': ' + p.error : '.'}`;
    }
  } finally {
    await dirs.cleanup();
  }
  return info;
}

// ---------- R ----------
function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}
async function rCandidates() {
  const list = [];
  if (process.env.RSCRIPT_PATH) return [process.env.RSCRIPT_PATH];
  const w = await run(IS_WIN ? 'where' : 'which', [IS_WIN ? 'Rscript.exe' : 'Rscript'], { timeout: 10000 });
  for (const p of w.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) list.push(p);
  if (IS_WIN) {
    const bases = [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files', process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    for (const base of [...new Set(bases)]) {
      const rdir = path.join(base, 'R');
      const entries = await fs.readdir(rdir).catch(() => []);
      const vers = entries.map((e) => ({ e, v: (e.match(/^R-(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number) })).filter((x) => x.v.length === 3);
      vers.sort((a, b) => cmpVersion(b.v, a.v));
      for (const { e } of vers) list.push(path.join(rdir, e, 'bin', 'x64', 'Rscript.exe'), path.join(rdir, e, 'bin', 'Rscript.exe'));
    }
  } else {
    list.push('/usr/local/bin/Rscript', '/usr/bin/Rscript', '/opt/homebrew/bin/Rscript', '/Library/Frameworks/R.framework/Resources/bin/Rscript');
  }
  return [...new Set(list)];
}

const R_ENV = () => ({ ...process.env, LANGUAGE: 'en' }); // English R messages in logs and results

async function rProbe(exe, dir) {
  await fs.writeFile(path.join(dir, 'p.csv'), 'a,b\n1,2\n3,4\n');
  await fs.writeFile(path.join(dir, 'p.R'), 'd <- utils::read.csv("p.csv")\ncat("AA_JSONLITE=", requireNamespace("jsonlite", quietly = TRUE), "\\n", sep = "")\nwriteLines(as.character(nrow(d)), "p.txt")\n');
  const res = await run(exe, ['--vanilla', 'p.R'], { cwd: dir, timeout: 60000, env: R_ENV() });
  const txt = await fs.readFile(path.join(dir, 'p.txt'), 'utf8').catch(() => '');
  const jm = res.stdout.match(/AA_JSONLITE=(TRUE|FALSE)/);
  const errLine = (res.stderr || res.stdout).split(/\r?\n/).map((s) => s.trim()).find((s) => /^(Error|Hata|Fehler)/.test(s));
  return { ok: txt.trim() === '2' && !!jm, jsonlite: jm ? jm[1] === 'TRUE' : null, error: errLine || (res.error ? String(res.error.message || res.error).split('\n')[0] : null) };
}

let rCache = null;
export function detectR({ refresh = false } = {}) {
  if (!rCache || refresh) rCache = detectRNow();
  return rCache;
}
async function detectRNow() {
  const info = { ok: false, path: null, version: null, jsonlite: null, error: null, asciiWorkaround: false };
  if (process.env.RSCRIPT_PATH && !fss.existsSync(process.env.RSCRIPT_PATH)) {
    info.error = `RSCRIPT_PATH is set but the file does not exist: ${process.env.RSCRIPT_PATH}`;
    return info;
  }
  const exe = (await rCandidates()).find((p) => fss.existsSync(p)) || null;
  if (!exe) { info.error = 'R was not found. Install R (https://cran.r-project.org) or set RSCRIPT_PATH to the full path of Rscript.exe.'; return info; }
  info.path = exe;
  const v = await run(exe, ['--version'], { timeout: 30000, env: R_ENV() });
  const vm = (v.stdout + '\n' + v.stderr).match(/version\s+(\d+\.\d+\.\d+)/);
  if (!vm) { info.error = `Rscript was found but did not start${v.error ? ': ' + String(v.error.message || v.error).split('\n')[0] : '.'}`; return info; }
  info.version = vm[1];
  const dirs = await probeDirs();
  try {
    let p = await rProbe(exe, dirs.nonAscii);
    if (!p.ok) {
      const q = await rProbe(exe, dirs.ascii);
      if (q.ok) { info.asciiWorkaround = true; p = q; }
    }
    if (p.ok) { info.ok = true; info.jsonlite = p.jsonlite; }
    else info.error = `R was found but a test script failed${p.error ? ': ' + p.error : '.'}`;
  } finally {
    await dirs.cleanup();
  }
  return info;
}

// ---------- running ----------
const COPY_EXT = new Set(['.inp', '.out', '.dat', '.csv', '.json', '.txt', '.r', '.log']);

async function snapshot(dir) {
  const snap = new Map();
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (!d.isFile()) continue;
    const st = await fs.stat(path.join(dir, d.name));
    snap.set(d.name, `${st.size}:${st.mtimeMs}`);
  }
  return snap;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  }
}

/** Expected output names for an engine and a run file. */
export function outputsFor(engine, file) {
  const base = String(file).replace(/\.[^.]+$/, '');
  if (engine === 'mplus') return { base, outFile: `${base}.out`, logFile: null };
  return { base, outFile: `${base}.json`, logFile: `${base}.log` };
}

/**
 * Runs one engine on one input file inside dir (working directory = dir, relative file names only).
 *   mplus: Mplus.exe <file> <base>.out         r: Rscript --vanilla <file>, stdout + stderr → <base>.log
 * Old outputs are removed first, so outExists means "written by this run".
 * onStart({pid, workDir, asciiTemp}) is called after the process starts; onLog(line) for every output line;
 * signal (AbortSignal) cancels: the whole process tree is killed (taskkill /T /F on Windows).
 * Options: asciiTemp: true forces the ASCII temp-folder mode (normally automatic, see top of file).
 */
export async function runEngine({ engine, dir, file, onStart, onLog, signal, asciiTemp } = {}) {
  if (!ENGINE_IDS.includes(engine)) throw new EngineError(`Unknown engine "${engine}". Use "mplus" or "r".`, 'BAD_ENGINE');
  const info = engine === 'mplus' ? await detectMplus() : await detectR();
  if (!info.ok) throw new EngineError(info.error || `${engine === 'mplus' ? 'Mplus' : 'R'} is not available.`, 'ENGINE_MISSING');
  const { outFile, logFile } = outputsFor(engine, file);
  if (!fss.existsSync(path.join(dir, file))) throw new EngineError(`File not found: ${file}`, 'NO_FILE');
  await fs.rm(path.join(dir, outFile), { force: true });
  if (logFile) await fs.rm(path.join(dir, logFile), { force: true });

  const tail = [];
  const result = { exitCode: null, outFile, logFile, logTail: tail, outExists: false, aborted: false, asciiTemp: false };
  const pushLine = (line) => {
    tail.push(line);
    if (tail.length > TAIL_LINES) tail.shift();
    if (onLog) { try { onLog(line); } catch { /* ignore listener errors */ } }
  };
  if (signal && signal.aborted) { result.aborted = true; return result; }

  const useTemp = asciiTemp === true || (asciiTemp !== false && info.asciiWorkaround && !isAscii(dir));
  let workDir = dir;
  let before = null;
  if (useTemp) {
    workDir = await fs.mkdtemp(path.join(await asciiTempRoot(), 'aa-'));
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      if (d.isFile() && COPY_EXT.has(path.extname(d.name).toLowerCase())) await fs.copyFile(path.join(dir, d.name), path.join(workDir, d.name));
    }
    before = await snapshot(workDir);
    result.asciiTemp = true;
  }

  const log = logFile ? fss.createWriteStream(path.join(dir, logFile)) : null;
  const args = engine === 'mplus' ? [file, outFile] : ['--vanilla', file];
  const env = engine === 'r' ? R_ENV() : process.env;
  const label = engine === 'mplus' ? 'Mplus' : 'Rscript';
  try {
    await new Promise((resolve) => {
      if (signal && signal.aborted) { result.aborted = true; resolve(); return; }
      let child;
      try {
        child = spawn(info.path, args, { cwd: workDir, windowsHide: true, env, detached: !IS_WIN });
      } catch (e) {
        pushLine(`Could not start ${label}: ${e.message || e}`);
        result.exitCode = -1;
        resolve();
        return;
      }
      let settled = false;
      const dec = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
      const buf = { out: '', err: '' };
      const onData = (key) => (chunk) => {
        if (log) log.write(chunk);
        buf[key] += dec[key].write(chunk);
        const parts = buf[key].split(/\r?\n/);
        buf[key] = parts.pop();
        for (const p of parts) if (p.trim()) pushLine(p.trimEnd());
      };
      const onAbort = () => { result.aborted = true; killTree(child); };
      const finish = (code) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        for (const key of ['out', 'err']) { const rest = buf[key] + dec[key].end(); if (rest.trim()) pushLine(rest.trimEnd()); }
        if (result.exitCode === null) result.exitCode = code;
        resolve();
      };
      child.stdout.on('data', onData('out'));
      child.stderr.on('data', onData('err'));
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      child.on('spawn', () => { if (onStart) { try { onStart({ pid: child.pid, workDir, asciiTemp: result.asciiTemp }); } catch { /* ignore */ } } });
      child.on('error', (e) => {
        pushLine(`Could not start ${label}: ${e.message || e}`);
        if (result.exitCode === null) result.exitCode = -1;
        if (child.pid === undefined) finish(-1); // never started: no 'close' guaranteed
      });
      child.on('close', (code) => finish(code));
    });
  } finally {
    if (log) await new Promise((r) => log.end(r));
    if (useTemp) {
      try {
        const after = await snapshot(workDir);
        for (const [name, sig] of after) {
          if (before.get(name) !== sig) await fs.copyFile(path.join(workDir, name), path.join(dir, name));
        }
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  result.outExists = fss.existsSync(path.join(dir, outFile));
  return result;
}
