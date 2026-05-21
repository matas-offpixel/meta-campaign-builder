# Session log — Google Search wizard push adapter (Phase 3)

## PR

- **Number:** 445
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/445
- **Branch:** `creator/google-search-wizard-push-adapter`

## Summary

Phase 3 of the Google Search Campaign Creator wizard (scope:
`docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`). Replaces the
Phase 2 push stub with a real adapter that takes a
`google_search_plans` tree and creates the campaigns (all PAUSED) on
Google Ads via the proven `GoogleAdsClient.mutate()` primitive.

The adapter (`lib/google-ads/campaign-writer.ts`):

- Walks the tree per campaign and issues the exact 5-step sequential
 mutate chain validated by the Phase 0 spike (PR #442):
 `campaignBudgets:mutate` → `campaigns:mutate` → `adGroups:mutate` →
 `adGroupCriteria:mutate` (keywords + negatives, partial-failure ON) →
 `adGroupAds:mutate` (RSAs, partial-failure ON).
- Always sets
 `containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"`
 on every campaign create (v23 hard-required, was the first thing
 to fail in the spike).
- All resources created with `status: "PAUSED"`. Never auto-enables.
 Operator toggles Active in Google Ads when ready.
- Auto-prefixes campaign names with `[event_code]` (resolved from
 `events.event_code` via `plan.event_id`) so the reporting layer's
 matcher scopes them. Pushes name as-is + records a warning when no
 event is linked.
- Uses `maximize_clicks` via `target_spend.cpc_bid_ceiling_micros`
 (the field-name verified by the spike); `manual_cpc` uses
 `manualCpc: {}` and surfaces a "not exercised by the spike"
 warning on first launch so we know to watch the response.

Launch contract mirrors Meta's partial-failure / cleanup split (see
`app/api/meta/launch-campaign/route.ts`), tightened where the Google
Ads chain has stricter dependencies than Meta's:

- **Per-campaign foundation triad (budget + campaign) is
 fatal-on-failure WITH cleanup.** Same campaign-then-budget remove
 ordering the spike used (so the budget's `reference_count` is
 released before the budget itself is removed). Failures of one
 campaign do NOT abort the rest of the plan — other campaigns
 continue to push.
- **Ad groups within a campaign are tolerated independently.** A
 single ad-group failure goes to `adGroupsFailed`; the campaign and
 its sibling ad groups stand. **But** if ALL ad groups in a campaign
 fail to create, the campaign itself rolls back (budget + campaign
 remove) so the account doesn't end up with an empty keyword-less
 shell. Demoted from `campaignsCreated` to `campaignsFailed`.
- **Keywords / negatives / RSAs use `partialFailure: true`** — one
 bad keyword does not kill the ad group. Per-op failures land in
 `keywordsFailed` / `negativesFailed` / `rsasFailed` with the
 specific INVALID_ARGUMENT field message from
 `partialFailureError.details[].errors[].message` parsed by index.
- **Auth-like failure (401 UNAUTHENTICATED / 403 PERMISSION_DENIED
 / refresh-token errors) aborts the entire plan.** Set
 `aborted: true` + `abortReason`. We still try to remove any budget
 created right before the auth failure so we don't leak orphans
 after a credentials rotation.

Idempotency uses the existing `pushed_resource_name` columns from
the Phase 1 schema — **no new migration**. Every row in the tree
whose `pushed_resource_name` is non-null is treated as
"already-created" and skipped (returned in `*Created` with
`reused: true`, zero Google Ads writes). A re-push of an unedited
plan does zero mutate calls. A re-push of a partially-pushed plan
re-attempts only the missing rows. **Caveat:** Phase 1's
`saveGoogleSearchPlanTree` is a nuke-and-rewrite that drops
`pushed_resource_name` on every save, so save-after-push will
duplicate on the next push until the Phase 1 writer becomes
diff-aware. Logged in the **Notes / follow-ups** below.

The push route at `app/api/google-search/[id]/push/route.ts` now
resolves the credentials + the linked event's `event_code`,
constructs a per-row persister that writes `pushed_resource_name`
back to each table via tiny helpers added to
`lib/db/google-search-plans.ts`, and returns the full
`GoogleSearchLaunchSummary` (HTTP 200 on full success, 207 on
partial failure / abort so the client can distinguish).

