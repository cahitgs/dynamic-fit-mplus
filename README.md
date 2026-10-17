# Dynamic Fit for Mplus

Dynamic fit index (DFI) cutoffs for confirmatory and second-order factor models, simulated with **Mplus** on your own computer.

How large SRMR, RMSEA and CFI become under a given misspecification depends on the model, its loadings and the sample size, so fixed cutoffs such as CFI ≥ .95 (Hu & Bentler, 1999) do not mean the same thing for every model. The dynamic fit index approach (McNeish & Wolf, 2023a) derives the cutoffs by simulation from the model at hand. Dynamic Fit for Mplus runs that simulation with Mplus Monte Carlo, so the cutoffs use the fit index definitions of the Mplus output you report. As in dynamic, the simulated data are analyzed with ML (normal data) or WLSMV (ordinal data). While you work, it writes an APA 7 draft of the method and the results.

![The Report step: the paper with the dynamic cutoffs and the distribution figure](docs/img/report.png)

## What it does

- **Three ways in:** raw data (CSV; the app fits the CFA in Mplus first), an Mplus output file (`.out` with `OUTPUT: STDYX;`), or standardized estimates typed in from a paper.
- **Models:** one-factor, multi-factor and second-order CFA. Continuous items are simulated as multivariate normal and analyzed with ML. Ordinal items are generated from the estimated thresholds and analyzed with WLSMV.
- **Misspecifications as in the dynamic R package** (Wolf & McNeish, 2023):
  - Multi-factor and second-order models: omitted cross-loadings (McNeish & Wolf, 2023a; McNeish & Manapat, 2024).
  - One-factor models: omitted residual correlations of .30 (McNeish & Wolf, 2023b).
