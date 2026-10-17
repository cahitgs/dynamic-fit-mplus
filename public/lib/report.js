// APA 7 text, tables and references for the live manuscript of Dynamic Fit for Mplus.
// Every function takes lang = 'en' (default) or 'tr' and returns strings (HTML for paragraphs and tables).
// Plain ES module without DOM access: runs in the browser and in Node.
//
// Results come from lib/dfi.js: the standardized solution (readMplusOut / parseStdModel), the plan of the
// simulation (planDfi) and its summary (summarizeDfi).
import { esc } from './charts.js';

const MINUS = '−';
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const X = (lang, en, tr) => (lang === 'tr' ? tr : en);

// ---------- numbers (APA 7) ----------
/** Number with d decimals and a true minus sign: 0.35, −1.20; '—' when missing. */
export function apaNum(x, d = 2) {
  if (!fin(x)) return '—';
  const s = Math.abs(x).toFixed(d);
  return (x < 0 && Number(s) !== 0 ? MINUS : '') + s;
}
/** Without the leading zero, for statistics that cannot exceed 1 (loadings, CFI, RMSEA, SRMR, p): .35 */
export function apaNoLead(x, d = 2) {
  return apaNum(x, d).replace(/^(−?)0\./, '$1.');
}
/** p value as in a table: '< .001', '.023', '> .999' */
export function apaP(p) {
  if (!fin(p)) return '—';
  if (p < 0.001) return '< .001';
  if (p > 0.999) return '> .999';
  return apaNoLead(p, 3);
}
/** p value in running text, after an italic p: '< .001' or '= .023' */
export function pText(p) {
  const s = apaP(p);
  return /^[<>]/.test(s) || s === '—' ? s : `= ${s}`;
}
const nbp = (p) => esc(pText(p)).replace(' ', '&nbsp;');
/** Whole number with the thousands separator of the language: 1,250 (en) · 1.250 (tr) */
export function apaInt(n, lang = 'en') {
  return fin(n) ? Math.round(n).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') : '—';
}
/** "A", "A and B", "A, B, and C" (en) · "A, B ve C" (tr) */
export function listJoin(items, lang = 'en') {
  const a = items.filter((x) => x !== '' && x != null);
  if (a.length < 2) return a.join('');
  const and = X(lang, 'and', 've');
  if (a.length === 2) return `${a[0]} ${and} ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}${lang === 'tr' ? '' : ','} ${and} ${a[a.length - 1]}`;
}
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const numWord = (n, lang) => (lang !== 'tr' && n >= 0 && n <= 10 ? NUMW[n] : apaInt(n, lang));
const fit3 = (x) => apaNoLead(x, 3);

/** How the engine is named in the paper: "Mplus 8.3". */
export function engineLabel(ctx = {}) {
  return `Mplus${ctx.version ? ` ${ctx.version}` : ''}`;
}

// Which method papers a study cites (McNeish & Wolf 2023a/b only get letters when both are cited)
function cites(plan) {
  const one = plan && plan.type === 'one';
  return {
    mwCfa: one ? 'McNeish &amp; Wolf, 2023a' : 'McNeish &amp; Wolf, 2023',
    mwOne: 'McNeish &amp; Wolf, 2023b',
  };
}
const ESTNAME = {
  WLSMV: ['mean- and variance-adjusted weighted least squares (WLSMV)', 'ortalama ve varyansa göre düzeltilmiş ağırlıklandırılmış en küçük kareler (WLSMV)'],
  ML: ['maximum likelihood (ML)', 'en çok olabilirlik (ML)'],
  MLR: ['maximum likelihood with robust standard errors (MLR)', 'sağlam standart hatalı en çok olabilirlik (MLR)'],
  MLM: ['maximum likelihood with Satorra–Bentler corrections (MLM)', 'Satorra–Bentler düzeltmeli en çok olabilirlik (MLM)'],
};
const estName = (e, lang) => { const v = ESTNAME[String(e || '').toUpperCase()]; return v ? X(lang, v[0], v[1]) : esc(e || ''); };

// ---------- Method ----------
/**
 * The Method subsections as HTML paragraphs; '' where the context does not allow writing one yet.
 * ctx = {mode: 'csv'|'out'|'manual', dataName, nRows, nCols, missingCodes, sourceName, n,
 *        factors: [{name, label, items: [label]}], second: {name, label} | null, categorical, nCat: [min, max],
 *        cfaEstimator, version, plan, policy}
 * → {data, measures, analysis}
 */