The wizard's Push step (`components/google-search-wizard/steps/push.tsx`)
was rewritten to render the rich summary: per-campaign rows with a
**"View in Google Ads"** deep link
(`https://ads.google.com/aw/campaigns?campaignId=<id>&__e=<customer_id>`),
a Failures card grouped by row type with the specific error
messages, a Cleanup card listing any resources that were rolled
back, and a Warnings card for soft messages.

## Scope / files

**New:**

- `lib/google-ads/campaign-writer.ts` — the push adapter
 (`pushGoogleSearchPlan`) + payload builders exported for tests
 (`buildBudgetOp`, `buildCampaignOp`, `buildAdGroupOp`,
 `buildKeywordOp`, `buildNegativeOp`, `buildRsaOp`) + helpers
 (`prefixCampaignName`, `poundsToMicros`). Server-only.
- `lib/google-ads/campaign-writer-types.ts` — client-safe types
 (`GoogleSearchLaunchSummary`, `GoogleSearchPushResult`,
 `GoogleSearchPushFailure`) + `googleAdsCampaignDeepLink` pure
 helper. **Crucial for the build:** without this split, the wizard
 Push step (a `"use client"` component) pulled the writer (which
 imports `google-auth-library`) into the browser bundle and Next.js
 errored with `Module not found: https-proxy-agent / gaxios`.
- `lib/google-ads/__tests__/campaign-writer.test.ts` — 14 unit
 tests using a hand-rolled fake `GoogleAdsClient`. No live API
 hits.

**Modified:**

- `app/api/google-search/[id]/push/route.ts` — replaces the Phase 2
 stub with the real adapter wiring. `export const maxDuration = 300`
 to match the other ads-platform routes. Validates the plan, then
 decrypts credentials via `getGoogleAdsCredentials`, resolves
 `event_code`, builds the persister, and returns the
 `GoogleSearchLaunchSummary`.
- `components/google-search-wizard/steps/push.tsx` — rewritten to
 render the rich summary (deep links + per-row failure lists +
 cleanup card + warnings). Button shifts to "Push again (re-attempt
 failures)" after a complete run so the idempotent re-push UX is
 obvious.
- `lib/db/google-search-plans.ts` — added six tiny per-row writers
 the persister uses: `setGoogleSearchPlanStatus`,
 `setGoogleSearchCampaignResource`,
 `setGoogleSearchAdGroupResource`,
 `setGoogleSearchKeywordResource`,
 `setGoogleSearchNegativeResource`,
 `setGoogleSearchRsaResource`. Each is a single `update` so a
 single row's persistence failure doesn't roll back the rows that
 already succeeded.

**No new migration.** Reuses the `pushed_resource_name` columns +
the `status` / `pushed_at` columns on `google_search_plans` from
migration 096.

## Validation

- [x] `npx tsc --noEmit` — pre-existing 46 errors are unchanged
 (full output line count 112, identical pre/post the branch
 changes; verified by `git stash` round-trip). Zero new errors in
 changed paths.
- [x] `npx eslint lib/google-ads/ app/api/google-search/ components/google-search-wizard/ lib/db/google-search-plans.ts` — clean.
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'` — 39 / 39 pass (25 pre-existing + 14 new).
- [x] `npm run build` — green. All Google Search routes compile:
 `/google-search`, `/google-search/[id]`, `/api/google-search`,
 `/api/google-search/[id]`, `/api/google-search/[id]/push`,
 `/api/google-search/import`.

### Test coverage (mocked fetcher — NEVER hits live API)

The fake client records `{ resource, operations, options }` for
every `mutate(...)` call so we can assert on chain order, payload
shapes, and partial-failure semantics.

- **Full successful push** — asserts the 5-step chain order, the
 `containsEuPoliticalAdvertising` field on the campaign payload,
 the `targetSpend.cpcBidCeilingMicros` Maximise-Clicks shape, the
 PAUSED status on every resource, the `partialFailure: true`
 option on adGroupCriteria + adGroupAds, the persister callbacks,
 and the summary tallies. ✔
- **Triad failure (campaign mutate fails)** — asserts the budget
 is rolled back via a remove op and the campaign lands in
 `campaignsFailed` with `campaign_create_failed: ...` prefix. Chain
 shrinks to `budgets → campaigns (fail) → budgets remove`. ✔
