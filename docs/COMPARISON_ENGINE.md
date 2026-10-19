# Comparison Engine v2

`GET /api/v1/catalog/compare?ids=a,b[,c,d][&priorities={...}][&lang=fr|en]`
(alias `/api/v1/products/compare`). Code: `server/modules/catalog/domain/comparison/`.

## Pipeline

| Step | Module | What it does |
|---|---|---|
| Adapt | `productAdapter.js` | Curated, seed, database and store entries → one canonical shape. Never fills gaps. |
| Classify | `productTypes.js` | Product **type** (fair to rank together) and **family** (shares some specs). |
| Identify | `productIdentity.js` | Groups catalogue copies ("(#4)") into one product; offers are per seller. |
| Extract | `specParsers.js`, `chipIndex.js`, `categoryProfiles.js`, `specExtractor.js` | French/English spec text → typed values with `source` and `confidence`. |
| Market | `categoryStats.js`, `scoring.js` | Per-type distributions, template detection, ln(price)~quality curve. Built once at first request (~120 ms). |
| Analyse | `analysis.js`, `unitCosts.js` | Comparability, scoring basis, ranking, dominance, sensitivity, unit costs. |
| Explain | `verdict.js`, `format.js` | Evidence-backed sentences in EN/FR, each with its `data`. |
| Orchestrate | `ComparisonEngineV2.js` | Runs the above; returns v1 fields plus `analysis`. |

## Trust rules

- **Unknown stays unknown.** A spec missing for any product in the set is not scored (`analysis.basis.partial`). An unmentioned feature is unknown, not "no".
- **Percentiles, not magic numbers.** A dimension score is the product's percentile in its type when the type has ≥ 5 products with variety (`basis: 'category'`), else relative to the set (`'set'`).
- **Template text is ignored.** A number shared by ≥ 80 % of a type ("Jusqu'à 18h" on every laptop) is not used to rank. A yes/no feature is ignored only if every product has the same value.
- **Contradicting copies are flagged.** If copies of a product disagree on a spec, the comparison warns and that spec is kept out of market statistics.
- **Market value only from a trusted curve.** The model needs n ≥ 8, a positive slope and R² ≥ 0.25; otherwise `analysis.market.valueCurveUnavailable` says why.
- **No recommendation when it would be hollow:**
  - unrelated kinds (`level: 'limited'`);
  - products mixed with stores or stays (`'none'`);
  - fewer than two products (`'insufficient'`);
  - only price in common (`rankingWithheld: 'no-shared-specs'`);
  - nobody wins a spec or the price outright (`'equivalent'`).
- **No padding.** `matchPercentage` is the winner's real 0–100 weighted score. `decisiveness` is `clear`, `leaning` or `close`, from re-ranking on each priority alone.
- **No invented commerce.** Placeholder stock is `stockUnits: null, stockKnown: false`. Sellers are real offers. Unknown ids come back in `unresolved` with a reason, never as a synthesised product.
- **Approximate chip index.** Processors are compared through rounded public Geekbench 6 multi-core medians (`chipIndex.js`, versioned). The verdict names the chips and never quotes a percentage gap between them.

## Priorities

Facets 0–5 (3 = neutral):

`price`, `performance`, `battery`, `display`, `portability`, `warranty`, `camera`, `audio`, `capacity`, `durability`, `connectivity`, `fit`, `reputation`, `trust`, `value`

`value` weights the price-vs-market score. Unknown keys (e.g. `delivery`, which has no data yet) come back in `recommendation.prioritiesIgnored`.

## Tools

- `node scripts/comparison_coverage_report.js [--type=smartphone] [--missing]`: how often each spec is found per type.
- `node scripts/comparison_benchmark.js`: latency over every same-type catalogue pair, plus invariant checks.
- Tests: `tests/unit/comparison_{spec_parsers,market_stats,engine}.test.js`, `tests/integration/comparison_endpoints.test.js`.

## Adding a product type

1. Add a rule in `productTypes.js`.
2. Add a profile in `categoryProfiles.js`, reusing a dimension builder or adding one with a parser in `specParsers.js`.
3. Optionally add a unit-cost metric in `unitCosts.js` and a plural label in `verdict.js`.
4. Run the coverage report and the benchmark.

## Compare screens

`/compare` (tray) and `/compare/results` (verdict) render only what the engine returns.

- **Controller** (`build_redesign.py` → shell):
  - `runCompare` sends the tray, the chosen priority (5, every other facet 1) and the page language, and drops stale answers.
  - `_enterCompare` is the route loader for both screens, so deep links and refreshes also run the engine.
  - There is no offline fallback: without the API the screen says the comparison is unavailable.
- **View model** (`src/services/compareView.js`, outside the shell for its size budget): pure formatting from the response. Unit-tested in `tests/unit/compare_view.test.js`.
- **Styles**: `src/styles/compare.css`, layered over the shell's `cmp-*` rules.
- **Buying**:
  - "Add" appears only for `orderable` products (curated catalogue or live listings) and adds the exact offer listing at the price shown.
  - The sticky bar adds the winner's cheapest offer.
  - Demo seed items and shops are never added to the bag.
- **Presets and default tray** use real catalogue ids.