export function methodText(ctx = {}, lang = 'en') {
  const out = { data: '', measures: '', analysis: '' };
  const n = fin(ctx.n) ? `<i>N</i>&nbsp;=&nbsp;${apaInt(ctx.n, lang)}` : '';
  if (ctx.mode === 'csv' && fin(ctx.nRows)) {
    const file = ctx.dataName ? `<i>${esc(ctx.dataName)}</i>` : X(lang, 'the data file', 'veri dosyası');
    let s = X(lang, `The data file ${file} contained ${apaInt(ctx.nRows, lang)} cases and ${apaInt(ctx.nCols, lang)} variables.`,
      `Veri dosyası ${file} ${apaInt(ctx.nRows, lang)} vaka ve ${apaInt(ctx.nCols, lang)} değişken içermektedir.`);
    if (ctx.cfaEstimator) {
      const how = String(ctx.cfaEstimator).toUpperCase() === 'WLSMV'
        ? X(lang, 'pairwise present data, the default of WLSMV in Mplus', 'Mplus’ta WLSMV’nin varsayılanı olan çiftler hâlinde mevcut veri')
        : X(lang, 'full-information maximum likelihood, the default of Mplus', 'Mplus’ın varsayılanı olan tam bilgili en çok olabilirlik');
      s += X(lang, ` Missing responses were handled with ${how}${n ? `; the analysis sample was ${n}` : ''}.`, ` Eksik yanıtlar ${how} ile ele alınmıştır${n ? `; analiz örneklemi ${n}` : ''}.`);
    }
    out.data = `<p>${s}</p>`;
  } else if (ctx.mode === 'out' && fin(ctx.n)) {
    const thr = ctx.categorical ? X(lang, ' the item thresholds,', ' madde eşikleri,') : '';
    out.data = `<p>${X(lang, `The standardized solution of the model,${thr} the sample size (${n}), and the fit of the model were read from the Mplus output file <i>${esc(ctx.sourceName || '')}</i>.`, `Modelin standartlaştırılmış çözümü,${thr} örneklem büyüklüğü (${n}) ve modelin uyumu <i>${esc(ctx.sourceName || '')}</i> Mplus çıktı dosyasından okunmuştur.`)}</p>`;
  } else if (ctx.mode === 'manual' && fin(ctx.n)) {
    out.data = `<p>${X(lang, `The standardized parameter estimates of the model and the sample size (${n}) were entered from a previously estimated solution.`, `Modelin standartlaştırılmış parametre kestirimleri ve örneklem büyüklüğü (${n}) daha önce kestirilmiş bir çözümden girilmiştir.`)}</p>`;
  }
  const f = ctx.factors || [];
  if (f.length) {
    const nItems = new Set(f.flatMap((x) => x.items)).size; // a cross-loaded item is listed under two factors
    const desc = f.map((x) => `${esc(x.label)} (${listJoin(x.items.map(esc), lang)})`);
    let s = f.length === 1
      ? X(lang, `The measurement model had one factor, ${desc[0]}.`, `Ölçme modelinde tek faktör vardır: ${desc[0]}.`)
      : X(lang, `The measurement model had ${numWord(f.length, lang)} first-order factors: ${listJoin(desc, lang)}.`, `Ölçme modelinde ${f.length} birinci düzey faktör vardır: ${listJoin(desc, lang)}.`);
    if (ctx.second) s += X(lang, ` A second-order factor, ${esc(ctx.second.label)}, had the first-order factors as its indicators.`, ` İkinci düzey bir faktör (${esc(ctx.second.label)}) birinci düzey faktörleri gösterge olarak almıştır.`);
    if (ctx.categorical) {
      const k = ctx.nCat && fin(ctx.nCat[0]) ? (ctx.nCat[0] === ctx.nCat[1] ? `${ctx.nCat[0]}` : `${ctx.nCat[0]}–${ctx.nCat[1]}`) : '';
      s += X(lang, ` The ${apaInt(nItems, lang)} items were treated as ordered categorical${k ? ` (${k} response categories)` : ''}.`, ` ${apaInt(nItems, lang)} madde sıralı kategorik olarak ele alınmıştır${k ? ` (${k} yanıt kategorisi)` : ''}.`);
    } else s += X(lang, ` The ${apaInt(nItems, lang)} items were treated as continuous.`, ` ${apaInt(nItems, lang)} madde sürekli olarak ele alınmıştır.`);
    out.measures = `<p>${s}</p>`;
  }
  const p = ctx.plan;
  if (p) {
    const c = cites(p);
    const v = ctx.version ? ` ${esc(ctx.version)}` : '';
    const est = ctx.mode === 'manual' ? '' : X(lang, `The confirmatory factor model was estimated in Mplus${v} (Muthén &amp; Muthén, 1998–2017) with ${estName(ctx.cfaEstimator, lang)}. `, `Doğrulayıcı faktör modeli Mplus${v} (Muthén ve Muthén, 1998–2017) programında ${estName(ctx.cfaEstimator, lang)} kestiricisiyle tahmin edilmiştir. `);
    const proc = p.type === 'hier' ? X(lang, `the procedure for higher-order models (McNeish &amp; Manapat, 2024)`, `ikinci düzey modeller için önerilen yöntem (McNeish ve Manapat, 2024)`)
      : p.type === 'one' ? X(lang, `the procedure for one-factor models (${c.mwOne})`, `tek faktörlü modeller için önerilen yöntem (${c.mwOne})`)
        : X(lang, `the procedure for multi-factor models (${c.mwCfa})`, `çok faktörlü modeller için önerilen yöntem (${c.mwCfa})`);
    const K = p.levels.length;
    const lv = p.type === 'one'
      ? X(lang, `Following ${proc} of the dynamic package (Wolf &amp; McNeish, 2023), ${numWord(K, lang)} levels of misspecification added increasing numbers of omitted residual correlations of .30 between items (${listJoin(p.levels.map((l) => `Level ${l.level}: ${l.addRcov.length}`), lang)}).`,
        `dynamic paketindeki (Wolf ve McNeish, 2023) ${proc} izlenerek ${K} yanlış belirtme düzeyi tanımlanmış; düzeyler maddeler arasına giderek artan sayıda .30 artık korelasyon eklemiştir (${listJoin(p.levels.map((l) => `Düzey ${l.level}: ${l.addRcov.length}`), lang)}).`)
      : X(lang, `Following ${proc} of the dynamic package (Wolf &amp; McNeish, 2023), ${numWord(K, lang)} level${K > 1 ? 's' : ''} of misspecification ${K > 1 ? 'were' : 'was'} defined by omitted cross-loadings: ${K > 1 ? `Level <i>k</i> added the first <i>k</i> of ${listJoin(p.levels.map((l) => esc(l.added)), lang)}` : `Level 1 added the cross-loading ${esc(p.levels[0].added)}`}. Each cross-loading belongs to the item with the lowest loading on its factor and points to the factor with the highest construct reliability (coefficient <i>H</i>); its size equals the item’s loading, capped at 95% of the largest value that keeps the residual variance positive.`,
        `dynamic paketindeki (Wolf ve McNeish, 2023) ${proc} izlenerek atlanmış çapraz yüklerle ${K} yanlış belirtme düzeyi tanımlanmıştır: ${K > 1 ? `<i>k</i>. düzey ${listJoin(p.levels.map((l) => esc(l.added)), lang)} çapraz yüklerinin ilk <i>k</i> tanesini eklemiştir` : `1. düzey ${esc(p.levels[0].added)} çapraz yükünü eklemiştir`}. Her çapraz yük, faktöründe en düşük yüke sahip maddeye aittir ve yapı güvenirliği (<i>H</i> katsayısı) en yüksek faktöre yönelir; büyüklüğü maddenin yüküne eşittir, ancak artık varyansı pozitif tutan en büyük değerin %95’i ile sınırlanır.`);
    const gen = p.dataType === 'categorical'
      ? X(lang, `as ordered categorical responses from the estimated thresholds (${'McNeish, 2023'})`, `kestirilen eşiklerden sıralı kategorik yanıtlar olarak (McNeish, 2023)`)
      : X(lang, 'as multivariate normal responses', 'çok değişkenli normal yanıtlar olarak');
    const noMeans = p.noMeans ? X(lang, ' As in the model fitted to the data, the simulated data were analyzed without a mean structure (MODEL = NOMEANSTRUCTURE), so that SRMR is defined in the same way.', ' Veriye uydurulan modelde olduğu gibi simülasyon verileri ortalama yapısı olmadan analiz edilmiştir (MODEL = NOMEANSTRUCTURE); böylece SRMR aynı biçimde tanımlanmıştır.') : '';
    const sim = X(lang, `For the correctly specified model and for each level, ${apaInt(p.reps, lang)} data sets of <i>N</i>&nbsp;=&nbsp;${apaInt(p.nSim, lang)} were generated in Mplus ${gen} and analyzed with the hypothesized model using ${estName(p.estimator, lang)}. CFI was computed for every replication from the chi-square statistics of the hypothesized model and of the baseline model fitted to the same data sets.${noMeans}`,
      `Doğru belirtilmiş model ve her düzey için Mplus’ta <i>N</i>&nbsp;=&nbsp;${apaInt(p.nSim, lang)} büyüklüğünde ${apaInt(p.reps, lang)} veri seti ${gen} üretilmiş ve hipotez modeli ${estName(p.estimator, lang)} ile bu veri setlerine uydurulmuştur. CFI her tekrar için, aynı veri setlerine uydurulan hipotez modeli ile temel (bağımsızlık) modelinin ki-kare istatistiklerinden hesaplanmıştır.${noMeans}`);
    const rule = X(lang, `A cutoff was the 5th percentile of the misspecified-model distribution of SRMR and RMSEA (the 95th percentile for CFI) when it separated from 95% of the correctly specified replications (95/5 rule); otherwise the 10th percentile was used when it separated from 90% of them (90/10 rule), and otherwise no cutoff was available (${c.mwCfa}).`,
      `SRMR ve RMSEA için kesme değeri, yanlış belirtilmiş model dağılımının 5. yüzdeliği (CFI için 95. yüzdelik), doğru belirtilmiş tekrarların %95’inden ayrıştığında kullanılmıştır (95/5 kuralı); aksi hâlde %90’ından ayrışan 10. yüzdelik kullanılmış (90/10 kuralı), o da sağlanmadığında kesme değeri verilmemiştir (${c.mwCfa.replace('&amp;', 've')}).`);
    const imp = ctx.policy === 'exclude'
      ? X(lang, 'Replications with improper solutions (e.g., negative residual variances) were excluded.', 'Uygunsuz çözüm veren tekrarlar (ör. negatif artık varyans) dışlanmıştır.')
      : X(lang, 'Replications with improper solutions (e.g., negative residual variances) were retained, as in the dynamic package.', 'Uygunsuz çözüm veren tekrarlar (ör. negatif artık varyans), dynamic paketinde olduğu gibi analizde tutulmuştur.');
    out.analysis = `<p>${est}${X(lang, `Model fit was evaluated with dynamic fit index (DFI) cutoffs (${c.mwCfa}), which are derived by simulation from the standardized solution of the model at hand rather than taken from fixed rules of thumb (Hu &amp; Bentler, 1999).`, `Model uyumu, sabit eşik değerleri (Hu ve Bentler, 1999) yerine incelenen modelin standartlaştırılmış çözümünden simülasyonla türetilen dinamik uyum indeksi (DFI) kesme değerleriyle değerlendirilmiştir (${c.mwCfa.replace('&amp;', 've')}).`)} ${lv}</p><p>${sim} ${rule} ${imp}</p>`;
  }
  return out;
}

