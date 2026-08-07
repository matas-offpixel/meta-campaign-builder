# Session log — Slack notification service + budget-pacing alerts (task #121, Phase 1 + 2)

## PR

- **Number:** 755
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/755
- **Branch:** `cursor/slack-notify-phase-1-and-2`

## Summary

Zero proactive alerting exists today — every campaign health check requires
an operator to open the app. This PR (task #121) ships as one unit because
Phase 2 is the reason Phase 1 exists: a small, reusable Slack notification
service (`lib/notify/slack.ts`'s `notify()`) with no user-visible output on
its own, immediately wired to hourly budget-pacing alerts (the operator's
original ask). Later phases — task #120's automation pings, a Monday
digest, urgent blockers, per-event lifecycle — all plug into the same
`notify()` seam without touching it.

Webhooks only for MVP (no Slack OAuth/interactive components). Fail-open
throughout: a notification failure (missing webhook, Slack 500, dedupe-store
error) returns `{sent: false, reason}` and never throws out of `notify()`,
so it can never break a calling cron.

## Scope / files

**Migration**

- `supabase/migrations/152_notification_dedupe_state.sql` — `notification_dedupe_state`
  (dedupe/mute state, keyed by a caller-chosen `dedupe_key`; `data` jsonb
  audits the last fired payload). RLS: authenticated read, service-role-only
  write — same posture as migration 151. **Numbered 152, not 151** — see
  "Design decisions" below. **Not yet applied** — apply via the Supabase MCP
  `apply_migration` post-merge, per the repo's standing convention.

**Phase 1 — pure Slack service** (`lib/notify/`, zero `@/` imports except
`slack-deps.ts`, fully `node --test`-able, 40 tests)

- `business-hours.ts` — `isBusinessHours(instant, timezone)`. 10:00–20:00
  Mon–Fri via `Intl.DateTimeFormat` (no tz-database dependency, same
  technique as `lib/d2c/bird/campaigns/schedule.ts`'s `tzOffsetMinutes`).
  Tested across both GMT and BST to prove the offset is real, not
  hard-coded. 10 tests.
- `slack.ts` — `notify(opts, deps)`: killswitch → per-channel enable →
  webhook lookup → business-hours gate → dedupe/mute check → reserve the
  dedupe slot → POST → never throw. 23 tests covering every skip reason,
  the urgent-bypasses-business-hours default (and explicit override in
  either direction), and "record-then-post" ordering (a POST failure still
  consumes the dedupe window — see "Design decisions").
- `templates.ts` — `budgetThresholdReached()`, the first of what will be
  several Block Kit templates. Header + fields + "Open in Ads Manager"
  button + context footer; degrades an unrecognised currency code to a
  plain number instead of throwing. 7 tests.
- `slack-deps.ts` — the one file allowed to import `@/`; wires the pure
  core to `lib/db/notification-dedupe.ts` + a real `fetch` POST.
- `ads-manager-url.ts` — campaign-level Ads Manager deep link, same
  `selected_*_ids` convention as `lib/bulk-attach/meta-ads-manager-url.ts`'s
  ad-set version one level up.

**Phase 2 — budget-pacing cron** (`lib/budget-pacing/`, zero `@/` imports,
25 tests)

- `plan.ts` — `computeCampaignBudgetPlan()`. The "planned total budget"
  denominator — see "Design decisions" for why this reads the SUM of
  enabled ad sets' daily budgets × scheduled days rather than
  `budgetSchedule.budgetAmount` or a live Meta `lifetime_budget`. 8 tests.
- `spend-fetch.ts` — `fetchCampaignSpendPence()`. ≤20 campaigns: one
  `/insights` call each. >20: chunked `ids=` batch field-expansion, same
  trick as `lib/optimisation/insights-fetch.ts`'s nested-insights approach.
  6 tests.
- `tick-runner.ts` — `runBudgetPacingTick()`, the pure orchestrator:
  killswitch → load campaigns → batch-fetch spend → per-campaign plan →
  0-spend skip → threshold crossing → `notify()` per crossed threshold with
  `dedupeWindowMs: Number.MAX_SAFE_INTEGER`. 11 tests, including "one
  campaign throwing doesn't stop the others" and "a `fetchSpendPence`
  failure marks every campaign errored without calling notify".

**Glue** (Supabase / Meta client wiring, thin by design)

- `lib/db/notification-dedupe.ts` — `checkNotificationDedupe`,
  `recordNotificationFire`.
- `lib/db/budget-pacing-campaigns.ts` — `loadPublishedCampaignsForBudgetPacing`
  (every `status = 'published'` draft with a `metaCampaignId`; no opt-in flag
  needed — the budget plan itself filters out campaigns with nothing to
  alert on).
- `app/api/cron/budget-pacing-check/route.ts` — auth (`CRON_SECRET` bearer)
  → `ENABLE_BUDGET_PACING_ALERTS` killswitch → wires the pure runner to the
  real Supabase client, `graphGetWithToken`, and live `notify()` deps.
- `vercel.json` — registers `/api/cron/budget-pacing-check` at `0 */1 * * *`.
- `CLAUDE.md` — documents all 8 new env vars, the new migration, and the new
  cron.

## Design decisions worth reviewing

**1. Migration numbered 152, not 151.** A sibling open PR
(`cursor/optimisation-automation-phase-a`, task #120 PR A) claimed migration
151 (`campaign_automation_decisions`) off the same `main` this branch was
cut from. Picked 152 deliberately to avoid a guaranteed collision — whichever
of the two merges second would otherwise need a rename either way.

**2. `notify()` takes `deps` as an explicit second parameter — not the
brief's literal single-argument `notify(opts)`.** The brief's sketch had no
deps parameter. `node --test` (this repo's test runner) can't resolve `@/`
path aliases, so a `notify()` that reached for Supabase/`fetch` internally
at the top of `slack.ts` would make the whole module untestable without a
live DB. Matches the established `runOptimisationTick(enabled, deps)` /
`runBudgetPacingTick(enabled, deps)` split instead: the pure core takes deps,
`lib/notify/slack-deps.ts` builds the real thing once per request, and every
future caller (the cron route here, task #120 PR B's automation pings, the
Monday digest) does the same. Still a two-line call site
(`notify(opts, notifyDeps)`), not meaningfully more boilerplate than the
brief's sketch.

**3. Budget-pacing's "planned total budget" is the sum of enabled ad sets'
`budgetPerDay` × scheduled days — not `budgetSchedule.budgetAmount`, and not
a live Meta `lifetime_budget`.** The brief's step 2 said "campaigns with
non-null `lifetime_budget`"; `lib/meta/adset.ts`'s `buildAdSetPayload`
unconditionally sets a per-ad-set `daily_budget` at launch regardless of
`budgetLevel`/`budgetType` — Campaign Budget Optimisation is not currently
wired to Meta at all in this codebase, so there is no live `lifetime_budget`
to read for ANY real campaign. Using the sum of enabled ad sets'
`budgetPerDay` (the actual launch-time ground truth) × `Math.ceil((end-start)/day)`
(the exact formula `components/steps/budget-schedule.tsx` already uses for
its "Total Spend (Xd)" UI footer) means the Slack alert's "planned budget"
always matches what the operator saw when they built the campaign, and works
for every real launched campaign today rather than zero of them. Documented
at length in `lib/budget-pacing/plan.ts`'s doc comment.

**4. Spend-fetch always uses individual `/insights` calls at ≤20 campaigns,
batched `ids=` chunks of 20 above that — implemented now, not deferred.**
The brief called this out as a real threshold ("use it if >20 campaigns"),
not just a future optimization, so it's implemented as a runtime branch on
the actual campaign count rather than a follow-up ticket.

**5. `recordFire` (dedupe upsert) happens BEFORE the Slack POST, not after.**
If the POST throws or the Lambda dies mid-request, the dedupe window is
already consumed — the alert won't spam-refire on the next hourly tick. This
is a deliberate "fail open toward silence, not toward spam" trade-off,
documented in `slack.ts`'s doc comment on the `notify()` flow.

**6. `dedupeWindowMs: Number.MAX_SAFE_INTEGER` for every budget threshold.**
Per the brief: once a campaign crosses 50%, it never re-fires 50% again even
if it's paused and resumed and dips back below then above. Every threshold
per campaign is genuinely fire-once-ever.

## Verification (post-merge, once deployed + Slack webhooks configured)

1. Set `ENABLE_SLACK_NOTIFICATIONS=1`, `SLACK_WEBHOOK_ADS_OPS=<url>`,
   `ENABLE_BUDGET_PACING_ALERTS=1`, `META_ACCESS_TOKEN` in Vercel prod env.
2. Manually trigger `GET /api/cron/budget-pacing-check` with the
   `CRON_SECRET` bearer header.
3. Confirm a Slack message posts to `#ads-ops` for any published campaign
   already >25% through its planned budget.
4. Trigger the cron again — the same campaign at the same threshold should
   NOT re-fire (`notificationsSkipped` in the JSON response, reason
   `deduped`).
5. Confirm a row exists in `notification_dedupe_state` for each fired
   threshold (`dedupe_key = budget_threshold:<campaignId>:<threshold>`).

## Explicitly out of scope (per the brief)

Monday digest, urgent blockers, task #120 automation pings (waits on PR B),
per-event lifecycle, the "mute this alert" click-through UI (the `muted`
column exists; no UI to flip it yet), Slack OAuth/interactive components.

## Validation

- [x] `npx tsc --noEmit` — 371 pre-existing errors on `main`, unchanged by
  this branch (verified via `git stash` diff); zero errors in any new file.
- [x] `npm run build` — succeeds, `/api/cron/budget-pacing-check` present in
  route output.
- [x] `npm test` — 14 pre-existing failures on `main`, unchanged by this
  branch (verified via `git stash` diff); all 65 new tests pass
  (`lib/notify/__tests__/*`, `lib/budget-pacing/__tests__/*`).
- [x] `npx eslint` on every new file — zero errors/warnings.
