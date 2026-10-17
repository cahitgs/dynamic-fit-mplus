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
/** "A; B; and C" (en) · "A; B ve C" (tr): for lists whose items contain commas */
const semiJoin = (a, lang) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join('; ')}${X(lang, '; and ', ' ve ')}${a[a.length - 1]}`);
const ID = (x) => x;
/**
 * What a misspecification level adds, in the words of the paper and with the labels of the items and factors:
 * "Mastery 1 on Self (.445)" for a cross-loading, "F6 with F1" for a disturbance correlation (size = true adds
 * "(.50)"); one-factor levels keep their count. lv is the level of the plan (plan.levels or plan.slevels).
 */
function levelText(plan, lv, lang, lab = ID, structural = false, size = false) {
  if (structural) {
    const prev = lv.level > 1 ? plan.slevels[lv.level - 2].addPsi.length : 0;
    const nw = lv.addPsi.slice(prev);
    const s = listJoin(nw.map((x) => `${esc(lab(x.a))} ${X(lang, 'with', 'ile')} ${esc(lab(x.b))}`), lang);
    return size ? `${s} (${nw.some((x) => x.r < 0) ? '±' : ''}.50)` : s;
  }
  if (plan.type === 'one' || !lv.addBy.length) return esc(lv.added);
  const x = lv.addBy[lv.addBy.length - 1];
  return `${esc(lab(x.ind))} ${X(lang, 'on', '→')} ${esc(lab(x.f))} (${apaNoLead(x.est, 3)})`;
}

/** How the engine is named in the paper: "Mplus 8.3". */
export function engineLabel(ctx = {}) {
  return `Mplus${ctx.version ? ` ${ctx.version}` : ''}`;
}

// Which method papers a study cites (McNeish & Wolf 2023a/b only get letters when both are cited). The dynamic
// package is cited as its paper (Wolf & McNeish, 2023) and, for rules that exist only in its code, as the software
// (Wolf & McNeish, 2026: GitHub version 1.1.0, commit 90aa51f).
function cites(plan) {
  const one = plan && plan.type === 'one';
  return {
    mwCfa: one ? 'McNeish &amp; Wolf, 2023a' : 'McNeish &amp; Wolf, 2023',
    mwOne: 'McNeish &amp; Wolf, 2023b',
    mwRule: one ? 'McNeish &amp; Wolf, 2023a, 2023b' : 'McNeish &amp; Wolf, 2023',
    pkg: 'Wolf &amp; McNeish, 2023, 2026',
    code: 'Wolf &amp; McNeish, 2026',
  };
}
const TR = (s) => s.replace(/ &amp; /g, ' ve ');
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
      s += X(lang, ` The ${numWord(nItems, lang)} items were treated as ordered categorical${k ? ` (${k} response categories)` : ''}.`, ` ${apaInt(nItems, lang)} madde sıralı kategorik olarak ele alınmıştır${k ? ` (${k} yanıt kategorisi)` : ''}.`);
    } else s += X(lang, ` The ${numWord(nItems, lang)} items were treated as continuous.`, ` ${apaInt(nItems, lang)} madde sürekli olarak ele alınmıştır.`);
    out.measures = `<p>${s}</p>`;
  }
  const p = ctx.plan;
  if (p) {
    const lab = ctx.lab || ID;
    const c = cites(p);
    const v = ctx.version ? ` ${esc(ctx.version)}` : '';
    const mp = 'Muthén &amp; Muthén, 1998–2017';
    const est = ctx.mode === 'manual' ? '' : X(lang, `The confirmatory factor model was estimated in Mplus${v} (${mp}) with ${estName(ctx.cfaEstimator, lang)}. `, `Doğrulayıcı faktör modeli Mplus${v} (${TR(mp)}) programında ${estName(ctx.cfaEstimator, lang)} kestiricisiyle tahmin edilmiştir. `);
    const K = p.levels.length;
    const hier = p.type === 'hier';
    const inv = p.signs !== 'dynamic';
    let lv;
    if (p.type === 'one') {
      const sgn = !p.signSensitive ? '' : inv
        ? X(lang, ' Each residual correlation took the sign of the product of the two loadings, so that reverse-coded items do not change the misspecification; McNeish and Wolf (2023a, 2023b) and dynamic always add +.30, which is the same when the loadings are positive.', ' Her artık korelasyon iki yükün çarpımının işaretini almıştır; böylece ters kodlanmış maddeler yanlış belirtmeyi değiştirmez. McNeish ve Wolf (2023a, 2023b) ile dynamic her zaman +.30 ekler; yükler pozitifken ikisi aynıdır.')
        : X(lang, ' As in McNeish and Wolf (2023a, 2023b) and dynamic, the residual correlations were positive whatever the signs of the loadings.', ' McNeish ve Wolf (2023a, 2023b) ile dynamic’te olduğu gibi artık korelasyonlar, yüklerin işaretinden bağımsız olarak pozitif alınmıştır.');
      // Level 1: the paper rounds (default), dynamic rounds down ('As dynamic'); said only when the two differ
      const mo = p.misspec || {};
      const n1 = p.levels[0].addRcov.length;
      const rc = (n) => `${numWord(n, lang)} residual correlation${n > 1 ? 's' : ''}`;
      const l1 = !p.l1Differs ? '' : inv
        ? X(lang, ` Following the formula of McNeish and Wolf (2023a), Level 1 had ⌊⌊<i>I</i>/2⌋/3 + .5⌋ = ${rc(n1)} for the <i>I</i>&nbsp;=&nbsp;${mo.k} eligible items; the dynamic package rounds down and adds ${rc(mo.dynL1)} (${c.code}).`, ` McNeish ve Wolf’un (2023a) formülüne göre 1. düzey, <i>I</i>&nbsp;=&nbsp;${mo.k} uygun madde için ⌊⌊<i>I</i>/2⌋/3 + .5⌋ = ${n1} artık korelasyon içermiştir; dynamic paketi aşağı yuvarlar ve ${mo.dynL1} ekler (${TR(c.code)}).`)
        : X(lang, ` As in the dynamic package (${c.code}), Level 1 had ⌊⌊<i>I</i>/2⌋/3⌋ = ${rc(n1)} for the <i>I</i>&nbsp;=&nbsp;${mo.k} eligible items; the formula of McNeish and Wolf (2023a) rounds instead of rounding down and gives ${numWord(mo.paperL1, lang)}.`, ` dynamic paketinde olduğu gibi (${TR(c.code)}) 1. düzey, <i>I</i>&nbsp;=&nbsp;${mo.k} uygun madde için ⌊⌊<i>I</i>/2⌋/3⌋ = ${n1} artık korelasyon içermiştir; McNeish ve Wolf’un (2023a) formülü aşağı yuvarlamak yerine yuvarlar ve ${mo.paperL1} verir.`);
      const size = K === 3 ? X(lang, ', which stand for small, medium, and large misspecifications', '; bu düzeyler küçük, orta ve büyük yanlış belirtmeyi temsil eder') : '';
      lv = X(lang, `Following the procedure for one-factor models (McNeish &amp; Wolf, 2023a, 2023b) as implemented in the dynamic package (${c.pkg}), ${numWord(K, lang)} level${K > 1 ? 's' : ''} of misspecification added increasing numbers of omitted residual correlations of .30 between pairs of items, formed from the lowest absolute standardized loadings upward (${listJoin(p.levels.map((l) => `Level ${l.level}: ${l.addRcov.length}`), lang)})${size}.${l1}${sgn}`,
        `dynamic paketinde (${TR(c.pkg)}) uygulandığı biçimiyle tek faktörlü modeller için önerilen yöntem (McNeish ve Wolf, 2023a, 2023b) izlenerek ${K} yanlış belirtme düzeyi tanımlanmış; düzeyler, mutlak değerce en düşük standart yüklerden başlayarak eşlenen maddeler arasına giderek artan sayıda .30 artık korelasyon eklemiştir (${listJoin(p.levels.map((l) => `Düzey ${l.level}: ${l.addRcov.length}`), lang)})${size}.${l1}${sgn}`);
    } else {
      const proc = hier ? X(lang, 'the measurement-misspecification procedure for higher-order models (McNeish &amp; Manapat, 2024)', 'ikinci düzey modeller için önerilen ölçme yanlış belirtmesi yöntemi (McNeish ve Manapat, 2024)')
        : X(lang, `the procedure for multi-factor models (${c.mwCfa})`, `çok faktörlü modeller için önerilen yöntem (${TR(c.mwCfa)})`);
      const sgn = !p.signSensitive ? '' : inv
        ? X(lang, ' Each cross-loading took the sign of the product of the item’s loading and the correlation of the two factors, and the levels were ordered by the absolute loadings, so that reverse-coded items do not change the misspecification; with positive loadings and factor correlations this is the same as in dynamic.', ' Her çapraz yük, maddenin yükü ile iki faktör arasındaki korelasyonun çarpımının işaretini almış ve düzeyler yüklerin mutlak değerine göre sıralanmıştır; böylece ters kodlanmış maddeler yanlış belirtmeyi değiştirmez. Yükler ve faktör korelasyonları pozitifken bu, dynamic ile aynıdır.')
        : X(lang, ' As in dynamic, the cross-loadings were positive and the levels were ordered by the signed loadings.', ' dynamic’te olduğu gibi çapraz yükler pozitif alınmış ve düzeyler işaretli yüklere göre sıralanmıştır.');
      // second-order models: the structural misspecification (hier2), or why it could not be evaluated
      const ps = p.slevels || [];
      const sr = p.structural || {};
      const KS = ps.length;
      const sNeg = ps.some((l) => l.addPsi.some((x) => x.r < 0));
      const structEn = !hier ? '' : KS
        ? ` In addition, following the structural-misspecification procedure for higher-order models (McNeish &amp; Manapat, 2024; hier2 in the dynamic package), ${numWord(KS, lang)} level${KS > 1 ? 's' : ''} of structural misspecification added correlations of .50 between the disturbances of pairs of first-order factors, paired in order of their second-order loadings from the smallest; each level added to the correlations of the previous one (${semiJoin(ps.map((l) => `Level S${l.level}: ${levelText(p, l, lang, lab, true)}`), lang)}).${sr.k === 4 ? ' With four first-order factors, the two levels described by McNeish and Manapat (2024) were used; dynamic does not run this case.' : ''}${sNeg ? ' Each correlation took the sign of the product of the two second-order loadings, so that reflecting a factor does not change the misspecification.' : ''}${sr.note ? ' Further levels were not used because their population model was inadmissible.' : ''}`
        : sr.reason === 'saturated' ? ' Structural misspecification of the second-order model was not evaluated: with fewer than four first-order factors, their covariance matrix is saturated (McNeish &amp; Manapat, 2024).'
          : ' Structural misspecification was not evaluated because fewer than four first-order factors load on a single second-order factor without a disturbance correlation.';
      const structTr = !hier ? '' : KS
        ? ` Ayrıca ikinci düzey modeller için önerilen yapısal yanlış belirtme yöntemi (McNeish ve Manapat, 2024; dynamic paketinde hier2) izlenerek ${KS} yapısal yanlış belirtme düzeyi tanımlanmış; düzeyler, ikinci düzey yüklerine göre en küçükten başlayarak eşlenen birinci düzey faktörlerin bozulma terimleri arasına .50 korelasyon eklemiş, her düzey bir öncekinin korelasyonlarına yenilerini katmıştır (${semiJoin(ps.map((l) => `Düzey S${l.level}: ${levelText(p, l, lang, lab, true)}`), lang)}).${sr.k === 4 ? ' Dört birinci düzey faktörde McNeish ve Manapat’ın (2024) tarif ettiği iki düzey kullanılmıştır; dynamic bu durumu çalıştırmaz.' : ''}${sNeg ? ' Her korelasyon iki ikinci düzey yükün çarpımının işaretini almıştır; böylece bir faktörün yönünü çevirmek yanlış belirtmeyi değiştirmez.' : ''}${sr.note ? ' Popülasyon modeli kabul edilemez olduğundan sonraki düzeyler kullanılmamıştır.' : ''}`
        : sr.reason === 'saturated' ? ' İkinci düzey modelin yapısal yanlış belirtmesi değerlendirilmemiştir: dörtten az birinci düzey faktörde bu faktörlerin kovaryans matrisi doymuştur (McNeish ve Manapat, 2024).'
          : ' Tek bir ikinci düzey faktöre yüklenen ve bozulma korelasyonu olmayan dörtten az birinci düzey faktör bulunduğundan yapısal yanlış belirtme değerlendirilmemiştir.';
      const lvl = K > 1 ? X(lang, `Level <i>k</i> added the first <i>k</i> of the cross-loadings ${listJoin(p.levels.map((l) => levelText(p, l, lang, lab)), lang)}`, `<i>k</i>. düzey ${listJoin(p.levels.map((l) => levelText(p, l, lang, lab)), lang)} çapraz yüklerinin ilk <i>k</i> tanesini eklemiştir`)
        : X(lang, `Level 1 added the cross-loading ${levelText(p, p.levels[0], lang, lab)}`, `1. düzey ${levelText(p, p.levels[0], lang, lab)} çapraz yükünü eklemiştir`);
      const hbL1 = hier ? '' : X(lang, ` Level 1, a single omitted cross-loading, corresponds to the misspecification from which the traditional fixed cutoffs were derived (Hu &amp; Bentler, 1999; ${c.mwCfa}).`, ` Tek bir atlanmış çapraz yük olan 1. düzey, geleneksel sabit kesme değerlerinin türetildiği yanlış belirtmeye karşılık gelir (Hu ve Bentler, 1999; ${TR(c.mwCfa)}).`);
      lv = X(lang, `Following ${proc} as implemented in the dynamic package (${c.pkg}), ${numWord(K, lang)} level${K > 1 ? 's' : ''} of misspecification ${K > 1 ? 'were' : 'was'} defined by omitted cross-loadings: ${lvl}.${hbL1} Each cross-loading belonged to the item with the lowest absolute loading on its factor (one item per factor, factors with more than two indicators first, as in the package code; ${c.code}) and loaded on the ${hier ? 'first-order ' : ''}factor with the highest construct reliability (coefficient <i>H</i>; Hancock &amp; Mueller, 2001) among those not yet paired with the item’s factor; its size equaled the item’s loading, capped at 95% of the largest value that keeps the residual variance positive (${c.mwCfa})${hier ? ', given the first-order factor correlations implied by the second-order loadings' : ''}.${sgn}${structEn}`,
        `dynamic paketinde (${TR(c.pkg)}) uygulandığı biçimiyle ${proc} izlenerek atlanmış çapraz yüklerle ${K} yanlış belirtme düzeyi tanımlanmıştır: ${lvl}.${hbL1} Her çapraz yük, faktöründe mutlak değerce en düşük yüke sahip maddeye verilmiş (paket kodundaki gibi her faktörden bir madde, öncelik ikiden çok göstergeli faktörlerde; ${TR(c.code)}) ve maddenin faktörüyle henüz eşlenmemiş ${hier ? 'birinci düzey ' : ''}faktörler arasında yapı güvenirliği (<i>H</i> katsayısı; Hancock ve Mueller, 2001) en yüksek olana yüklenmiştir; büyüklüğü maddenin yüküne eşit alınmış, ancak artık varyansı pozitif tutan en büyük değerin %95’i ile sınırlanmıştır (${TR(c.mwCfa)})${hier ? '; bu hesapta birinci düzey faktörler arasındaki, ikinci düzey yüklerin gerektirdiği korelasyonlar kullanılmıştır' : ''}.${sgn}${structTr}`);
    }
    const gen = p.dataType === 'categorical'
      ? X(lang, 'as ordered categorical responses from the estimated thresholds (McNeish, 2023)', 'kestirilen eşiklerden sıralı kategorik yanıtlar olarak (McNeish, 2023)')
      : X(lang, 'as multivariate normal responses', 'çok değişkenli normal yanıtlar olarak');
    const inMplus = ctx.mode === 'manual' ? X(lang, `Mplus (${mp})`, `Mplus’ta (${TR(mp)})`) : X(lang, 'Mplus', 'Mplus’ta');
    const cap = p.nSim < p.n ? X(lang, ` The simulated sample size was capped at ${apaInt(p.nmax || 2000, lang)}, as in dynamic (${c.code}).`, ` dynamic’te olduğu gibi (${TR(c.code)}) simülasyon örneklem büyüklüğü ${apaInt(p.nmax || 2000, lang)} ile sınırlanmıştır.`) : '';
    const cont = p.dataType !== 'categorical';
    const noMeans = p.noMeans ? X(lang, ' As in the model fitted to the data, the simulated data were analyzed without a mean structure (MODEL = NOMEANSTRUCTURE), so that SRMR is defined in the same way.', ' Veriye uydurulan modelde olduğu gibi simülasyon verileri ortalama yapısı olmadan analiz edilmiştir (MODEL = NOMEANSTRUCTURE); böylece SRMR aynı biçimde tanımlanmıştır.')
      : cont ? X(lang, ' The simulated data were analyzed with the mean structure that Mplus estimates by default, so SRMR also averages the (zero) mean residuals; the cutoffs are comparable with an SRMR obtained in the same way but not with SRMR cutoffs computed without a mean structure (e.g., by dynamic).', ' Simülasyon verileri Mplus’ın varsayılan olarak kestirdiği ortalama yapısıyla analiz edilmiştir; bu yüzden SRMR (sıfır olan) ortalama artıklarının da ortalamasını alır. Kesme değerleri aynı biçimde elde edilen bir SRMR ile karşılaştırılabilir, ortalama yapısı olmadan hesaplanan SRMR kesme değerleriyle (ör. dynamic) karşılaştırılamaz.') : '';
    // what the simulated data leave out (McNeish & Wolf, 2023a, limitation 4), and scaled observed fit
    const lim = cont
      ? X(lang, ` The simulated data were complete and multivariate normal, so missing data and non-normality of the observed data are not reflected in the cutoffs (${c.mwCfa}).`, ` Simülasyon verileri eksiksiz ve çok değişkenli normaldir; bu yüzden gözlenen verideki eksik veri ve normal dışılık kesme değerlerine yansımaz (${TR(c.mwCfa)}).`)
      : X(lang, ' The simulated data were complete, so missing data in the observed data are not reflected in the cutoffs.', ' Simülasyon verileri eksiksizdir; bu yüzden gözlenen verideki eksik veri kesme değerlerine yansımaz.');
    // ordinal items analyzed as normal (the "as dynamic" option): the cutoffs are not on the metric of the observed fit
    const srcEst = esc(p.srcEstimator || 'WLSMV');
    const mism = p.estMismatch
      ? X(lang, ` Although the items were ordered categorical and the model was estimated with ${srcEst}, the simulated data were generated as multivariate normal and analyzed with ML, as in the default functions of the dynamic package (${c.code}); these cutoffs are not on the metric of the observed fit indices and were therefore not used to evaluate the fit of the model.`,
        ` Maddeler sıralı kategorik olup model ${srcEst} ile kestirilmiş olsa da simülasyon verileri, dynamic paketinin varsayılan fonksiyonlarında olduğu gibi (${TR(c.code)}) çok değişkenli normal üretilmiş ve ML ile analiz edilmiştir; bu kesme değerleri gözlenen uyum indeksleriyle aynı ölçekte olmadığından modelin uyumunu değerlendirmede kullanılmamıştır.`)
      : '';
    const scaled = /^(MLR|MLM|MLMV)$/.test(String(ctx.cfaEstimator || '').toUpperCase()) && cont
      ? X(lang, ` The observed RMSEA and CFI were scaled (${esc(String(ctx.cfaEstimator).toUpperCase())}), whereas the cutoffs come from ML with normal data, so the comparison assumes approximately normal data.`, ` Gözlenen RMSEA ve CFI ölçeklenmiştir (${esc(String(ctx.cfaEstimator).toUpperCase())}); kesme değerleri ise normal veride ML’den gelir, bu yüzden karşılaştırma verinin yaklaşık normal olduğunu varsayar.`) : '';
    // the estimator is named in full only once: the CFA sentence has already defined it when it is the same
    const simEst = est && String(ctx.cfaEstimator || '').toUpperCase() === String(p.estimator).toUpperCase() ? esc(String(p.estimator).toUpperCase()) : estName(p.estimator, lang);
    const sim = X(lang, `For the correctly specified model and for each level, ${apaInt(p.reps, lang)} data sets of <i>N</i>&nbsp;=&nbsp;${apaInt(p.nSim, lang)} were generated in ${inMplus} ${gen} and analyzed with the hypothesized model using ${simEst}.${cap} CFI was computed for every replication from the chi-square statistics of the hypothesized model and of the baseline model fitted to the same data sets.${noMeans}${lim}${scaled}${mism}`,
      `Doğru belirtilmiş model ve her düzey için ${inMplus} <i>N</i>&nbsp;=&nbsp;${apaInt(p.nSim, lang)} büyüklüğünde ${apaInt(p.reps, lang)} veri seti ${gen} üretilmiş ve hipotez modeli ${simEst} ile bu veri setlerine uydurulmuştur.${cap} CFI her tekrar için, aynı veri setlerine uydurulan hipotez modeli ile temel (bağımsızlık) modelinin ki-kare istatistiklerinden hesaplanmıştır.${noMeans}${lim}${scaled}${mism}`);
    const rule = p.rule === 'sens'
      ? X(lang, `Because the items were ordered categorical, the cutoff for each index and level was chosen, as in dynamic’s functions for categorical items, to keep 95% specificity with the highest sensitivity: starting at 95% and lowering the sensitivity in 1% steps, it was the first quantile of the misspecified-model distribution that still separated it from 95% of the correctly specified replications (McNeish, 2023; McNeish &amp; Wolf, 2024); following the package, no cutoff was reported when the sensitivity fell below 50% (${c.code}). Table 3 also gives the cutoffs by the 95/5 rule with a 90/10 fallback (${c.mwRule}).`,
        `Maddeler sıralı kategorik olduğundan her indeks ve düzey için kesme değeri, dynamic’in kategorik maddelere yönelik fonksiyonlarında olduğu gibi, %95 özgüllüğü en yüksek duyarlılıkla koruyacak biçimde seçilmiştir: duyarlılık %95’ten başlayıp %1 adımlarla düşürülmüş ve yanlış belirtilmiş model dağılımının doğru belirtilmiş tekrarların %95’inden hâlâ ayrıştığı ilk yüzdelik alınmıştır (McNeish, 2023; McNeish ve Wolf, 2024); pakette olduğu gibi duyarlılık %50’nin altına düştüğünde kesme değeri verilmemiştir (${TR(c.code)}). Tablo 3, 90/10 yedekli 95/5 kuralına göre kesme değerlerini de verir (${TR(c.mwRule)}).`)
      : X(lang, `For each index and level, the cutoff was the 5th percentile of the misspecified-model distribution of SRMR and RMSEA (the 95th percentile for CFI) when it separated from 95% of the correctly specified replications (95/5 rule); otherwise the 10th percentile (the 90th for CFI) when it separated from 90% of them (90/10 rule); otherwise no cutoff was available (${c.mwRule}). ${hier
        ? `This is also the rule of dynamic’s hier1HB and hier2 functions (${c.code}). Table 3 also gives the cutoffs that keep 95% specificity with the highest sensitivity (McNeish, 2023; McNeish &amp; Wolf, 2024).`
        : `This is the rule of the published procedure for continuous items; the current code of dynamic’s ${p.type === 'one' ? 'cfaOne' : 'cfaHB'} function uses instead the cutoffs that keep 95% specificity with the highest sensitivity (McNeish, 2023; McNeish &amp; Wolf, 2024; ${c.code}), which Table 3 gives.`}`,
        `Her indeks ve düzey için kesme değeri, SRMR ve RMSEA’da yanlış belirtilmiş model dağılımının 5. yüzdeliği (CFI’da 95. yüzdelik), doğru belirtilmiş tekrarların %95’inden ayrıştığında kullanılmıştır (95/5 kuralı); aksi hâlde %90’ından ayrışan 10. yüzdelik (CFI’da 90.) kullanılmış (90/10 kuralı), o da sağlanmadığında kesme değeri verilmemiştir (${TR(c.mwRule)}). ${hier
        ? `Bu, dynamic’in hier1HB ve hier2 fonksiyonlarının da kuralıdır (${TR(c.code)}). Tablo 3, %95 özgüllüğü en yüksek duyarlılıkla koruyan kesme değerlerini de verir (McNeish, 2023; McNeish ve Wolf, 2024).`
        : `Bu, sürekli maddeler için yayımlanan yöntemin kuralıdır; dynamic’in ${p.type === 'one' ? 'cfaOne' : 'cfaHB'} fonksiyonunun güncel kodu ise %95 özgüllüğü en yüksek duyarlılıkla koruyan kesme değerlerini kullanır (McNeish, 2023; McNeish ve Wolf, 2024; ${TR(c.code)}); bunlar Tablo 3’te verilmiştir.`}`);
    const imp = ctx.policy === 'exclude'
      ? X(lang, 'Replications with improper solutions (e.g., negative residual variances) were excluded; their numbers are given in Table 3.', 'Uygunsuz çözüm veren tekrarlar (ör. negatif artık varyans) dışlanmıştır; sayıları Tablo 3’te verilmiştir.')
      : X(lang, `Replications with improper solutions (e.g., negative residual variances) were retained, as in the dynamic package, which fits the replications without admissibility checks (${c.code}); their numbers are given in Table 3.`, `Uygunsuz çözüm veren tekrarlar (ör. negatif artık varyans), tekrarları kabul edilebilirlik denetimi yapmadan kestiren dynamic paketinde olduğu gibi (${TR(c.code)}) analizde tutulmuştur; sayıları Tablo 3’te verilmiştir.`);
    out.analysis = `<p>${est}${X(lang, `Model fit was evaluated with dynamic fit index (DFI) cutoffs (${c.mwCfa}), which are derived by simulation from the standardized solution of the model at hand rather than taken from fixed cutoffs (Hu &amp; Bentler, 1999).`, `Model uyumu, sabit kesme değerleri (Hu ve Bentler, 1999) yerine incelenen modelin standartlaştırılmış çözümünden simülasyonla türetilen dinamik uyum indeksi (DFI) kesme değerleriyle değerlendirilmiştir (${TR(c.mwCfa)}).`)} ${lv}</p><p>${sim} ${rule} ${imp}</p>`;
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

const pct = (x) => (fin(x) ? `${Math.round(x * 100)}%` : '—');
/**
 * Empirical fit, the dynamic cutoffs by level by the main rule of the study (sum.rule: 'hb' = 95/5 with a 90/10
 * fallback; 'sens' = highest sensitivity at 95% specificity, for ordinal one- and multi-factor models) and Hu &
 * Bentler's fixed cutoffs.
 */
export function fitTable(emp, sum, plan, lang = 'en', lab = ID) {
  if (!sum || !sum.ok) return '';
  const sensRule = sum.rule === 'sens';
  let any90 = false;
  const cell = sensRule
    ? (_c, s) => (fin(s.value) ? `${fit3(s.value)} (${pct(s.sens)})` : 'NONE')
    : (c) => { if (!fin(c.value)) return 'NONE'; if (c.rule === '90/10') { any90 = true; return `${fit3(c.value)}<sup>a</sup>`; } return fit3(c.value); };
  const head = `<tr><th class="tl">${X(lang, 'Model', 'Model')}</th><th class="tl">${X(lang, 'Misspecification', 'Yanlış belirtme')}</th><th>SRMR</th><th>RMSEA</th><th>CFI</th></tr>`;
  const rows = [];
  const mism = !!plan.estMismatch; // observed WLSMV fit, ML cutoffs: shown side by side but not comparable
  const srcEst = esc(plan.srcEstimator || 'WLSMV');
  if (emp && (fin(emp.srmr) || fin(emp.rmsea) || fin(emp.cfi))) {
    rows.push(`<tr><td class="tl">${mism ? X(lang, `Hypothesized model (observed, ${srcEst})`, `Hipotez modeli (gözlenen, ${srcEst})`) : X(lang, 'Hypothesized model (observed)', 'Hipotez modeli (gözlenen)')}</td><td class="tl">—</td><td>${fit3(emp.srmr)}</td><td>${fit3(emp.rmsea)}</td><td>${fit3(emp.cfi)}</td></tr>`);
  }
  rows.push(`<tr class="sub"><td colspan="5">${X(lang, 'Dynamic fit index cutoffs', 'Dinamik uyum indeksi kesme değerleri')}</td></tr>`);
  sum.levels.forEach((l) => rows.push(`<tr><td class="tl">${X(lang, 'Level', 'Düzey')} ${l.level}</td><td class="tl">${levelText(plan, plan.levels[l.level - 1], lang, lab)}</td><td>${cell(l.hb.srmr, l.sens.srmr)}</td><td>${cell(l.hb.rmsea, l.sens.rmsea)}</td><td>${cell(l.hb.cfi, l.sens.cfi)}</td></tr>`));
  if ((sum.slevels || []).length) {
    rows.push(`<tr class="sub"><td colspan="5">${X(lang, 'Structural misspecification (disturbance correlations)', 'Yapısal yanlış belirtme (bozulma korelasyonları)')}</td></tr>`);
    sum.slevels.forEach((l) => rows.push(`<tr><td class="tl">${X(lang, 'Level', 'Düzey')} S${l.level}</td><td class="tl">${levelText(plan, plan.slevels[l.level - 1], lang, lab, true, true)}</td><td>${cell(l.hb.srmr, l.sens.srmr)}</td><td>${cell(l.hb.rmsea, l.sens.rmsea)}</td><td>${cell(l.hb.cfi, l.sens.cfi)}</td></tr>`));
  }
  rows.push(`<tr class="sub"><td colspan="5">${X(lang, 'Fixed cutoffs', 'Sabit kesme değerleri')}</td></tr>`);
  rows.push(`<tr><td class="tl">Hu &amp; Bentler (1999)</td><td class="tl">—</td><td>&le;&nbsp;.08</td><td>&le;&nbsp;.06</td><td>&ge;&nbsp;.95</td></tr>`);
  const ruleEn = sensRule
    ? 'Cutoffs keep 95% specificity, with the sensitivity they reach in parentheses (McNeish, 2023; McNeish &amp; Wolf, 2024); NONE = sensitivity below 50%, as in the package (Wolf &amp; McNeish, 2026)'
    : `Cutoffs follow the 95/5 rule${any90 ? '; <sup>a</sup>90/10 rule' : ''}; NONE = neither the 95/5 nor the 90/10 rule separated the distributions`;
  const ruleTr = sensRule
    ? 'Kesme değerleri %95 özgüllüğü korur; ulaştıkları duyarlılık parantez içindedir (McNeish, 2023; McNeish ve Wolf, 2024); NONE = pakette olduğu gibi duyarlılık %50’nin altında (Wolf ve McNeish, 2026)'
    : `Kesme değerleri 95/5 kuralına göredir${any90 ? '; <sup>a</sup>90/10 kuralı' : ''}; NONE = ne 95/5 ne de 90/10 kuralı dağılımları ayırmıştır`;
  const cum = plan.type === 'one' || (sum.levels.length < 2 && (sum.slevels || []).length < 2) ? '' : X(lang, ' Each level also contains the misspecifications of the lower levels.', ' Her düzey alt düzeylerin yanlış belirtmelerini de içerir.');
  // two caveats of McNeish & Wolf (2023a): the added paths are only a yardstick, and SRMR ≤ .08 has another origin
  const mw = cites(plan).mwCfa;
  const yard = X(lang, ` The added paths are a yardstick for the size of the misfit; they do not show where the model is misspecified. The fixed SRMR cutoff of .08 came from combination rules for other misspecifications, so dynamic SRMR cutoffs are expected to be smaller (${mw}).`,
    ` Eklenen yollar uyumsuzluğun büyüklüğü için bir ölçüttür; modelin nerede yanlış belirtildiğini göstermez. .08 sabit SRMR kesme değeri başka yanlış belirtmeler için birleşik kurallardan gelir; bu yüzden dinamik SRMR kesme değerlerinin daha küçük olması beklenir (${TR(mw)}).`);
  const warnEn = mism ? ` The observed fit was estimated with ${srcEst} for ordinal items, the cutoffs with ML from normal data; the two are not on the same metric and should not be compared.` : '';
  const warnTr = mism ? ` Gözlenen uyum sıralı maddeler için ${srcEst} ile, kesme değerleri normal veride ML ile kestirilmiştir; ikisi aynı ölçekte değildir ve karşılaştırılmamalıdır.` : '';
  const note = X(lang,
    `<i>Note.</i>${warnEn} Values below the cutoff (SRMR, RMSEA) or above it (CFI) indicate misfit smaller than that level of misspecification.${cum}${yard} ${ruleEn}. ${apaInt(plan.reps, lang)} replications per condition; <i>N</i>&nbsp;=&nbsp;${apaInt(plan.nSim, lang)}; ${plan.dataType === 'categorical' ? 'ordinal data' : 'normal data'}, ${esc(plan.estimator)}; improper solutions ${sum.policy === 'exclude' ? 'excluded' : 'retained'}.`,
    `<i>Not.</i>${warnTr} Kesme değerinin altındaki (SRMR, RMSEA) ya da üstündeki (CFI) değerler, uyumsuzluğun o yanlış belirtme düzeyinden küçük olduğunu gösterir.${cum}${yard} ${ruleTr}. Koşul başına ${apaInt(plan.reps, lang)} tekrar; <i>N</i>&nbsp;=&nbsp;${apaInt(plan.nSim, lang)}; ${plan.dataType === 'categorical' ? 'sıralı veri' : 'normal veri'}, ${esc(plan.estimator)}; uygunsuz çözümler ${sum.policy === 'exclude' ? 'dışlandı' : 'tutuldu'}.`);
  return `<table class="rtab" style="width:auto;min-width:440px"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table><p class="tnote">${note}</p>`;
}

/**
 * Simulation conditions: replications, improper solutions and the cutoffs by the other rule of the study (the
 * sensitivity rule at 95% specificity when Table 2 uses 95/5 → 90/10, and vice versa).
 */
export function conditionsTable(sum, plan, lang = 'en') {
  if (!sum || !sum.ok) return '';
  const altHb = sum.rule === 'sens'; // Table 2 shows the sensitivity rule: here the 95/5 → 90/10 rule
  let any90 = false;
  const sc = altHb
    ? (l, k) => { const c = l.hb[k]; if (!fin(c.value)) return 'NONE'; if (c.rule === '90/10') { any90 = true; return `${fit3(c.value)}<sup>a</sup>`; } return fit3(c.value); }
    : (l, k) => { const c = l.sens[k]; return fin(c.value) ? `${fit3(c.value)} (${pct(c.sens)})` : `NONE (${pct(c.sens)})`; };
  const colHead = altHb ? X(lang, 'Cutoff by the 95/5 rule (90/10 fallback)', '95/5 kuralına göre kesme değeri (90/10 yedekli)') : X(lang, 'Cutoff (sensitivity) at 95% specificity', '%95 özgüllükte kesme değeri (duyarlılık)');
  const head = `<tr class="hd"><td class="tl" rowspan="2">${X(lang, 'Condition', 'Koşul')}</td><td rowspan="2">${X(lang, 'Completed', 'Tamamlanan')}</td><td rowspan="2">${X(lang, 'Improper', 'Uygunsuz')}</td><td colspan="3">${colHead}</td></tr><tr class="hd2"><td>SRMR</td><td>RMSEA</td><td>CFI</td></tr>`;
  const l0 = sum.level0;
  const rows = [`<tr><td class="tl">${X(lang, 'Correct model', 'Doğru model')}</td><td>${apaInt(l0.completed, lang)}</td><td>${apaInt(l0.improper, lang)}</td><td>${fit3(l0.spec.srmr)}</td><td>${fit3(l0.spec.rmsea)}</td><td>${fit3(l0.spec.cfi)}</td></tr>`];
  const condRow = (l, lab) => `<tr><td class="tl">${X(lang, 'Level', 'Düzey')} ${lab}</td><td>${apaInt(l.completed, lang)}</td><td>${apaInt(l.improper, lang)}</td><td>${sc(l, 'srmr')}</td><td>${sc(l, 'rmsea')}</td><td>${sc(l, 'cfi')}</td></tr>`;
  sum.levels.forEach((l) => rows.push(condRow(l, l.level)));
  (sum.slevels || []).forEach((l) => rows.push(condRow(l, `S${l.level}`)));
  const one = plan.type === 'one';
  const mwRule = one ? 'McNeish &amp; Wolf, 2023a, 2023b' : 'McNeish &amp; Wolf, 2023';
  const hierEn = plan.type === 'hier' ? '; for higher-order models dynamic reports only the 95/5 rule with a 90/10 fallback of Table 2 (hier1HB, hier2), so this column extends the sensitivity rule to them' : '';
  const hierTr = plan.type === 'hier' ? '; dynamic ikinci düzey modellerde yalnız Tablo 2’deki 90/10 yedekli 95/5 kuralını verir (hier1HB, hier2), bu sütun duyarlılık kuralını bu modellere genişletir' : '';
  const ruleEn = altHb
    ? `For each level, the cutoff by the 95/5 rule with a 90/10 fallback (${mwRule})${any90 ? '; <sup>a</sup>90/10 rule' : ''}; NONE = neither rule separated the distributions.`
    : `For each level, the misspecified-model cutoff that keeps 95% specificity with the highest sensitivity, searched from 95% down in 1% steps (McNeish, 2023; McNeish &amp; Wolf, 2024), the rule of dynamic’s cfaOne, cfaHB, catOne, and catHB functions (Wolf &amp; McNeish, 2026)${hierEn}. Following the package, cutoffs with sensitivity below 50% are suppressed (NONE).`;
  const ruleTr = altHb
    ? `Her düzey için 90/10 yedekli 95/5 kuralına göre kesme değeri (${TR(mwRule)})${any90 ? '; <sup>a</sup>90/10 kuralı' : ''}; NONE = iki kural da dağılımları ayırmamıştır.`
    : `Her düzey için %95 özgüllüğü en yüksek duyarlılıkla koruyan kesme değeri; duyarlılık %95’ten başlayarak %1 adımlarla aranmıştır (McNeish, 2023; McNeish ve Wolf, 2024); bu, dynamic’in cfaOne, cfaHB, catOne ve catHB fonksiyonlarının kuralıdır (Wolf ve McNeish, 2026)${hierTr}. Pakette olduğu gibi duyarlılığı %50’nin altındaki kesme değerleri gösterilmez (NONE).`;
  const note = X(lang,
    `<i>Note.</i> Completed = replications with both the hypothesized and the baseline model estimated (of ${apaInt(plan.reps, lang)}); Improper = replications with a non–positive definite residual or latent covariance matrix (Mplus TECH9). For the correct model the row shows the 95th percentile (5th for CFI), which keeps 95% specificity. ${ruleEn}`,
    `<i>Not.</i> Tamamlanan = hipotez ve temel modelin ikisinin de kestirildiği tekrarlar (${apaInt(plan.reps, lang)} tekrardan); Uygunsuz = artık ya da örtük kovaryans matrisi pozitif tanımlı olmayan tekrarlar (Mplus TECH9). Doğru model satırı %95 özgüllüğü sağlayan 95. yüzdeliği (CFI için 5.) gösterir. ${ruleTr}`);
  return `<table class="rtab" style="width:auto;min-width:440px"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table><p class="tnote">${note}</p>`;
}

// ---------- Results ----------
/**
 * Results paragraphs (HTML). emp = {chisq, df, pvalue, cfi, rmsea, srmr} (may be null), sum = summarizeDfi(),
 * plan = planDfi(), interp = interpret(emp, sum).
 */
export function resultsText(emp, sum, plan, interp, lang = 'en', interpS = null) {
  if (!sum || !sum.ok) return '';
  const K = sum.levels.length;
  const out = [];
  if (emp && fin(emp.cfi)) {
    const chi = fin(emp.chisq) ? `χ<sup>2</sup>(${apaInt(emp.df, lang)})&nbsp;=&nbsp;${apaNum(emp.chisq)}, <i>p</i>&nbsp;${nbp(emp.pvalue)}, ` : '';
    out.push(X(lang, `The hypothesized model yielded ${chi}CFI&nbsp;=&nbsp;${fit3(emp.cfi)}, RMSEA&nbsp;=&nbsp;${fit3(emp.rmsea)}, and SRMR&nbsp;=&nbsp;${fit3(emp.srmr)}.`,
      `Hipotez modeli için ${chi}CFI&nbsp;=&nbsp;${fit3(emp.cfi)}, RMSEA&nbsp;=&nbsp;${fit3(emp.rmsea)} ve SRMR&nbsp;=&nbsp;${fit3(emp.srmr)} bulunmuştur.`));
    // the chi-square test of exact fit comes first; the dynamic cutoffs describe the size of the misfit (McNeish &
    // Wolf, 2023a: the four interpretation bins)
    if (chi && fin(emp.pvalue)) {
      const mw = cites(plan).mwCfa;
      out.push(emp.pvalue < 0.05 && plan && plan.estMismatch
        ? X(lang, 'The chi-square test rejected exact fit.', 'Ki-kare testi tam uyumu reddetmiştir.')
        : emp.pvalue < 0.05
        ? X(lang, `The chi-square test rejected exact fit, so the dynamic cutoffs serve to judge how large the misfit is (${mw}).`, `Ki-kare testi tam uyumu reddetmiştir; dinamik kesme değerleri uyumsuzluğun ne kadar büyük olduğunu değerlendirmeye yarar (${TR(mw)}).`)
        : X(lang, `The chi-square test did not reject exact fit (${mw}).`, `Ki-kare testi tam uyumu reddetmemiştir (${TR(mw)}).`));
    }
    const NAMES = { srmr: 'SRMR', rmsea: 'RMSEA', cfi: 'CFI' };
    // one phrase per index: where the observed value falls among the cutoffs of the levels (pre = '' or 'S')
    // one phrase per index: where the observed value falls among the levels that have a cutoff (pre = '' or 'S');
    // NONE levels are skipped, so "every level" means every level with a cutoff
    const phrases = (ip, KK, pre) => (ip || []).filter((x) => fin(x.value) && x.any).map((x) => {
      const nm = NAMES[x.idx];
      const trL = (k) => (pre ? `${pre}${k} düzeyi` : `${k}. düzey`);
      const verb = x.idx === 'cfi' ? 'fell below' : 'exceeded';
      if (x.beyond === 0) {
        const i = x.cut.findIndex(fin);
        return X(lang, `${nm} was within the Level-${pre}${i + 1} cutoff (${fit3(x.cut[i])})`, `${nm}, ${trL(i + 1)} kesme değerinin (${fit3(x.cut[i])}) içinde kalmıştır`);
      }
      const next = x.cut.findIndex((c, i) => i >= x.beyond && fin(c)); // the next level with a cutoff
      if (next < 0 && x.cut.filter(fin).length === 1) {
        return X(lang, `${nm} ${verb} the Level-${pre}${x.top} cutoff (${fit3(x.cut[x.top - 1])})`, `${nm}, ${trL(x.top)} kesme değerini (${fit3(x.cut[x.top - 1])}) aşmıştır`);
      }
      if (next < 0) {
        const every = x.cut.every(fin) ? X(lang, 'every level', 'bütün düzeylerin') : X(lang, 'every level with a cutoff', 'kesme değeri olan bütün düzeylerin');
        return X(lang, `${nm} ${verb} the cutoff of ${every} (Level ${pre}${x.top}: ${fit3(x.cut[x.top - 1])})`, `${nm} ${every} kesme değerini aşmıştır (${trL(x.top)}: ${fit3(x.cut[x.top - 1])})`);
      }
      return X(lang, `${nm} ${verb} the Level-${pre}${x.beyond} cutoff (${fit3(x.cut[x.beyond - 1])}) but not the Level-${pre}${next + 1} cutoff`, `${nm}, ${trL(x.beyond)} kesme değerini (${fit3(x.cut[x.beyond - 1])}) aşmış, ${trL(next + 1)} kesme değerini aşmamıştır`);
    });
    const kind = plan.type === 'one' ? X(lang, 'residual-correlation ', 'artık korelasyon ') : X(lang, 'cross-loading ', 'çapraz yük ');
    // observed WLSMV fit against ML cutoffs (the "as dynamic" option): different metrics, so no comparison at all
    const mism = !!(plan && plan.estMismatch);
    if (mism) out.push(X(lang, `Because the observed indices were estimated with ${esc(plan.srcEstimator || 'WLSMV')} for ordered categorical items, whereas the cutoffs in Table 2 were derived with ML from normal data, the two are not on the same metric; the cutoffs are given for comparison with the dynamic package only and were not used to judge the fit of the model.`,
      `Gözlenen indeksler sıralı kategorik maddeler için ${esc(plan.srcEstimator || 'WLSMV')} ile, Tablo 2’deki kesme değerleri ise normal veride ML ile elde edildiğinden ikisi aynı ölçekte değildir; kesme değerleri yalnızca dynamic paketiyle karşılaştırma için verilmiş, modelin uyumunu değerlendirmede kullanılmamıştır.`));
    const parts = mism ? [] : phrases(interp, K, '');
    if (parts.length) out.push(X(lang, `Compared with the dynamic cutoffs in Table 2, ${listJoin(parts, lang)}.`, `Tablo 2’deki dinamik kesme değerleriyle karşılaştırıldığında ${listJoin(parts, lang)}.`));
    const all = mism ? [] : (interp || []).filter((x) => fin(x.value) && x.any);
    const tops = [...new Set(all.map((x) => x.top))];
    if (all.length && all.every((x) => x.beyond === 0 && fin(x.cut[0]))) out.push(X(lang, `The misfit of the model is therefore smaller than the smallest ${kind}misspecification considered.`, `Dolayısıyla modelin uyumsuzluğu, ele alınan en küçük ${kind}yanlış belirtmesinden daha küçüktür.`));
    else if (all.length && all.every((x) => x.beyond === x.top)) out.push(X(lang, `The misfit of the model is therefore at least as large as the largest ${kind}misspecification considered${tops.length === 1 ? ` (Level ${tops[0]})` : ''}; the sources of misfit deserve a closer look (e.g., modification indices, cross-loadings, residual correlations).`, `Dolayısıyla modelin uyumsuzluğu, ele alınan en büyük ${kind}yanlış belirtmesi${tops.length === 1 ? ` (${tops[0]}. düzey)` : ''} kadar ya da ondan büyüktür; uyumsuzluğun kaynakları (ör. modifikasyon indeksleri, çapraz yükler, artık korelasyonlar) ayrıca incelenmelidir.`));
    const sparts = mism ? [] : phrases(interpS, (sum.slevels || []).length, 'S');
    if (sparts.length) out.push(X(lang, `For the structural misspecification, ${listJoin(sparts, lang)}.`, `Yapısal yanlış belirtme için ${listJoin(sparts, lang)}.`));
    const hb = [emp.cfi >= 0.95, emp.rmsea <= 0.06, emp.srmr <= 0.08];
    const met = hb.filter(Boolean).length;
    out.push(X(lang, `By the fixed cutoffs of Hu and Bentler (1999), the model met ${met === 3 ? 'all three' : met === 0 ? 'none of the three' : `${numWord(met, lang)} of the three`} criteria (CFI&nbsp;&ge;&nbsp;.95, RMSEA&nbsp;&le;&nbsp;.06, SRMR&nbsp;&le;&nbsp;.08).`, `Hu ve Bentler’in (1999) sabit kesme değerlerine göre model üç ölçütün ${met} tanesini karşılamıştır (CFI&nbsp;&ge;&nbsp;.95, RMSEA&nbsp;&le;&nbsp;.06, SRMR&nbsp;&le;&nbsp;.08).`));
  } else {
    out.push(X(lang, 'The dynamic cutoffs of the model are reported in Table 2; the observed fit of the model was not available for comparison.', 'Modelin dinamik kesme değerleri Tablo 2’de verilmiştir; karşılaştırma için modelin gözlenen uyumu mevcut değildir.'));
  }
  // second paragraph: the simulation itself (improper solutions, Figure 1)
  const sim = [];
  const allLv = [...sum.levels, ...(sum.slevels || [])];
  const imp = allLv.reduce((a, l) => a + l.improper, 0), comp = allLv.reduce((a, l) => a + l.completed, 0);
  const l0 = sum.level0 || { improper: 0, completed: 0 };
  const sh0 = l0.improper > 0 && l0.completed ? Math.round((l0.improper / l0.completed) * 100) : 0;
  const how = sum.policy === 'exclude' ? X(lang, 'excluded from', 'dışlanmıştır') : X(lang, 'retained in', 'tutulmuştur');
  if (imp > 0) {
    const share = comp ? Math.round((imp / comp) * 100) : 0;
    sim.push(X(lang, `In the misspecified conditions, ${share}% of the replications ended in improper solutions${l0.improper > 0 ? `, and ${sh0}% in the correct model` : ''} (Table 3); they were ${how} the cutoff distributions.`, `Yanlış belirtilmiş koşullarda tekrarların %${share}’i${l0.improper > 0 ? `, doğru modelde %${sh0}’i` : ''} uygunsuz çözümle sonuçlanmıştır (Tablo 3); bu tekrarlar kesme değeri dağılımlarında ${how}.`));
  } else if (l0.improper > 0) {
    sim.push(X(lang, `In the correct model, ${sh0}% of the replications ended in improper solutions (Table 3); they were ${how} the cutoff distributions.`, `Doğru modelde tekrarların %${sh0}’i uygunsuz çözümle sonuçlanmıştır (Tablo 3); bu tekrarlar kesme değeri dağılımlarında ${how}.`));
  }
  // excluding improper solutions can leave too few replications for a cutoff (e.g., a Heywood case at every level)
  const empty = sum.policy === 'exclude' ? [sum.level0, ...allLv].filter((l) => l && l.used < 2) : [];
  if (empty.length) sim.push(X(lang, `In ${empty.length === 1 ? 'one condition' : `${numWord(empty.length, lang)} conditions`}, (nearly) all replications were improper, so no cutoff could be computed after excluding them.`, `${empty.length} koşulda tekrarların (neredeyse) tamamı uygunsuz olduğundan, bunlar dışlandıktan sonra kesme değeri hesaplanamamıştır.`));
  sim.push(X(lang, 'Figure 1 shows the distributions of the fit indices under the correct and the misspecified models.', 'Şekil 1, doğru ve yanlış belirtilmiş modellerde uyum indekslerinin dağılımlarını göstermektedir.'));
  return `<p>${out.join(' ')}</p><p>${sim.join(' ')}</p>`;
}

// ---------- References ----------
/** References of the study (APA 7). ctx = {plan, version} */
export function references(ctx = {}, lang = 'en') {
  const p = ctx.plan;
  const one = p && p.type === 'one';
  const sem = 'Structural Equation Modeling: A Multidisciplinary Journal';
  const list = [];
  if (!p || p.type !== 'one') list.push(`Hancock, G. R., &amp; Mueller, R. O. (2001). Rethinking construct reliability within latent variable systems. In R. Cudeck, S. du Toit, &amp; D. Sörbom (Eds.), <i>Structural equation modeling: Present and future—A Festschrift in honor of Karl Jöreskog</i> (pp. 195–216). Scientific Software International.`);
  list.push(`Hu, L., &amp; Bentler, P. M. (1999). Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives. <i>${sem}, 6</i>(1), 1–55. https://doi.org/10.1080/10705519909540118`);
  list.push(`McNeish, D. (2023). Dynamic fit index cutoffs for categorical factor analysis with Likert-type, ordinal, or binary responses. <i>American Psychologist, 78</i>(9), 1061–1075. https://doi.org/10.1037/amp0001213`);
  if (p && p.type === 'hier') list.push(`McNeish, D., &amp; Manapat, P. D. (2024). Dynamic fit index cutoffs for hierarchical and second-order factor models. <i>${sem}, 31</i>(1), 27–47. https://doi.org/10.1080/10705511.2023.2225132`);
  list.push(`McNeish, D., &amp; Wolf, M. G. (${one ? '2023a' : '2023'}). Dynamic fit index cutoffs for confirmatory factor analysis models. <i>Psychological Methods, 28</i>(1), 61–88. https://doi.org/10.1037/met0000425`);
  if (one) list.push(`McNeish, D., &amp; Wolf, M. G. (2023b). Dynamic fit index cutoffs for one-factor models. <i>Behavior Research Methods, 55</i>(3), 1157–1174. https://doi.org/10.3758/s13428-022-01847-y`);
  list.push(`McNeish, D., &amp; Wolf, M. G. (2024). Direct discrepancy dynamic fit index cutoffs for arbitrary covariance structure models. <i>${sem}, 31</i>(5), 835–862. https://doi.org/10.1080/10705511.2024.2308005`);
  list.push(`Muthén, L. K., &amp; Muthén, B. O. (1998–2017). <i>Mplus user’s guide</i> (${X(lang, '8th ed.', '8. bs.')}). Muthén &amp; Muthén.`);
  list.push(`Wolf, M. G., &amp; McNeish, D. (2023). dynamic: An R package for deriving dynamic fit index cutoffs for factor analysis. <i>Multivariate Behavioral Research, 58</i>(1), 189–194. https://doi.org/10.1080/00273171.2022.2163476`);
  list.push(`Wolf, M. G., &amp; McNeish, D. (2026). <i>dynamic: DFI cutoffs for latent variable models</i> (Version 1.1.0, commit 90aa51f) [${X(lang, 'Computer software', 'Bilgisayar yazılımı')}]. GitHub. https://github.com/melissagwolf/dynamic`);
  return `<div class="refs">${list.map((x) => `<p>${x}</p>`).join('')}</div>`;
}