// ---------- tables ----------
/**
 * Standardized factor loadings (STDYX): items × first-order factors; second-order loadings below.
 * spec = {by, n}; st = structure(spec); labels = {name: label}; opts = {estimator, version}
 */
export function loadingsTable(spec, st, labels = {}, lang = 'en', opts = {}) {
  if (!spec || !st) return '';
  const lab = (x) => esc(labels[x] ?? x);
  const first = st.first.length ? st.first : st.factors;
  const load = (f, i) => { const r = spec.by.find((x) => x.f === f && x.ind === i); return r ? apaNoLead(r.est) : ''; };
  const head = `<tr><th class="tl">${X(lang, 'Item', 'Madde')}</th>${first.map((f) => `<th>${lab(f)}</th>`).join('')}</tr>`;
  const rows = st.items.map((i) => `<tr><td class="tl">${lab(i)}</td>${first.map((f) => `<td>${load(f, i)}</td>`).join('')}</tr>`);
  for (const h of st.higher) {
    rows.push(`<tr class="sub"><td colspan="${first.length + 1}">${X(lang, 'Second-order factor', 'İkinci düzey faktör')}: ${lab(h)}</td></tr>`);
    for (const f of first) { const r = spec.by.find((x) => x.f === h && x.ind === f); if (r) rows.push(`<tr><td class="tl">${lab(f)}</td><td>${apaNoLead(r.est)}</td>${first.slice(1).map(() => '<td></td>').join('')}</tr>`); }
  }
  const est = opts.estimator ? X(lang, ` Estimator: ${esc(opts.estimator)}${opts.version ? `; Mplus ${esc(opts.version)}` : ''}.`, ` Kestirici: ${esc(opts.estimator)}${opts.version ? `; Mplus ${esc(opts.version)}` : ''}.`) : '';
  const note = X(lang, `<i>Note.</i> ${fin(spec.n) ? `<i>N</i>&nbsp;=&nbsp;${apaInt(spec.n, lang)}. ` : ''}Standardized (STDYX) loadings; empty cells are fixed at zero.${est}`,
    `<i>Not.</i> ${fin(spec.n) ? `<i>N</i>&nbsp;=&nbsp;${apaInt(spec.n, lang)}. ` : ''}Standartlaştırılmış (STDYX) yükler; boş hücreler sıfıra sabitlenmiştir.${est}`);
  return `<table class="rtab" style="width:auto;min-width:360px"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table><p class="tnote">${note}</p>`;
}

