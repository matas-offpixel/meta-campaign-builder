# Session log — evaluation window

## PR

- **Number:** 875
- **URL:** 875
- **Branch:** `cursor/optimisation-evaluation-window`

## Summary

Evidence from 2 days of prod shadow (7 armed campaigns): every `cpr`/`cpa`
campaign produced zero decisions — "No cpr data in the 24h window" on every
row. Traffic (lpv_cost) campaigns worked fine (10/10). Root cause: at
£5.56/day split across ~19 ad sets, each ad set sees < £0.30/day. At CPR
£1–2 that is < 1 conversion per day per ad set, so 24h always yields zero
conversions.

This PR introduces per-metric evaluation windows and a minimum-evidence
threshold so conversion-metric campaigns can evaluate without acting on
noise.

## Inventory answers

**Where the window is set:** `primaryWindowFor()` in `tick-runner.ts` reads
`rule.timeWindow` from the campaign's Optimisation Strategy settings, defaulting
to `"24h"`. Single call site for both ABO and CBO paths — the same `window`
value is passed to `fetchInsights` and `fetchCampaignInsights`.

**Is the window shared across ABO, CBO, and cross-channel?** Yes — one
`primaryWindowFor()` call produces the window and the same value is threaded
through all three paths within the campaign loop.

**Meta `date_preset` values available:** confirmed in `live-metric.ts`'s test
suite (`META_VALID_DATE_PRESETS` set, sourced from the 2026-08-18 Graph API
error). `"yesterday"` (24h), `"last_3d"` (3d), `"last_7d"` (7d) are all
valid. `"last_1d"` is NOT valid — we learned this the hard way (2026-08-18
shadow-cron incident).

**Call volume:** `last_7d` is a single field expansion call, identical in
cost to `yesterday`. No per-day fan-out. Unchanged per-tick call count.

## Window constants and justification

Defined in `lib/optimisation/evaluate-windows.ts` (new file):

| Metric class | Metrics | Window | Justification |
|---|---|---|---|
| Fast / volume | `lpv_cost`, `cpc`, `cpm`, `ctr` | 24h (unchanged) | Proven in prod — 10/10 decisions in 2-day shadow. Plentiful events at any budget. |
| Sparse / conversion | `cpr`, `cpa`, `roas` | 7d | At £5.56/day/ad-set, CPR £1–2 → < 1 conversion/day. 7d = `last_7d` (valid preset). Gives 7× the signal. |

`primaryWindowFor()` now uses `maxWindow(rule.timeWindow, defaultWindowForMetric(metric))` so:
- A `cpr` rule still set to `24h` by the operator → effective `7d` (metric default wins).
- A `cpr` rule the operator deliberately set to `3d` → effective `7d` (metric default still wins — no window shorter than 7d for conversion metrics).
- An `lpv_cost` rule at `24h` → stays `24h` (unchanged).

## Minimum-evidence threshold

`MIN_CONVERSION_RESULT_COUNT = 5` (named constant in `evaluate-windows.ts`).

Applies when `liveMetric.resultCount !== null`. `resultCount` comes from Meta's
`actions` field (raw counts, not `cost_per_action_type` rates). It is null for
direct-field metrics (cpm, cpc, ctr) — those skip the check entirely.

New `AutomationAction`: `"insufficient_conversions"` — distinct from
`"maintain"` so the reason is never hidden. The `reason_text` says
`"3/5 conversions in the 7d window — insufficient evidence"` so the
operator can see exactly how close the ad set is.

## Cooldown change

**Before:** `DEFAULT_COOLDOWN_HOURS = 24`. Used for all metrics.

**After:** `effectiveCooldownHours(window, configuredHours) = max(configuredHours ?? windowHours, windowHours)`.

- `cpr` / `cpa` at 7d window: effective cooldown = **168h** (7 days). A budget
  change made on day D is still inside the 7d measurement window for the next
  6 evaluations. Stacking changes in that window would corrupt the metric.
