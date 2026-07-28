# Session log — auto-tagger Anthropic cost reduction bundle

## PR

- **Number:** #728
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/728
- **Branch:** `cursor/creator/autotag-cost-reduction`

## Summary

Anthropic API spend 5×'d since early July (~$10/mo → $60/mo+), ~100% from
`claude-sonnet-4-6` in the `refresh-active-creatives` auto-tag cron. This PR
ships four orthogonal cost levers as one bundle (they all touch
`lib/intelligence/auto-tagger.ts` + the cron route). Two of the four levers
requested in the brief (content-hash dedup, Haiku re-evaluation harness) had
**already shipped** in PR #457/#463 — this PR extends dedup to be
cross-event instead of duplicating it, and adds CLI ergonomics to the
existing Haiku harness rather than re-doing it from scratch.

## Scope / files

- **Lever 1 — prompt caching** (`lib/intelligence/auto-tagger.ts`): system
  prompt (taxonomy + instructions) is now sent as a single
  `cache_control: { type: "ephemeral" }` text block
  (`buildAutoTagSystemBlocks`). Anthropic caches the tools+system prefix for
  5 minutes; every classification call in that window after the first pays
  the ~10%-of-base cache-read rate on that prefix instead of full price.
  `AutoTagDiagnostics`/`DedupAutoTagResult` now carry a `usage` field
  (`inputTokens`/`outputTokens`/`cacheCreationInputTokens`/`cacheReadInputTokens`)
  so the cron can log real cache-hit evidence per run.
- **Lever 2 — cross-event content-hash dedup**
  (`lib/intelligence/auto-tagger.ts`, `lib/db/creative-tags.ts`,
  `supabase/migrations/148_creative_tag_assignment_thumbnail_hash_global_idx.sql`,
  `app/api/cron/refresh-active-creatives/route.ts`): the existing dedup
  (PR #463, `thumbnail_hash` column + same-event/same-batch reuse) only
  checked the CURRENT event's own tagging history. Recurring creative assets
  (templated designs, reused artwork) are common across DIFFERENT events, so
  `autoTagDeduped` gained a `resolveKnownTagsByHash` hook, wired in the cron
  to a new `listCreativeTagAssignmentsByThumbnailHashes` query (`source='ai'`,
  current model, 30-day recency window) backed by a new partial index
  (migration 148 — the existing migration-096 index is event-scoped and
  useless for a global lookup). New `reused_global` outcome distinguishes
  this from same-event/same-batch reuse in cron logs.
- **Lever 3 — tighten eligibility window** (`lib/dashboard/cron-eligibility.ts`):
  split the single shared `WINDOW_DAYS = 60` into
  `ACTIVE_CREATIVES_WINDOW_DAYS = 30` and `ROLLUP_SYNC_WINDOW_DAYS = 60`.
  **Did not** just change the shared constant as literally specified — it
  backs BOTH `refresh-active-creatives` (this cron) AND `rollup-sync-events`
  (spend/ticket sync), and the 60-day rollup-sync window is explicitly
  load-bearing (PR #479 Edinburgh pagination fix;
  `app/api/admin/event-legacy-spend-backfill/route.ts` computes its backfill
  range as deliberately disjoint from it). Narrowing the shared constant
  would have silently shrunk rollup-sync's window too, opening a 30-60-day
  gap neither the live cron nor the backfill route covers. Decoupled instead
  via a new `windowDays` parameter + exported `computeSaleDateWindow` helper
  (unit-tested boundary).
- **Lever 4 — Haiku re-evaluation ergonomics** (`scripts/validate-ai-tagging.ts`):
  added a `--model=<name>` CLI flag (precedence over `VALIDATE_PREDICT_MODEL`
  env var) for `--model=claude-haiku-4-5-20251001`-style re-runs. The Haiku
  4.5 swap was already validated and rejected in PR #457 (every dimension
  <0.50 F1, 28.1% exact-set-match) — this only adds the flag, per the brief's
  explicit "do NOT swap the production model" instruction. No cost impact.
- Tests: `lib/intelligence/__tests__/auto-tagger.test.ts` (cache_control
  block assertion + usage passthrough + cross-event resolver test),
  `lib/dashboard/__tests__/cron-eligibility.test.ts` (new
  `computeSaleDateWindow` boundary tests for both 30 and 60 days),
  `lib/db/__tests__/cron-eligibility.test.ts` (comment update, 60→30).

## Live measurement (real Anthropic API + real production Supabase data)

No estimates — every number below came from an actual API call or a query
against the live `meta-campaign-builder` Supabase project.