/** Empirical fit, the dynamic cutoffs by level (95/5 or 90/10 rule) and Hu & Bentler's fixed cutoffs. */
export function fitTable(emp, sum, plan, lang = 'en') {
  if (!sum || !sum.ok) return '';
  let any90 = false;
  const cell = (c) => { if (!fin(c.value)) return 'NONE'; if (c.rule === '90/10') { any90 = true; return `${fit3(c.value)}<sup>a</sup>`; } return fit3(c.value); };
  const head = `<tr><th class="tl">${X(lang, 'Model', 'Model')}</th><th class="tl">${X(lang, 'Misspecification', 'Yanlış belirtme')}</th><th>SRMR</th><th>RMSEA</th><th>CFI</th></tr>`;
  const rows = [];
  if (emp && (fin(emp.srmr) || fin(emp.rmsea) || fin(emp.cfi))) {
    rows.push(`<tr><td class="tl">${X(lang, 'Hypothesized model (observed)', 'Hipotez modeli (gözlenen)')}</td><td class="tl">—</td><td>${fit3(emp.srmr)}</td><td>${fit3(emp.rmsea)}</td><td>${fit3(emp.cfi)}</td></tr>`);
  }
  rows.push(`<tr class="sub"><td colspan="5">${X(lang, 'Dynamic fit index cutoffs', 'Dinamik uyum indeksi kesme değerleri')}</td></tr>`);
  sum.levels.forEach((l) => rows.push(`<tr><td class="tl">${X(lang, 'Level', 'Düzey')} ${l.level}</td><td class="tl">${esc(plan.levels[l.level - 1].added)}</td><td>${cell(l.hb.srmr)}</td><td>${cell(l.hb.rmsea)}</td><td>${cell(l.hb.cfi)}</td></tr>`));
  rows.push(`<tr class="sub"><td colspan="5">${X(lang, 'Fixed cutoffs', 'Sabit kesme değerleri')}</td></tr>`);
  rows.push(`<tr><td class="tl">Hu &amp; Bentler (1999)</td><td class="tl">—</td><td>&le;&nbsp;.08</td><td>&le;&nbsp;.06</td><td>&ge;&nbsp;.95</td></tr>`);
  const note = X(lang,
    `<i>Note.</i> Values below the cutoff (SRMR, RMSEA) or above it (CFI) indicate misfit smaller than that level of misspecification. Cutoffs follow the 95/5 rule${any90 ? '; <sup>a</sup>90/10 rule' : ''}; NONE = the correct and misspecified distributions did not separate. ${apaInt(plan.reps, lang)} replications per condition; <i>N</i>&nbsp;=&nbsp;${apaInt(plan.nSim, lang)}; ${plan.dataType === 'categorical' ? 'ordinal data' : 'normal data'}, ${esc(plan.estimator)}; improper solutions ${sum.policy === 'exclude' ? 'excluded' : 'retained'}.`,
    `<i>Not.</i> Kesme değerinin altındaki (SRMR, RMSEA) ya da üstündeki (CFI) değerler, uyumsuzluğun o yanlış belirtme düzeyinden küçük olduğunu gösterir. Kesme değerleri 95/5 kuralına göredir${any90 ? '; <sup>a</sup>90/10 kuralı' : ''}; NONE = doğru ve yanlış belirtilmiş dağılımlar ayrışmamıştır. Koşul başına ${apaInt(plan.reps, lang)} tekrar; <i>N</i>&nbsp;=&nbsp;${apaInt(plan.nSim, lang)}; ${plan.dataType === 'categorical' ? 'sıralı veri' : 'normal veri'}, ${esc(plan.estimator)}; uygunsuz çözümler ${sum.policy === 'exclude' ? 'dışlandı' : 'tutuldu'}.`);
  return `<table class="rtab" style="width:auto;min-width:440px"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table><p class="tnote">${note}</p>`;
}

