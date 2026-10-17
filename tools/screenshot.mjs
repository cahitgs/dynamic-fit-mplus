// Screenshot of the running app (always from localhost, never file:///).
//   node tools/screenshot.mjs <url> [label] [width] [height]
//   e.g. node tools/screenshot.mjs http://localhost:3401/#/run run 1440 900
// Output: "temporary screenshots/screenshot-N[-label].png" in the app folder (numbered, never overwritten).
// Chrome: CHROME_PATH, else the system Chrome. Waits SHOT_WAIT ms (default 1500) after the page has loaded.
// Needs puppeteer-core once:  cd tools  →  npm install
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, label = '', width = '1440', height = '900'] = process.argv.slice(2);
if (!url || !/^https?:\/\//.test(url)) {
  console.error('Usage: node tools/screenshot.mjs <url> [label] [width] [height]   (url like http://localhost:3401)');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'temporary screenshots');
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Chrome was not found. Set CHROME_PATH to the full path of chrome.exe.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const used = fs.readdirSync(OUT).map((f) => Number((f.match(/^screenshot-(\d+)/) || [])[1])).filter(Number.isFinite);
const n = (used.length ? Math.max(...used) : 0) + 1;
const safe = String(label).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const file = path.join(OUT, `screenshot-${n}${safe ? `-${safe}` : ''}.png`);

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: Number(width) || 1440, height: Number(height) || 900 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // 'load', never 'networkidle0': the app keeps a Server-Sent Events connection open
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, Number(process.env.SHOT_WAIT) || 1500));
  await page.screenshot({ path: file });
  console.log(file);
  if (errors.length) console.log(`Console errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
}