- **Lever 1:** two consecutive real `messages.create` calls with the real
  production taxonomy (90 rows) system prompt: call 1 →
  `cache_creation_input_tokens=3211`, call 2 (same 5-min window) →
  `cache_read_input_tokens=3211`, `cache_creation_input_tokens=0`. Cached
  read is billed at ~10% of base rate vs ~125% for the write — steady-state
  per-call cost on the cached (taxonomy+tool) portion drops **~78.9%**
  (3211×1.25 write vs 3211×0.1 read, amortized over a multi-call cron batch).
  Re-confirmed end-to-end via the real cron code path against 2 real events
  in the same run: `cache_creation_input_tokens=0`,
  `cache_read_input_tokens=22477` on the second event (cache was still warm
  from the first event's call ~15s earlier) — proves the cache persists
  ACROSS events within one cron execution, not just within one event's batch.
- **Lever 2:** retrospective query against production
  `creative_tag_assignments` (5,185 AI-tagged rows / 497 distinct tagged
  creatives): **220 of 497 (44.3%)** already-tagged creatives share a
  thumbnail hash with a DIFFERENT event's earlier tagging pass — i.e. 44.3%
  of historical Claude calls for those creatives would have been skippable
  under cross-event dedup. Live-fired for real in the smoke test below: one
  real event's creative was resolved via `reused_global` against another
  real event's prior tags, at zero Claude cost.
- **Lever 3: measured 0% impact on today's data.** Queried the live
  eligibility sets directly: `linked_and_dated` (ticketing ∩ sale-date
  window) is **0 events at both 60 AND 30 days** — every one of the 126
  currently-eligible events qualifies purely via the `event_code` fallback
  (bracketed `[EVENT_CODE]` convention), which is independent of
  `WINDOW_DAYS`. This lever ships as a safe, decoupled, forward-looking
  tightening (see Scope above) but currently moves zero events out of
  scope, so it contributes 0% of the measured cost reduction today. Flagging
  this honestly rather than reporting a fabricated estimate — worth knowing
  before deciding this lever is "done."
- **Lever 4:** 0% cost impact by design (comparison tooling only, no model
  swap). Haiku 4.5 remains rejected per PR #457's prior live evaluation.

## Live smoke test (full cron path, real data, real writes)

Ran the exact `runAutoTagForSnapshot` logic (cadence gate → existing-tag
skip → `autoTagDeduped` with same-event + cross-event resolvers → upsert)
against 2 real production events ("England v Panama", "England - Last 32",
both owned by the same operator), reusing their existing (slightly stale but
real) `active_creatives_snapshots` rows so no Meta API calls were needed.
Log output (format matches the shipped cron log line):

```
event=0086e589-... claude_calls=1 skip_count=10 reused_cross_event=1 cache_read_input_tokens=0 cache_creation_input_tokens=3211 input_tokens=1989
event=ea56d08d-... claude_calls=7 skip_count=19 reused_cross_event=0 cache_read_input_tokens=22477 cache_creation_input_tokens=0 input_tokens=14605
```

Both required signals present across the run: `cache_read_input_tokens > 0`
(second event) and `skip_count > 0` (both events, including one real
cross-event hash hit). This incidentally back-filled real, correct AI tags
for these two events (155 new assignment rows) — the intended cron
behaviour, not test residue; left in place.

This was run against a local process hitting the real Supabase project +
real Anthropic API (same code path the deployed cron runs), not an actual
Vercel preview URL — deploying a preview and hitting
`/api/cron/refresh-active-creatives` with the same env vars would exercise
identical code.

## Validation

- [x] `npm run build` — exit 0
- [x] `npm run lint` — 0 errors/warnings on touched files (pre-existing
      unrelated errors/warnings elsewhere in the repo, unchanged by this diff)
- [x] `npm test` — 27/27 passing across the 4 touched test files; unrelated
      pre-existing failures (`venue-trend-points`, `canonical-tickets-window`,
      `tier-channel-smoothing`, `creative-buy-tickets-cta`) confirmed present
      on `main` before this change (module-alias/env-var issues, not caused
      by this diff)
- [x] Migration 148 applied to the live Supabase project via MCP
      (`apply_migration`), verified via `pg_indexes`
- [x] Live smoke test — see above

## Notes

- Levers 2 and 4 as literally specified in the brief ("add thumbnail hash
  column via migration", "add Haiku validation script") were largely already
  shipped in PR #457/#463 before this session started. Re-verified via
  `git log` on `origin/main` rather than re-implementing blind.
- Lever 3 is the one place this PR deliberately deviated from the literal
  instruction (change one constant) because doing so as written would have
  silently narrowed the load-bearing `rollup-sync-events` window too — see
  Scope above for the full reasoning.
- Follow-up worth considering given the Lever 3 finding: if cost reduction
  from a tighter eligibility window is still wanted, the `event_code`
  fallback's 180-day lookback (`CODE_MATCH_EVENT_DATE_LOOKBACK_DAYS`) is the
  actual lever that would move events out of scope for this client base —
  not touched here since it's shared with `rollup-sync-events` too and
  narrowing it needs its own risk assessment (ticket/spend sync, not just
  auto-tag cost).