- **CFI for every replication.** Mplus 8.3 does not report CFI for Monte Carlo studies (McNeish & Wolf, 2023a, Appendix B). The app therefore runs every condition a second time with the baseline model on the same seed, and computes CFI from the two chi-square statistics as Mplus does.
- **Improper solutions are counted.** Replications whose residual or latent covariance matrix is not positive definite (Mplus TECH9) are reported for every condition. You choose whether they are retained, as in dynamic, or excluded.
- **Two cutoff rules, both reported:**
  - Table 2: the 95/5 rule with a 90/10 fallback (McNeish & Wolf, 2023a, 2023b; dynamic's `hier1HB`).
  - Table 3: the highest sensitivity that keeps 95% specificity, reported as NONE below 50% sensitivity (McNeish, 2023; McNeish & Wolf, 2024; dynamic's `cfaOne`, `cfaHB`, `catOne` and `catHB` on GitHub, commit 90aa51f).
- **Every Mplus file is readable in the app.** Inputs and outputs open in a side sheet. Errors, warnings and improper solutions are highlighted, and a bar jumps to the fit, results, STDYX and TECH9 sections.
- **Report:**
  - Method and results text.
  - Tables: loadings, fit against the dynamic cutoffs, and simulation conditions.
  - A figure of the fit index distributions, in black and white or in color.
  - References.
  - Export: print, HTML download, and a CSV of every replication.

Your data stay on your computer: the server listens only on localhost, runs Mplus there and uploads nothing. The interface loads Tailwind CSS and its fonts from public CDNs, so it needs an internet connection to display correctly.

## Requirements

- Windows with **Mplus 8.x** (tested with Mplus 8.3). The full version is needed for realistic models: the free demo is limited to 6 dependent variables.
- Nothing else for the Windows app. To run from source you need Node.js 18 or newer; there are no npm packages to install.

## Get started

### Windows app (no installation)

1. Download `DynamicFitMplus.exe` from [Releases](https://github.com/cahitgs/dynamic-fit-mplus/releases/latest).
2. Double-click it. A console window opens and the app opens in your browser (http://localhost:3401, or the next free port).
   - The file is not signed, so Windows SmartScreen may warn the first time. Choose **More info → Run anyway**.
3. Your projects are saved in a `projects` folder next to the `.exe`.
4. To stop the app, close the console window.

### From source

```
git clone https://github.com/cahitgs/dynamic-fit-mplus.git
cd dynamic-fit-mplus
node serve.mjs --open
```

On Windows you can also double-click `baslat.bat`. Set `MPLUS_PATH` if Mplus is not in `C:\Program Files\Mplus`.

## How it works

1. **Data:** choose raw data, an Mplus output or typed-in estimates. A sample data set and the A-SAGS example (Boivin et al., 2026) are included.
2. **Structure:** assign items to factors, optionally with a second-order factor, or check the structure read from the output.
3. **Settings:**
   - Response format: ordinal or normal data.
   - Replications: 500 by default.
   - Improper solutions: retain or exclude.
4. **Run:** for the correct model and for each misspecification level, Mplus runs two Monte Carlo inputs:
   - the hypothesized model;
   - the baseline model, which gives CFI.

   The sample size is capped at 2,000, as in dynamic. Two runs work at the same time.
5. **Report:** the paper fills in as the runs finish. Every number in it is computed from the Mplus outputs and the estimates you entered.

## Validation

- **Misspecifications:** the app adds the same cross-loadings as dynamic's `multi_add_HB` and `multi_add_hier` (item, target factor and magnitude) and the same residual-correlation pairs as `one_add`. This was checked on the package's own examples and further test models, including models with negative loadings.
- **Cutoff rules:** applied to dynamic's own simulated fit distributions, the app's two rules reproduce every cutoff that dynamic prints (33 of 33 cells).
- **Appendix B of McNeish & Wolf (2023a):** with the same Mplus options (`MODEL = NOMEANSTRUCTURE; INFORMATION = EXPECTED;`) and seed (1981), the app's Monte Carlo inputs reproduce the appendix's simulation replication by replication.
- **Self-test:** `node tools/engine-test.mjs` checks the engine, runs the sample CFA in Mplus in an ASCII folder, a folder with Turkish letters and spaces, and through an ASCII temporary copy, runs a short ordinal DFI, and reproduces a 500-replication reference DFI of the A-SAGS model (`--quick` skips the reference DFI).

## Notes on fit index definitions

- **SRMR and the mean structure.** Under ML, Mplus estimates the mean structure by default, and its SRMR then also averages over the (zero) mean residuals. With 15 items, for example, it is √(120/135) ≈ .943 times the SRMR without the mean structure. dynamic and lavaan's defaults use no mean structure.
  - The app simulates under the specification of your model: if your `.out` was fit with `MODEL = NOMEANSTRUCTURE`, the simulation is too.
  - Compare an SRMR only with cutoffs derived under the same specification.
- **WLSMV.** RMSEA and CFI are the values Mplus reports, which are based on the mean- and variance-adjusted chi-square.

## Limitations

- **Model types:** single-group CFA and second-order models only. Bifactor, structural (ON) and multiple-group models are not supported.
- **Second-order models:** structural misspecification (omitted disturbance correlations; `hier2` in dynamic) is not implemented.
- **Data:** continuous data are simulated as multivariate normal. Missing-data patterns and non-normality are not reproduced.
- **Signs:** as in dynamic, added cross-loadings are positive (see dynamic issue #7). Recode reverse-worded items before the analysis.
- **Names:** Mplus variable names can have at most 8 characters.

## How to cite

Cite the method papers and the software:

> Marangoz, M. C. (2026). *Dynamic Fit for Mplus* (Version 1.0.0) [Computer software]. https://github.com/cahitgs/dynamic-fit-mplus

## References

- Boivin, T. L. D., Veilleux, C., Egerton-Graham, M., Caron, P.-O., & Gaudreau, P. (2026). A tutorial on evaluating confirmatory factor analysis with lavaan and dynamic: Integrating statistical and conceptual approaches. *The Quantitative Methods for Psychology, 22*(1), 9–24. https://doi.org/10.20982/tqmp.22.1.p009
- Hu, L., & Bentler, P. M. (1999). Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives. *Structural Equation Modeling: A Multidisciplinary Journal, 6*(1), 1–55. https://doi.org/10.1080/10705519909540118
- McNeish, D. (2023). Dynamic fit index cutoffs for categorical factor analysis with Likert-type, ordinal, or binary responses. *American Psychologist, 78*(9), 1061–1075. https://doi.org/10.1037/amp0001213
- McNeish, D., & Manapat, P. D. (2024). Dynamic fit index cutoffs for hierarchical and second-order factor models. *Structural Equation Modeling: A Multidisciplinary Journal, 31*(1), 27–47. https://doi.org/10.1080/10705511.2023.2225132
- McNeish, D., & Wolf, M. G. (2023a). Dynamic fit index cutoffs for confirmatory factor analysis models. *Psychological Methods, 28*(1), 61–88. https://doi.org/10.1037/met0000425
- McNeish, D., & Wolf, M. G. (2023b). Dynamic fit index cutoffs for one-factor models. *Behavior Research Methods, 55*(3), 1157–1174. https://doi.org/10.3758/s13428-022-01847-y
- McNeish, D., & Wolf, M. G. (2024). Direct discrepancy dynamic fit index cutoffs for arbitrary covariance structure models. *Structural Equation Modeling: A Multidisciplinary Journal, 31*(5), 835–862. https://doi.org/10.1080/10705511.2024.2308005
- Wolf, M. G., & McNeish, D. (2023). dynamic: An R package for deriving dynamic fit index cutoffs for factor analysis. *Multivariate Behavioral Research, 58*(1), 189–194. https://doi.org/10.1080/00273171.2022.2163476

## License

GNU Affero General Public License v3.0 (see `LICENSE`). The misspecification and cutoff rules are ported from the [dynamic](https://github.com/melissagwolf/dynamic) R package by Melissa G. Wolf and Daniel McNeish, which is licensed under AGPL-3.

Dynamic Fit for Mplus is an independent project. It is not affiliated with Muthén & Muthén (Mplus) or with the authors of dynamic.