/** Simulation conditions: replications, improper solutions and the sensitivity view (95% specificity). */
export function conditionsTable(sum, plan, lang = 'en') {
  if (!sum || !sum.ok) return '';
  const pct = (x) => (fin(x) ? `${Math.round(x * 100)}%` : '—');
  const sc = (c) => (fin(c.value) ? `${fit3(c.value)} (${pct(c.sens)})` : `NONE (${pct(c.sens)})`);
  const head = `<tr class="hd"><td class="tl" rowspan="2">${X(lang, 'Condition', 'Koşul')}</td><td rowspan="2">${X(lang, 'Completed', 'Tamamlanan')}</td><td rowspan="2">${X(lang, 'Improper', 'Uygunsuz')}</td><td colspan="3">${X(lang, 'Cutoff (sensitivity) at 95% specificity', '%95 özgüllükte kesme değeri (duyarlılık)')}</td></tr><tr class="hd2"><td>SRMR</td><td>RMSEA</td><td>CFI</td></tr>`;
  const l0 = sum.level0;
  const rows = [`<tr><td class="tl">${X(lang, 'Correct model', 'Doğru model')}</td><td>${apaInt(l0.completed, lang)}</td><td>${apaInt(l0.improper, lang)}</td><td>${fit3(l0.spec.srmr)}</td><td>${fit3(l0.spec.rmsea)}</td><td>${fit3(l0.spec.cfi)}</td></tr>`];
  sum.levels.forEach((l) => rows.push(`<tr><td class="tl">${X(lang, 'Level', 'Düzey')} ${l.level}</td><td>${apaInt(l.completed, lang)}</td><td>${apaInt(l.improper, lang)}</td><td>${sc(l.sens.srmr)}</td><td>${sc(l.sens.rmsea)}</td><td>${sc(l.sens.cfi)}</td></tr>`));
  const note = X(lang,
    `<i>Note.</i> Completed = replications with both the hypothesized and the baseline model estimated (of ${apaInt(plan.reps, lang)}); Improper = replications with a non–positive definite residual or latent covariance matrix (Mplus TECH9). For the correct model the row shows the 95th percentile (5th for CFI), which keeps 95% specificity; for each level, the misspecified-model cutoff with the highest sensitivity that keeps it, as in the categorical functions of dynamic (McNeish, 2023). Cutoffs with sensitivity below 50% are suppressed (NONE).`,
    `<i>Not.</i> Tamamlanan = hipotez ve temel modelin ikisinin de kestirildiği tekrarlar (${apaInt(plan.reps, lang)} tekrardan); Uygunsuz = artık ya da örtük kovaryans matrisi pozitif tanımlı olmayan tekrarlar (Mplus TECH9). Doğru model satırı %95 özgüllüğü sağlayan 95. yüzdeliği (CFI için 5.) gösterir; her düzey için bu özgüllüğü koruyan en yüksek duyarlılıklı kesme değeri, dynamic paketinin kategorik fonksiyonlarındaki gibi (McNeish, 2023) verilmiştir. Duyarlılığı %50’nin altındaki kesme değerleri gösterilmez (NONE).`);
  return `<table class="rtab" style="width:auto;min-width:440px"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table><p class="tnote">${note}</p>`;
}