- **Triad failure (all ad groups fail)** — asserts both campaign
 and budget are rolled back, campaign is demoted from `created`
 to `failed` with `all_ad_groups_failed: ...` error. ✔
- **Fan-out partial failure** — one bad keyword (mocked
 `partialFailureError` pointing at `operations[1]`) → other
 keywords + negatives land in `created`; bad one in `failed` with
 the specific error message extracted from
 `partialFailureError.details[].errors[].message`. ✔
- **Idempotency (full plan already pushed)** — zero mutate calls,
 every row in summary `reused: true`, `planStatusUpdate: 'pushed'`. ✔
- **Idempotency (partial plan)** — only the missing rows are
 mutated; reused rows still appear in `*Created` with
 `reused: true`. ✔
- **`[event_code]` prefix** — asserts the prefixed campaign name
 on the `campaigns:mutate` create payload, the "as-is + warning"
 path when `eventCode` is null, and no double-prefix when the
 plan name already starts with `[event_code]`. ✔
- **Auth abort** — first mutate returns 401 → `aborted: true`,
 `abortReason: 'auth_failed: ...'`, second campaign in the plan
 is NOT attempted. ✔
- **Pure helpers** — `prefixCampaignName` 255-char cap,
 `googleAdsCampaignDeepLink` URL shape + null on non-campaign
 resource names. ✔

## Notes / follow-ups

- **Save-after-push idempotency hole.** The Phase 1
 `saveGoogleSearchPlanTree` is a nuke-and-rewrite, so every wizard
 save (autosave or manual) drops `pushed_resource_name` on
 affected rows. A user who edits a pushed plan and pushes again
 will create duplicates on Google Ads. Two ways to fix in a
 follow-up:
  1. Make the Phase 1 writer diff-aware (preserve
 `pushed_resource_name` for rows that didn't change).
  2. Add the separate `google_search_write_idempotency` table the
 prompt mentioned as the alternate (mirror of
 `tiktok_write_idempotency`). Per the prompt, we preferred
 reusing `pushed_resource_name` to avoid a new migration; this
 trade-off is logged here for the follow-up author to weigh.
- **Negatives are pushed once per ad group via `adGroupCriteria`.**
 This matches what the Phase 0 spike validated. Plan-scoped + per-
 campaign negatives all get attached at the ad-group level
 (negative=true) bundled into the same partial-failure
 `adGroupCriteria:mutate` as the positives. The `pushed_resource_name`
 column on a negative row records the FIRST created criterion's
 resource name — the platform reality is N criteria per ad group
 but we record 1 for tagging purposes. Phase 4 may want to move
 negatives to the proper `campaignCriteria:mutate` endpoint for
 cleaner attribution; that endpoint was untested by the spike so
 deferring.
- **Defaults.** Daily budget defaults to £5 when neither
 `daily_budget` nor `monthly_budget` is set; floors at £1.00
 (Google's effective minimum for GBP). CPC ceiling for
 Maximise-Clicks defaults to £2.00 (safer than the spike's £0.50
 for actual plans). Ad-group `cpcBidMicros` defaults to £0.25 from
 the spike, overridden by `default_cpc` on the ad group when set.
- **RSA pinning support.** Headlines / descriptions with
 `pin_position` get mapped to `pinnedField: HEADLINE_n` /
 `DESCRIPTION_n` per v23 docs. Unpinned ones omit the field.
 Unverified live (the spike didn't pin anything) — if the first
 production launch trips a pinning validation error, the
 partial-failure mode catches it cleanly + surfaces the field
 path.
- **Per-row persistence is best-effort.** A failure to write back
 a single `pushed_resource_name` is logged as a warning in the
 summary; it does NOT abort the push (the platform resource still
 exists, the local DB is just out-of-sync until next reconciliation).
- **No new migration required.** Idempotency reuses the columns
 added in migration 096. Ops checklist is therefore a no-op.

### Shared-file edits surfaced for ops batch

None new beyond the existing dashboard-boundaries (this PR only
touches files inside the dashboard-thread WRITE-FREELY list +
`lib/db/google-search-plans.ts` which was created in Phase 1 by
this same thread).