- `lpv_cost` at 24h: effective cooldown = **24h** (unchanged).
- User-configured `cooldownHours: 48` for a 7d metric: effective = max(48, 168) = 168h (window floor wins).
- User-configured `cooldownHours: 336` for a 7d metric: effective = 336h (user value honored — above floor).

Rolling-window caution (noted in code comment): the same conversion appears
in every overlapping 7d fetch. No "N consecutive scale_up" logic exists or
will be added — `evaluate-windows.ts` has a comment that names this risk.

## Before/after decision counts (FOLMAOUR shape)

**Before (24h window, no minimum evidence):**
- 19 CBO ad sets, each with 0 conversions in 24h → `metric_unavailable` (or
  old no-op string) for every row. 0 actionable decisions.

**After (7d window, minimum evidence = 5):**
- With 38 campaign-grain conversions in 7d at CPR £0.80 → `scale_up +20%`.
- With < 5 conversions in 7d → `insufficient_conversions` with count in
  `reason_text` (still recorded, not silently skipped).
- The FOLMAOUR test fixture (19 CBO ad sets, `folmourCampaignInsight(38, 0.8)`)
  produces 1 real `scale_up` decision where it previously produced 0.

## Surfacing: result count in chip

- `LiveMetricReading` gains `resultCount: number | null`.
- `DecisionToInsert` gains optional `resultCount?: number | null`, serialised
  into `meta_response_json` alongside `channel` (no migration needed —
  existing `meta_response_json` jsonb column absorbs it).
- `DecisionRowView` gains `resultCount: number | null` and `metricWindow: string`
  (from the `metric_window` DB column).
- `AutomationDecisionsList` chip now shows `cpr 1.72 from 38 / 7d` format.
- `insufficient_conversions` rows show an `InfoTip` (same as `metric_unavailable`).

## Scope / files

- `lib/optimisation/evaluate-windows.ts` — **new**: all named constants and helpers
- `lib/optimisation/live-metric.ts` — `AdSetInsightMetrics.actionCountByType` (optional field); `LiveMetricReading.resultCount`; `resolvePrimaryLiveMetric` returns resultCount
- `lib/optimisation/insights-fetch.ts` — parse `actions` into `actionCountByType`
- `lib/optimisation/evaluate.ts` — `insufficient_conversions` action; min-evidence check; `effectiveCooldownHours` for cooldown-≥-window
- `lib/optimisation/tick-runner.ts` — `primaryWindowFor` uses `defaultWindowForMetric`+`maxWindow`; outer cooldown uses `effectiveCooldownHours`; `resultCount` flows through `DecisionToInsert`
- `lib/optimisation/cross-channel.ts` — `resultCount: null` on cross-channel `liveMetric` (no action counts from event_daily_rollups)
- `lib/db/campaign-automation-decisions.ts` — `mergeInsightJson` includes `resultCount`
- `lib/optimisation/automation-ui.ts` — `DecisionRowView` adds `resultCount`, `metricWindow`; `DecisionRowInput` adds `metric_window`; `presentDecisionRow` extracts both
- `components/optimisation/automation-decisions-list.tsx` — chip shows `from N / Xd`
- `lib/optimisation/__tests__/evaluation-window.test.ts` — **new**: 41 tests
- Various existing test files — updated for `actionCountByType` and `resultCount` shape changes

## Validation

- [x] `npm run build` — clean (pre-existing warning on unrelated route only)
- [x] `npm test` — 4800 tests, 4796 pass, 1 pre-existing failure (D2C brief-parser date: hardcoded 2026 vs today being Sep 2026 → parser generates 2027; unrelated to this PR, pre-dates this branch)
- [x] All optimisation + insights tests: 200/200 pass
- [x] New evaluation-window test suite: 41/41 pass

## Notes

- No migration needed — `resultCount` lives in the existing `meta_response_json` jsonb column.
- No new killswitch — three-gate write pattern untouched.
- Cross-channel stays shadow-only (existing constraint, unchanged).
- The `DEFAULT_COOLDOWN_HOURS = 24` constant is retained in `evaluate.ts` for
  backwards compatibility (existing tests reference it); it's no longer the
  primary cooldown source (`effectiveCooldownHours` is).