// ---------- Results ----------
/**
 * Results paragraphs (HTML). emp = {chisq, df, pvalue, cfi, rmsea, srmr} (may be null), sum = summarizeDfi(),
 * plan = planDfi(), interp = interpret(emp, sum).
 */
export function resultsText(emp, sum, plan, interp, lang = 'en') {
  if (!sum || !sum.ok) return '';
  const K = sum.levels.length;
  const out = [];
  if (emp && fin(emp.cfi)) {
    const chi = fin(emp.chisq) ? `χ<sup>2</sup>(${apaInt(emp.df, lang)})&nbsp;=&nbsp;${apaNum(emp.chisq)}, <i>p</i>&nbsp;${nbp(emp.pvalue)}, ` : '';
    out.push(X(lang, `The hypothesized model yielded ${chi}CFI&nbsp;=&nbsp;${fit3(emp.cfi)}, RMSEA&nbsp;=&nbsp;${fit3(emp.rmsea)}, and SRMR&nbsp;=&nbsp;${fit3(emp.srmr)}.`,
      `Hipotez modeli için ${chi}CFI&nbsp;=&nbsp;${fit3(emp.cfi)}, RMSEA&nbsp;=&nbsp;${fit3(emp.rmsea)} ve SRMR&nbsp;=&nbsp;${fit3(emp.srmr)} bulunmuştur.`));
    const NAMES = { srmr: 'SRMR', rmsea: 'RMSEA', cfi: 'CFI' };
    const parts = (interp || []).filter((x) => fin(x.value) && x.any).map((x) => {
      const nm = NAMES[x.idx];
      if (x.beyond === 0) {
        const c = x.cut.find(fin);
        return X(lang, `${nm} was within the Level-1 cutoff (${fit3(c)})`, `${nm}, 1. düzey kesme değerinin (${fit3(c)}) içinde kalmıştır`);
      }
      return x.beyond === K
        ? X(lang, `${nm} ${x.idx === 'cfi' ? 'fell below' : 'exceeded'} the cutoff of every level (Level ${K}: ${fit3(x.cut[K - 1])})`, `${nm} bütün düzeylerin kesme değerini aşmıştır (${K}. düzey: ${fit3(x.cut[K - 1])})`)
        : X(lang, `${nm} ${x.idx === 'cfi' ? 'fell below' : 'exceeded'} the Level-${x.beyond} cutoff (${fit3(x.cut[x.beyond - 1])}) but not the Level-${x.beyond + 1} cutoff`, `${nm}, ${x.beyond}. düzey kesme değerini (${fit3(x.cut[x.beyond - 1])}) aşmış, ${x.beyond + 1}. düzeyinkini aşmamıştır`);
    });
    if (parts.length) out.push(X(lang, `Compared with the dynamic cutoffs in Table 2, ${listJoin(parts, lang)}.`, `Tablo 2’deki dinamik kesme değerleriyle karşılaştırıldığında ${listJoin(parts, lang)}.`));
    const all = (interp || []).filter((x) => fin(x.value) && x.any);
    if (all.length && all.every((x) => x.beyond === 0)) out.push(X(lang, 'The misfit of the model is therefore smaller than the smallest misspecification considered.', 'Dolayısıyla modelin uyumsuzluğu, ele alınan en küçük yanlış belirtmeden daha küçüktür.'));
    else if (all.length && all.every((x) => x.beyond === K)) out.push(X(lang, `The misfit of the model is therefore at least as large as the largest misspecification considered (Level ${K}); the sources of misfit deserve a closer look (e.g., modification indices, cross-loadings, residual correlations).`, `Dolayısıyla modelin uyumsuzluğu, ele alınan en büyük yanlış belirtme (${K}. düzey) kadar ya da ondan büyüktür; uyumsuzluğun kaynakları (ör. modifikasyon indeksleri, çapraz yükler, artık korelasyonlar) ayrıca incelenmelidir.`));
    const hb = [emp.cfi >= 0.95, emp.rmsea <= 0.06, emp.srmr <= 0.08];
    const met = hb.filter(Boolean).length;
    out.push(X(lang, `By the fixed cutoffs of Hu and Bentler (1999), the model met ${met === 3 ? 'all' : met === 0 ? 'none' : numWord(met, lang)} of the three criteria (CFI&nbsp;&ge;&nbsp;.95, RMSEA&nbsp;&le;&nbsp;.06, SRMR&nbsp;&le;&nbsp;.08).`, `Hu ve Bentler’in (1999) sabit kesme değerlerine göre model üç ölçütün ${met} tanesini karşılamıştır (CFI&nbsp;&ge;&nbsp;.95, RMSEA&nbsp;&le;&nbsp;.06, SRMR&nbsp;&le;&nbsp;.08).`));
  } else {
    out.push(X(lang, 'The dynamic cutoffs of the model are reported in Table 2; the observed fit of the model was not available for comparison.', 'Modelin dinamik kesme değerleri Tablo 2’de verilmiştir; karşılaştırma için modelin gözlenen uyumu mevcut değildir.'));
  }
  const imp = sum.levels.reduce((a, l) => a + l.improper, 0), comp = sum.levels.reduce((a, l) => a + l.completed, 0);
  if (imp > 0) {
    const share = comp ? Math.round((imp / comp) * 100) : 0;
    out.push(X(lang, `In the misspecified conditions, ${share}% of the replications ended in improper solutions (Table 3); they were ${sum.policy === 'exclude' ? 'excluded from' : 'retained in'} the cutoff distributions.`, `Yanlış belirtilmiş koşullarda tekrarların %${share}’i uygunsuz çözümle sonuçlanmıştır (Tablo 3); bu tekrarlar kesme değeri dağılımlarında ${sum.policy === 'exclude' ? 'dışlanmıştır' : 'tutulmuştur'}.`));
  }
  out.push(X(lang, 'Figure 1 shows the distributions of the fit indices under the correct and the misspecified models.', 'Şekil 1, doğru ve yanlış belirtilmiş modellerde uyum indekslerinin dağılımlarını göstermektedir.'));
  return `<p>${out.slice(0, 3).join(' ')}</p><p>${out.slice(3).join(' ')}</p>`;
}

