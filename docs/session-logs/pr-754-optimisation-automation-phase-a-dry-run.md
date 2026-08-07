# Session log — Optimisation Strategy automation loop, PR A: dry-run evaluator

## PR

- **Number:** 754
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/754
- **Branch:** `cursor/optimisation-automation-phase-a`

## Summary

The wizard's Step 6 "Optimisation Strategy" section has always been a dead
end — an operator configures rules and guardrails, they persist to
`draft.optimisationStrategy`, and nothing ever reads them again. No cron, no
evaluator, no Meta write. "An empty promise", in the operator's words.

This PR (task #120, PR A) builds the evaluator and the cron loop in **shadow
mode only**. Every 4h, `/api/cron/optimisation-tick` reads live Meta insights
for every opted-in, published campaign, runs the exact rule/guardrail
decision logic PR B will eventually use to write real budget changes, and
logs the recommendation to a new `campaign_automation_decisions` audit
table. **Zero Meta write calls in this PR** — the operator reads the audit
log for a week to sanity-check recommendations before PR B (real writes) or
PR C (UI: campaign opt-in checkbox, audit log tab) ship.

## Scope / files

**Migration**

- `supabase/migrations/151_campaign_automation_decisions.sql` — the audit
  table (see schema below) + `campaign_drafts.optimisation_automation_enabled`
  (opt-in flag, default `false`). RLS: authenticated read, service-role-only
  write — same posture as migration 124 (`cron_health_reports`). **Not yet
  applied** — apply via the Supabase MCP `apply_migration` post-merge, per
  the repo's standing migration convention.

**Pure decision logic** (`lib/optimisation/`, zero `@/` imports, fully
`node --test`-able)

- `evaluate.ts` — `evaluateAdSet()`. Rule-band matching, guardrail clamping
  (`hardBudgetCeiling` / `maxExpansionPercent` / `ceilingBehaviour`), dormant
  + recent-touch skips. **The** function PR B will call before any real Meta
  write, so shadow recommendations and eventual live actions can't drift
  apart. 17 tests.
- `live-metric.ts` — resolves a campaign objective's PRIMARY metric
  (`OBJECTIVE_METRIC_PRIORITY` in `lib/optimisation-rules.ts`) from a raw
  insights row — `cost_per_action_type` lookup for conversion metrics,
  direct field read for cpc/cpm/ctr. Returns `null` (never a false `0`) when
  there's no data yet. 9 tests.
- `insights-fetch.ts` — `fetchCampaignAdSetInsights()`. One Graph call per
  campaign per tick (see "Design decisions" below for why this deviates from
  the brief's literal two-endpoint sketch). 4 tests.
- `tick-runner.ts` — `runOptimisationTick()`, the pure orchestrator: killswitch
  → quota check → per-campaign → per-ad-set (recent-decision skip → CBO skip
  → metric-missing skip → `evaluateAdSet`) → insert. 9 tests, including
  "one campaign throwing doesn't stop the others" and an explicit assertion
  that the only two Meta/DB seams are the injected `fetchInsights` /
  `insertDecision` functions (there is no write seam to test against —
  "zero Meta writes" is structural, not just asserted).

**Glue** (Supabase / Meta client wiring, thin by design — no new logic)

- `lib/db/campaign-automation-decisions.ts` — `loadOptedInCampaignsForAutomation`,
  `hasRecentDecisionForAdSet`, `insertAutomationDecision`.
- `app/api/cron/optimisation-tick/route.ts` — auth (`CRON_SECRET` bearer,
  same helper as every other cron) → `ENABLE_OPTIMISATION_AUTOMATION`
  killswitch → best-effort `X-App-Usage` quota check → wires the pure runner
  to the real Supabase client + `graphGetWithToken`.
- `vercel.json` — registers `/api/cron/optimisation-tick` at `0 */4 * * *`.
- `CLAUDE.md` — documents `ENABLE_OPTIMISATION_AUTOMATION`, the new cron, and
  the new migration.

## Design decisions worth reviewing

**1. One Graph call per campaign per tick, via field expansion — not the
brief's literal two-endpoint sketch.**

The brief described `GET /{campaign_id}/insights?level=adset&fields=...`
for metrics plus "fetch daily_budget from the ad set (1 extra call, prefer
same call)". Meta's Insights API has **no `daily_budget` field at all** —
there is no way to get both metrics and budget from that one endpoint. This
PR instead calls the CAMPAIGN's `/adsets` edge with a nested
`insights.date_preset(last_1d){...}` field expansion, giving budget, status,
AND metrics in exactly one call. This keeps the call budget at the brief's
own math (10 opted-in campaigns × 1 call/tick × 6 ticks/day = 60/day, well
under the 200/day target) while actually being correct against the real API.

**2. Dormant check uses the SAME window as the metric, not a separate
hard-coded 7d call.**

The brief's flow listed "skip if 0 impressions in last 7d" as a separate
bullet from the 24h metric window, but also said "one extra field on the
SAME insights call" and its own call-budget math assumes exactly one call
per campaign. A genuinely separate 7d window would be a second call. This PR
resolves the tension by checking `impressions <= 0` in whichever window the
rule's own `timeWindow` uses (24h/3d/7d) — one call, one window, dormant
signal included for free. Documented in both `evaluate.ts` and
`insights-fetch.ts`'s doc comments so a future reader doesn't "fix" it back
to a mismatched 7d assumption.

**3. Loop-prevention is a hard DB-level skip, not a per-tick evaluate-and-log.**

The brief says "no ad set gets touched more than once per 24h even in
dry-run tracking". Read literally, `evaluateAdSet` can independently
produce `skip_dormant` / `skip_recent_touch` outcomes (and does — both are
unit-tested in isolation, since PR B may feed it a different
`lastTouchedAt` source, e.g. Meta's own last-budget-update timestamp,
instead of our own audit log). But the CRON itself checks
`hasRecentDecisionForAdSet` BEFORE calling the evaluator at all, and skips
with **no DB write** if a decision exists within the lookback window. That
satisfies "at most one row per ad set per 24h" without a 6×/day flood of
identical `skip_recent_touch` rows cluttering the operator's audit read, and
mirrors the cadence PR B will actually run real writes at.

**4. `maxSingleAdSetBudget` / `maxDailyIncreasePercent` are NOT wired in —
flagged, not silently dropped.**

`BudgetGuardrails` already has these two fields (Step 6 UI lets an operator
configure them), but the PR A brief's "apply guardrails" list only names
`hardBudgetCeiling` / `maxExpansionPercent` / `ceilingBehaviour`. Implementing
exactly what was asked rather than guessing at the other two's semantics.
Called out in both `evaluate.ts`'s module doc comment and
`CLAUDE.md` so an operator enabling PR B doesn't discover this the hard way —
a per-ad-set-configured cap silently not being respected would be a real
guardrail gap, not a cosmetic one.

**5. `cooldownHours` (existing, previously-unused guardrail field) now
powers the recent-touch check inside `evaluateAdSet`.**

Rather than inventing a new field, the evaluator's cooldown window defaults
to 24h (matching the cron's own DB-level lookback) but respects
`guardrails.cooldownHours` when the operator has set it via the Step 6 UI —
that field already existed and was already displayed in the guardrails
summary, just never consumed by anything.

**6. Metric-missing and CBO ad sets still get a decision row.**

Rather than silently skipping an ad set with no conversions yet, or one
under campaign-budget-optimisation (no per-adset `daily_budget` to propose
against), both cases insert a `maintain` decision with an honest
`reason_text` explaining why. This matches the acceptance criterion "one row
per opted-in ad set" literally, and means the audit log never has an
unexplained gap that looks like the cron silently failed on that ad set.

**7. Best-effort quota check reuses the existing `X-App-Usage` tracker
(task #100 — already shipped) rather than adding a new one.**

`lib/meta/client.ts` already maintains an in-memory `getLastKnownMetaAppUsage()`
snapshot for the `/business-managers` quota indicator. This cron reads that
same snapshot and throttles (skips the whole tick, logs, returns 200) above
70%. Documented caveat, not a silent gap: on a cold Lambda start — the
typical case for a 4h-interval cron — there's no prior snapshot and the
check is a no-op; the tick proceeds and the run's own first Graph call
populates the snapshot for next time. Standing up a cross-invocation store
(Redis/Supabase) to get a true pre-flight number is exactly the kind of
"add it as a task follow-up" the brief called for when a real prerequisite
isn't fully there yet — noted below, not silently swallowed.

## Out of scope for this PR (explicit, per the brief)

- Meta writes (PR B).
- UI for enabling automation per campaign — currently `update campaign_drafts
  set optimisation_automation_enabled = true where id = '<draft id>'` via
  Supabase directly (PR B/C).
- Audit log UI tab (PR C).
- Slack/email notifications (PR C).
- Secondary rules (e.g. the ROAS guardrail rule set on `purchase`-objective
  campaigns) — only each objective's PRIMARY metric/rule is evaluated.
- `maxSingleAdSetBudget` / `maxDailyIncreasePercent` guardrails (item 4 above).
- A real cross-invocation quota store (item 7 above).

## Validation

- [x] `node --test 'lib/optimisation/__tests__/*.test.ts'` — 39 pass / 0 fail
- [x] `npm test` (full suite) — 3449 run, 3432 pass, 14 fail, **0 in any file
      touched by this PR**. All 14 failures are pre-existing baseline noise
      (`lib/clients/asset-queue/**`, `lib/dashboard/**` daily-history/trend
      tests, `lib/db/__tests__/canonical-tickets-window.test.ts`,
      `lib/meta/__tests__/creative-buy-tickets-cta.test.ts`,
      `lib/meta/__tests__/launch-campaign-placement-wiring.test.ts`) — same
      set already recorded on `main` by the previous session's PR before any
      of this branch's changes.
- [x] `npx tsc --noEmit` — no errors in any file touched by this PR (the
      full-repo run surfaces the same pre-existing baseline noise in
      Jest-typed `__tests__/*.test.ts` files under a non-Jest runner, and a
      handful of unrelated pre-existing type mismatches in
      `lib/clients/asset-queue`, `lib/dashboard`, `lib/db`, `lib/mailchimp`,
      `lib/meta` test fixtures — none touched here)
- [x] `npx eslint` on every touched path — clean
- [x] `npm run build` — exit 0; `/api/cron/optimisation-tick` registered
- [ ] Migration 151 applied via Supabase MCP (post-merge, per convention)
- [ ] Post-merge smoke: set `ENABLE_OPTIMISATION_AUTOMATION=1` in Vercel,
      opt one published campaign in via Supabase, wait one 4h tick, confirm
      `campaign_automation_decisions` gets one row per that campaign's ad
      sets and zero Meta write calls were attempted (Vercel function logs /
      `X-App-Usage` before-and-after)

## Notes

- `lib/optimisation-rules.ts` (pre-existing, untouched) already had the full
  rule-generation + benchmark UI logic for Step 6 — this PR only adds the
  execution layer on top, reusing its `OBJECTIVE_METRIC_PRIORITY` mapping
  directly rather than re-deriving which metric is "primary" per objective.
- `RuleAction`/`RuleMetric`/`BudgetGuardrails`/`CeilingBehaviour` types are
  all pre-existing in `lib/types.ts` — no type changes were needed to ship
  this PR, only new modules consuming them. `CeilingBehaviour`'s third value
  is `"pause_scaling"` (not `"pause"` as the brief's prose used it) — the
  evaluator maps `pause_scaling` → `action: "pause"`.
- The `graphGetWithToken`-to-injected-fetcher generic mismatch (a concrete
  literal Graph response isn't structurally assignable to a generic
  `Promise<RawPaged<T>>` for arbitrary `T`) is a pre-existing pattern in this
  codebase, not something new to this PR — see
  `lib/dashboard/glasgow-adset-rollup-fetch.ts`'s `GlasgowGraphFetcher` and
  its test file's `as never` casts, copied here for `OptimisationGraphFetcher`
  and in `route.ts`'s `graphGetWithToken as OptimisationGraphFetcher` cast.
