// SVG figures of Dynamic Fit for Mplus, in the article style of the live manuscript:
// black and white by default (serif labels, thin rules), or in color on request. Every function returns an SVG string.
// Plain ES module without DOM access: runs in the browser and in Node.

const FONT = "'Times New Roman', Times, serif";
const UI_FONT = "'Familjen Grotesk', 'Segoe UI', Arial, sans-serif";
const INK = '#111111';
const GREY = '#C9C9C9';
// the two key colors of the interface: navy = the correct model, amber = the misspecification
const NAVY = '#2C5D9E';
const AMBER = '#C98212';
const MINUS = '−';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

// "Nice" axis ticks covering [min, max]
export function niceTicks(min, max, count = 6) {
  if (!fin(min) || !fin(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const e = step0 / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step - 1e-9) * step;
  const hi = Math.ceil(max / step + 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toFixed(10));
  return ticks;
}

// Value without the leading zero (APA style for values that cannot exceed 1): .041, −.29
function noLead(x, d) {
  if (!fin(x)) return '—';
  const s = Math.abs(x).toFixed(d);
  const neg = x < 0 && Number(s) !== 0;
  return (neg ? MINUS : '') + s.replace(/^0\./, '.');
}
const decimalsFor = (step) => Math.min(4, Math.max(2, -Math.floor(Math.log10(step)) + (step / 10 ** Math.floor(Math.log10(step)) < 2 ? 1 : 0)));

const IDX = [['srmr', 'SRMR'], ['rmsea', 'RMSEA'], ['cfi', 'CFI']];
const HB = { srmr: 0.08, rmsea: 0.06, cfi: 0.95 };

/**
 * Distributions of the fit indices: one row per misspecification level, one column per index (SRMR, RMSEA, CFI).
 * Each panel: correct-model replications (grey bars), misspecified-model replications (open bars), the dynamic
 * cutoff (dashed), the Hu & Bentler (1999) cutoff (dotted) and the empirical value (solid line, or an arrow
 * at the edge when it is off the scale). With color = true the correct model is navy and the misspecified model
 * amber, both translucent so that the overlap stays visible; the lines stay black.
 * data = {correct: [{srmr, rmsea, cfi}], levels: [{level, rows: [...], cut: {srmr, rmsea, cfi}}],
 *         empirical: {srmr, rmsea, cfi} | null}
 */
export function dfiChart(data, { width = 680, lang = 'en', color = false } = {}) {
  const tr = lang === 'tr';
  const pal = color
    ? { tFill: NAVY, tOp: 0.55, mFill: AMBER, mOp: 0.55, mStroke: AMBER }
    : { tFill: GREY, tOp: 1, mFill: 'none', mOp: 1, mStroke: INK };
  const tOp = pal.tOp < 1 ? ` fill-opacity="${pal.tOp}"` : '';
  const mFill = pal.mFill === 'none' ? 'fill="none"' : `fill="${pal.mFill}" fill-opacity="${pal.mOp}"`;
  const levels = (data && data.levels) || [];
  const W = Math.max(480, Math.round(width));
  if (!levels.length || !data.correct || !data.correct.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="chart" width="${W}" height="60" viewBox="0 0 ${W} 60" role="img" aria-label="${tr ? 'Veri yok' : 'No data'}"><text x="12" y="34" font-family="${FONT}" font-size="14" fill="${INK}">${tr ? 'Gösterilecek dağılım yok.' : 'No distributions to show.'}</text></svg>`;
  }
  const left = 64, right = 10, top = 58, gapX = 16, rowGap = 50, panelH = 92;
  const pw = (W - left - right - gapX * 2) / 3;
  const H = top + levels.length * (panelH + rowGap) + 6;
  const aria = tr ? 'Doğru ve yanlış belirtilmiş modellerde uyum indekslerinin dağılımları' : 'Distributions of fit indices under the correct and the misspecified models';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" font-family="${FONT}">`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  // legend
  const lg = [
    [`<rect x="0" y="-9" width="14" height="10" fill="${pal.tFill}"${tOp}/>`, tr ? 'Doğru model' : 'Correct model'],
    [`<rect x="0.5" y="-8.5" width="13" height="9" ${pal.mFill === 'none' ? 'fill="#fff"' : mFill} stroke="${pal.mStroke}"/>`, tr ? 'Yanlış belirtilmiş model' : 'Misspecified model'],
    [`<line x1="0" x2="16" y1="-4" y2="-4" stroke="${INK}" stroke-width="1.4" stroke-dasharray="4 3"/>`, tr ? 'Dinamik kesme değeri' : 'Dynamic cutoff'],
    [`<line x1="0" x2="16" y1="-4" y2="-4" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1.2 2.4"/>`, 'Hu &amp; Bentler (1999)'],
    [`<line x1="0" x2="16" y1="-4" y2="-4" stroke="${INK}" stroke-width="2.4"/>`, tr ? 'Ampirik değer' : 'Empirical value'],
  ];
  let lx = left;
  lg.forEach(([g, label]) => {
    s += `<g transform="translate(${lx.toFixed(1)},20)">${g}<text x="${22}" y="0" font-size="12.5" fill="${INK}">${label}</text></g>`;
    lx += 30 + label.replace(/&amp;/g, '&').length * 6.3;
  });
  // column titles
  IDX.forEach(([, lab], c) => {
    const x0 = left + c * (pw + gapX);
    s += `<text x="${(x0 + pw / 2).toFixed(1)}" y="${top - 12}" text-anchor="middle" font-size="14" font-weight="600" fill="${INK}">${lab}</text>`;
  });
  levels.forEach((lv, r) => {
    const y0 = top + r * (panelH + rowGap);
    s += `<text x="${left - 12}" y="${(y0 + panelH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="13.5" fill="${INK}">${tr ? 'Düzey' : 'Level'} ${lv.level}</text>`;
    IDX.forEach(([k], c) => {
      const x0 = left + c * (pw + gapX);
      const t = data.correct.map((x) => x[k]).filter(fin);
      const m = lv.rows.map((x) => x[k]).filter(fin);
      if (!t.length || !m.length) return;
      let lo = Math.min(...t, ...m), hi = Math.max(...t, ...m);
      if (hi - lo < 1e-9) { lo -= 0.001; hi += 0.001; }
      const pad = (hi - lo) * 0.04;
      lo -= pad; hi += pad;
      const bins = 26, bw = (hi - lo) / bins;
      const count = (v) => { const a = new Array(bins).fill(0); v.forEach((x) => { a[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / bw)))]++; }); return a; };
      const ct = count(t), cm = count(m);
      const ymax = Math.max(...ct, ...cm) || 1;
      const px = (v) => x0 + ((v - lo) / (hi - lo)) * pw;
      const py = (n) => y0 + panelH - (n / ymax) * (panelH - 6);
      // correct model: grey (or navy) bars
      ct.forEach((n, i) => { if (n) s += `<rect x="${px(lo + i * bw).toFixed(2)}" y="${py(n).toFixed(2)}" width="${Math.max(0.6, (pw / bins) - 0.4).toFixed(2)}" height="${(y0 + panelH - py(n)).toFixed(2)}" fill="${pal.tFill}"${tOp}/>`; });
      // misspecified: open (or translucent amber) bars as a step outline
      let path = `M${px(lo).toFixed(2)},${(y0 + panelH).toFixed(2)}`;
      cm.forEach((n, i) => { path += ` L${px(lo + i * bw).toFixed(2)},${py(n).toFixed(2)} L${px(lo + (i + 1) * bw).toFixed(2)},${py(n).toFixed(2)}`; });
      path += ` L${px(hi).toFixed(2)},${(y0 + panelH).toFixed(2)}${pal.mFill === 'none' ? '' : ' Z'}`;
      s += `<path d="${path}" ${mFill} stroke="${pal.mStroke}" stroke-width="1"/>`;
      // axis
      s += `<line x1="${x0.toFixed(1)}" x2="${(x0 + pw).toFixed(1)}" y1="${y0 + panelH}" y2="${y0 + panelH}" stroke="${INK}"/>`;
      const ticks = niceTicks(lo, hi, 3).filter((v) => v >= lo - 1e-12 && v <= hi + 1e-12);
      const d = ticks.length > 1 ? decimalsFor(Math.abs(ticks[1] - ticks[0])) : 3;
      ticks.forEach((v) => {
        s += `<line x1="${px(v).toFixed(1)}" x2="${px(v).toFixed(1)}" y1="${y0 + panelH}" y2="${y0 + panelH + 4}" stroke="${INK}"/>`;
        s += `<text x="${px(v).toFixed(1)}" y="${y0 + panelH + 17}" text-anchor="middle" font-size="11.5" fill="${INK}">${noLead(v, d)}</text>`;
      });
      // reference lines
      const vline = (v, dash, w) => (fin(v) && v >= lo && v <= hi ? `<line x1="${px(v).toFixed(1)}" x2="${px(v).toFixed(1)}" y1="${y0}" y2="${y0 + panelH}" stroke="${INK}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` : '');
      s += vline(HB[k], '1.2 2.4', 1.2);
      const cut = lv.cut ? lv.cut[k] : NaN;
      s += vline(cut, '4 3', 1.4);
      const e = data.empirical ? data.empirical[k] : NaN;
      if (fin(e)) {
        if (e >= lo && e <= hi) s += vline(e, '', 2.4);
        else {
          const right = e > hi;
          const ax = right ? x0 + pw : x0;
          s += `<path d="M${ax.toFixed(1)},${(y0 + 6).toFixed(1)} l${right ? -7 : 7},-4 l0,8 z" fill="${INK}"/>`;
          // a white box under the label keeps it readable where it crosses the cutoff lines
          const lab = `${tr ? 'ampirik' : 'empirical'} ${noLead(e, 3)}`;
          const lw = lab.length * 5.9 + 6;
          const lx = right ? ax - 10 - lw + 3 : ax + 10 - 3;
          s += `<rect x="${lx.toFixed(1)}" y="${(y0 - 1).toFixed(1)}" width="${lw.toFixed(1)}" height="14.5" fill="#fff"/>`;
          s += `<text x="${(right ? ax - 10 : ax + 10).toFixed(1)}" y="${(y0 + 10).toFixed(1)}" text-anchor="${right ? 'end' : 'start'}" font-size="11.5" fill="${INK}">${lab}</text>`;
        }
      }
    });
  });
  return s + '</svg>';
}

/**
 * Small distribution sparkline (histogram) for the variable list of the interface.
 * values: number[] (non-finite values are skipped); opts: {width, height, bins, color, aria}
 */
export function sparkline(values, { width = 108, height = 28, bins = 18, color = '#8E97A1', aria = '' } = {}) {
  const v = (values || []).filter(fin);
  if (v.length < 2) return '';
  let min = Infinity, max = -Infinity;
  for (const x of v) { if (x < min) min = x; if (x > max) max = x; }
  const k = min === max ? 1 : bins;
  const counts = new Array(k).fill(0);
  for (const x of v) counts[min === max ? 0 : Math.min(k - 1, Math.floor(((x - min) / (max - min)) * k))]++;
  const top = Math.max(...counts);
  const bw = width / k;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria || 'Distribution')}" font-family="${UI_FONT}">`;
  counts.forEach((c, i) => {
    const h = top ? (c / top) * (height - 2) : 0;
    if (h > 0) s += `<rect x="${(i * bw + 0.5).toFixed(2)}" y="${(height - h).toFixed(2)}" width="${Math.max(0.5, bw - 1).toFixed(2)}" height="${h.toFixed(2)}" rx=".6" fill="${color}"/>`;
  });
  return s + '</svg>';
}