// ---------- References ----------
/** References of the study (APA 7). ctx = {plan, version} */
export function references(ctx = {}, lang = 'en') {
  const p = ctx.plan;
  const one = p && p.type === 'one';
  const list = [
    `Hu, L., &amp; Bentler, P. M. (1999). Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives. <i>Structural Equation Modeling, 6</i>(1), 1–55. https://doi.org/10.1080/10705519909540118`,
  ];
  if (p && p.dataType === 'categorical') list.push(`McNeish, D. (2023). Dynamic fit index cutoffs for categorical factor analysis with Likert-type, ordinal, or binary responses. <i>American Psychologist, 78</i>(9), 1061–1075. https://doi.org/10.1037/amp0001213`);
  if (p && p.type === 'hier') list.push(`McNeish, D., &amp; Manapat, P. D. (2024). Dynamic fit index cutoffs for hierarchical and second-order factor models. <i>Structural Equation Modeling, 31</i>(1), 27–47. https://doi.org/10.1080/10705511.2023.2225132`);
  list.push(`McNeish, D., &amp; Wolf, M. G. (${one ? '2023a' : '2023'}). Dynamic fit index cutoffs for confirmatory factor analysis models. <i>Psychological Methods, 28</i>(1), 61–88. https://doi.org/10.1037/met0000425`);
  if (one) list.push(`McNeish, D., &amp; Wolf, M. G. (2023b). Dynamic fit index cutoffs for one-factor models. <i>Behavior Research Methods, 55</i>(3), 1157–1174. https://doi.org/10.3758/s13428-022-01847-y`);
  list.push(`Muthén, L. K., &amp; Muthén, B. O. (1998–2017). <i>Mplus user’s guide</i> (${X(lang, '8th ed.', '8. bs.')}). Muthén &amp; Muthén.`);
  list.push(`Wolf, M. G., &amp; McNeish, D. (2023). dynamic: An R package for deriving dynamic fit index cutoffs for factor analysis. <i>Multivariate Behavioral Research, 58</i>(1), 189–194. https://doi.org/10.1080/00273171.2022.2163476`);
  return `<div class="refs">${list.map((x) => `<p>${x}</p>`).join('')}</div>`;
}
