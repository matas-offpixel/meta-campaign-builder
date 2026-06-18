# Stage A — Diagnosis: Glasgow live ad-set rollup writer

**Date:** 2026-06-17
**Branch:** `cc/glasgow-adset-rollup-writer` (Claude Code, worktree `~/worktrees/glasgow-adset-rollup-writer` off `main` @ f03c83d)
**Status:** AUDIT-ONLY. No source code modified. Awaiting Matas sign-off before Stage B.

Goal of the PR: replace the hard-coded snapshot in `lib/dashboard/event-code-adset-splits.ts`
with a live ad-set-level Meta pull that writes correctly-attributed numbers to
`event_daily_rollups` for the two Glasgow event codes only.

---

## TL;DR for reviewer

The 6 prompt claims are **all essentially correct**, with two corrections that change Stage B scope:

1. **The prompt's Stage B delete list is incomplete.** `getSpendAdjustmentGbp` has **4 call
   sites**, not the 2–3 named. It misses `app/share/venue/[token]/page.tsx:160` and
   `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx:239` — the two pages that actually
   call it and feed `spendAdjustmentGbp` into `buildVenueCanonicalFunnel`. Plus the test file.

2. **The snapshot does TWO jobs, and Stage B as written only replaces one cleanly.**
   - (a) **Spend** adjustment on rollup-backed surfaces (`getSpendAdjustmentGbp`, read-time).
     Stage B's write-time rollup pull replaces this correctly.
   - (b) **Engagement** (reach / link_clicks / LPV) adjustment on the **lifetime cache**
     (`applyAdsetSplitsToLifetimeMeta`, read-time). This is **NOT rollup-backed** — it patches
     `event_code_lifetime_meta_cache`, a separate table populated by a separate bracket-match
     fetch (`fetchEventLifetimeMetaMetrics`), and that table holds **account-deduplicated
     lifetime reach** (the venue-card "Reach" cell). **Deleting `applyAdsetSplitsToLifetimeMeta`
     without a write-time equivalent will REGRESS the Glasgow venue-card Reach / clicks / LPV
     numbers** (full campaign engagement re-lands on O2). This is exactly the
     "VERIFY Pass-1 lifetime cache ALSO gets updated" guardrail — and it's engagement, not spend.
     **Decision needed (see §7).**

3. **Live re-pull (claim 6) is BLOCKED** — the Meta MCP `ads_get_ad_entities` tool returns
   `OTID is a required input` on every call in this environment (gateway bug; `ads_get_ad_accounts`
   works). Current at-time truth could not be obtained. Not papering over it per
   `feedback_no_fallback_papering_over_broken_source`. The 2026-06-08 baseline + the in-code
   2026-06-03 snapshot are the most recent verified numbers. Re-pull must happen at PR review
   (the prompt already defers exact truth to then).

---

## Claim-by-claim verification

### Claim 1 — Lifetime cache populated by Pass-1 bracket match, full spend on O2
**Status: CORRECT, with one factual correction (no spend in the cache).**

- The lifetime cache `event_code_lifetime_meta_cache` is populated by
  `fetchEventLifetimeMetaMetrics` (`lib/insights/meta.ts:2693` →
  `fetchEventLifetimeMetaMetricsWithFetcher`), whose pure aggregation core is
  `lib/insights/event-code-lifetime-two-pass.ts` (Pass-1 bracket match, Pass-2 account-dedup reach,
  PR #418).
- **It is invoked from the lifetime-cache leg inside the rollup runner**, not a separate populator:
  `lib/dashboard/rollup-sync-runner.ts:799–857` (`fetchEventLifetimeMetaMetrics` at :811,
  `upsertEventCodeLifetimeMetaCache` at :821). So the *same runner* that writes daily rollups also
  populates the lifetime cache.
- **Correction:** the lifetime cache stores **NO spend column**. `EventCodeLifetimeMetaCacheRow`
  (`lib/db/event-code-lifetime-meta-cache.ts:34–51`) has only `meta_reach`, `meta_impressions`,
  `meta_link_clicks`, `meta_landing_page_views`, `meta_regs`, `meta_video_plays_3s/15s/p100`,
  `meta_engagements`. The upsert at `rollup-sync-runner.ts:821–838` writes only those. So what
  over-attributes to O2 *in the cache* is **engagement**, not spend. The prompt's phrasing
  ("FULL spend lands on WC26-GLASGOW-O2 in event_code_lifetime_meta_cache") is slightly off:
  spend lives only in `event_daily_rollups`.

### Claim 2 — Same campaign written to `event_daily_rollups` via the runner, full spend on O2
**Status: CORRECT.**

- `runRollupSyncForEvent` Meta leg calls `fetchEventDailyMetaMetrics`
  (`lib/dashboard/rollup-sync-runner.ts:501`).
- `fetchEventDailyMetaMetrics` (`lib/insights/meta.ts:1963`) queries Meta at **`level: "campaign"`**
  (`meta.ts:2050`) and case-sensitively re-filters campaign names against the bracket `[eventCode]`
  (`meta.ts:~2024, ~2304`). For `WC26-GLASGOW-O2` the only matching campaign is
  `[WC26-GLASGOW-O2] TRAFFIC` (6925933901665), so the **entire campaign's daily spend lands on
  WC26-GLASGOW-O2** in `event_daily_rollups.ad_spend`. The SWG3 ad sets inside it never reach
  WC26-GLASGOW-SWG3.

### Claim 3 — `applyAdsetSplitsToLifetimeMeta` only at lifetime-cache read; not on rollup-backed Topline/Performance
**Status: CORRECT.**

- `applyAdsetSplitsToLifetimeMeta` has exactly one production call site:
  `lib/db/client-portal-server.ts:1086`
  (`lifetimeMetaByEventCode: applyAdsetSplitsToLifetimeMeta(lifetimeMetaByEventCode)`), import at
  `client-portal-server.ts:20`. It adjusts **engagement display surfaces** (reach/clicks/LPV) only.
- Topline / Performance Summary spend is rollup-backed: `aggregateClientWideTotals`
  (`lib/db/client-dashboard-aggregations.ts:295`, called at :494–496) sums `event_daily_rollups`
  through `metaPaidSpendOf` (`lib/dashboard/paid-spend.ts:8–22`), which returns
  `ad_spend_allocated + ad_spend_presale` (or raw `ad_spend`). **No snapshot adjustment is applied
  on this path** — `getSpendAdjustmentGbp` is not called anywhere near `aggregateClientWideTotals`.
  This is the drift mechanism (b): the +£1,671 SWG3 add happens only on the lifetime-cache /
  venue-table / funnel read paths, never on the SUM(rollups) Topline path.

### Claim 4 — `getSpendAdjustmentGbp` applied at venue table AND `buildVenueCanonicalFunnel`
**Status: CORRECT, but the prompt's call-site inventory is INCOMPLETE.**

`getSpendAdjustmentGbp` is called at **4 sites** (import + usage):

| # | File:line | What it feeds |
|---|---|---|
| 1 | `components/share/client-portal-venue-table.tsx:63` (import), `:1765` (call) | `venueDisplaySpend` → Performance Summary (`aggregateVenueCampaignPerformance`). Prompt said ~1764; actual **1765**. |
| 2 | `app/share/venue/[token]/page.tsx:8` (import), `:160` (call) | `spendAdjustmentGbp` → `buildVenueCanonicalFunnel` (public share venue funnel). **NOT in prompt's list.** |
| 3 | `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx:13` (import), `:239` (call) | `spendAdjustmentGbp` → `buildVenueCanonicalFunnel` (dashboard venue funnel). **NOT in prompt's list.** |
| 4 | `lib/dashboard/venue-canonical-funnel.ts` | **Consumer, not caller.** Receives `spendAdjustmentGbp` as a param and applies it: seed at `:429` (`sumVenueSpend + spendAdjustmentGbp`) and `:612` (`let spent = spendAdjustmentGbp`); param declared at `:414`, `:529`, `:588`, `:602`. |

So `buildVenueCanonicalFunnel` itself doesn't import the snapshot — the **two `page.tsx` files** do.
Stage B must remove the import + call from sites 1–3, and either drop the now-always-0
`spendAdjustmentGbp` param in `venue-canonical-funnel.ts` or leave it defaulting to 0 (harmless).

### Claim 5 — Do `meta_video_plays_*` / `meta_engagements` get any snapshot adjustment?
**Status: CORRECT — they do NOT.**

- `getEngagementAdjustments` (`event-code-adset-splits.ts:163–184`) computes deltas only for
  `reach`, `linkClicks`, `landingPageViews`. `applyAdsetSplitsToLifetimeMeta` (:197–219) patches only
  `meta_reach`, `meta_link_clicks`, `meta_landing_page_views`.
- `meta_video_plays_3s/15s/p100` and `meta_engagements` receive **no split** today — for Glasgow they
  are fully attributed to O2 (zero to SWG3) on both the lifetime cache and the daily rollups. Stage B's
  ad-set fetch is an opportunity to split these correctly too (the BB26 awareness template reads
  video plays / engagements — relevant if any Glasgow awareness surface exists).

### Claim 6 — Re-pull live Meta ad-set spend for campaign 6925933901665
**Status: BLOCKED — could not obtain current truth.**

- 4TheFans ad account = `10151014958791885` (confirmed via `ads_get_ad_accounts`, business "4thefans",
  GBP, queryable).
- Every `ads_get_ad_entities` call (adset-level, campaign-level, with/without filtering) failed with:
  `MCP error -32603: ... OTID is a required input and cannot be empty or malformed.`
  This is a gateway/plumbing error, identical across parameter variations — not fixable from the
  client side. `ads_get_ad_accounts` works, so auth is fine; only `ads_get_ad_entities` is broken.
- Per `feedback_no_fallback_papering_over_broken_source`, current truth is left UNVERIFIED rather than
  fabricated. **Last verified numbers:**

| Source | Date | Campaign spend | O2 share | SWG3 share |
|---|---|---|---|---|
| In-code snapshot (`CAMPAIGN_SPLITS`) | 2026-06-03 | £7,784.08 | 78.53% | 21.47% |
| Audit baseline (prompt) | 2026-06-08 | ~£9,047.70 ad-set sum | 81.53% | 18.47% |
| Dashboard "effective" (drifting) | 2026-06-17 | O2 £11,487 shown vs ~£8,300 Meta truth | — | — |

  **Action:** re-run the ad-set pull at PR review (the prompt defers exact truth to then) and paste
  the per-venue at-time totals into the PR body alongside the verification SQL.

---

## Drift mechanism (confirmed, restated precisely)

1. Runner writes **full** TRAFFIC campaign daily spend to `event_daily_rollups` under
   `WC26-GLASGOW-O2` (bracket match, claim 2). SWG3 gets £0 from this campaign.
2. The venue allocator (`allocateVenueSpendForCode`) then divides O2's `ad_spend` across O2 fixtures
   — but it operates per `(client_id, event_code)`, so SWG3's misattributed share never moves to SWG3.
3. Read-time, `getSpendAdjustmentGbp` subtracts `7784.08 × (1 − 0.7853) ≈ £1,671` from O2 and adds the
   same to SWG3 — **but only on the venue-table + funnel surfaces (sites 1–3)**, NOT on the
   SUM(rollups) Topline / Performance Summary path (claim 3). And the subtraction is frozen at the
   2026-06-03 £7,784 snapshot while the live campaign is now ~£11k+, so even where applied it is
   undersized by £3k+.

Net effect today: O2 over-reads, SWG3 under-reads, and the gap grows daily.

---

## Why the write-time approach fixes it (and what it does NOT fix)

**Fixes (cleanly):**
- Daily-rollup **spend** split: `fetchGlasgowAdSetSplits` writes per-day O2 / SWG3 spend to
  `event_daily_rollups`, so the allocator and every rollup-backed surface (Topline, Performance
  Summary, venue table, funnel) read correct per-venue spend with no read-time patch.
- Daily-rollup **engagement** split: the same ad-set pull can write per-venue reach / impressions /
  clicks / LPV / video / engagements to the daily rollups (engagement-owner-gated per PR #499).

**Does NOT fix without extra work (the §7 decision):**
- The **lifetime cache** engagement (`event_code_lifetime_meta_cache`) — the venue-card "Reach" cell —
  is still populated by the bracket-match `fetchEventLifetimeMetaMetrics` and still lands the full
  campaign's account-deduped reach on O2. The current read-time patch
  (`applyAdsetSplitsToLifetimeMeta`) is the only thing correcting it. Removing it regresses Glasgow's
  venue-card Reach / clicks / LPV.

---

## §7 — OPEN DECISIONS FOR MATAS (before Stage B)

**D1 — Lifetime-cache engagement split (the load-bearing one).**
The lifetime cache holds account-deduplicated reach (ad-set reaches overlap, so it can't be summed
from ad-set splits). Options:

- **(D1-a) Keep a slim engagement-only split at lifetime-cache write time** for Glasgow only — apply
  the same `sharePercent` approximation the snapshot uses, but at write time in the lifetime-cache leg
  (`rollup-sync-runner.ts:799–857`). Deletes the read-time patch; keeps the approximation. *Recommended
  — preserves current behaviour, write-time, no read-time fix.* (Note: `sharePercent` still needs a
  source — either a periodically-refreshed value derived from the ad-set spend pull, or accept it stays
  a constant. This reintroduces a small piece of "snapshot" by another name.)
- **(D1-b) Accept the venue-card engagement regression** — let Glasgow O2 show full-campaign reach and
  SWG3 show its own (small) campaigns' reach. Simplest; visibly wrong on the card.
- **(D1-c) Defer** — ship spend-only now (delete `getSpendAdjustmentGbp` + 4 call sites), keep
  `applyAdsetSplitsToLifetimeMeta` + the engagement half of the snapshot file, and do the lifetime-cache
  engagement migration as a follow-up. Smaller, lower-risk PR; the file is not fully deleted yet.

The prompt says "DELETE the file entirely" and "VERIFY Pass-1 lifetime cache ALSO gets updated" — those
two together imply **D1-a**. Confirm.

**D2 — `meta_video_plays_*` / `meta_engagements` split (claim 5).** Currently unsplit. Split them in
the ad-set pull too (write-time), or leave O2-attributed? (Low stakes unless a Glasgow awareness surface
exists. Recommend: split in the daily rollups since the data is free in the same ad-set call; leave
lifetime-cache video/engagements per the D1 decision.)

**D3 — `sharePercent` source after deletion.** Stage B writes *absolute* per-day ad-set spend to
rollups (no percentage needed there). But D1-a's lifetime-cache engagement split needs a ratio. If we
keep one, where does it come from — recomputed from the daily ad-set spend window, or a constant? This
is the one place the "snapshot" concept could survive; flag it so we delete deliberately, not by
accident.

---

## Stage B change set (confirmed inventory)

**Delete:**
- `lib/dashboard/event-code-adset-splits.ts`
- `lib/dashboard/__tests__/event-code-adset-splits.test.ts`

**Edit (remove import + call site):**
- `lib/db/client-portal-server.ts` — import :20, call :1086 (`applyAdsetSplitsToLifetimeMeta`).
  *Conditional on D1.*
- `components/share/client-portal-venue-table.tsx` — import :63, call :1764–1768
  (`getSpendAdjustmentGbp`).
- `app/share/venue/[token]/page.tsx` — import :8, call :160.
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — import :13, call :239.
- `lib/dashboard/venue-canonical-funnel.ts` — drop or zero the `spendAdjustmentGbp` param
  (:414, :429, :529, :588, :602, :612). Consumer only; safe to leave defaulting to 0 if we want a
  smaller diff.

**Add:**
- `lib/dashboard/glasgow-adset-rollup-fetch.ts` (`GLASGOW_TRAFFIC_CAMPAIGN_ID`,
  `fetchGlasgowAdSetSplits`, `GlasgowAdSetSplit`) + tests.
- Wiring in `lib/dashboard/rollup-sync-runner.ts` Meta leg: exclude campaign 6925933901665 for Glasgow
  event codes, then merge the ad-set-fetched venue rows. Reuse the existing `isEngagementOwnerForCode`
  / `ownedOrNull` gating (`rollup-sync-runner.ts:723–747`) so only one Glasgow sibling per code per day
  owns engagement metrics.

**Reference — engagement-owner pattern to reuse** (`rollup-sync-runner.ts:723–747`): `isOwner` from
`isEngagementOwnerForCode`, `ownedOrNull(v)` wraps every engagement/conversion column; `ad_spend` stays
per-fixture, `ad_spend_presale` + engagement are owner-only NULL-elsewhere. Same shape applies to the
merged Glasgow rows.

---

## Anti-drift guardrails (acknowledged)

- Glasgow-only; no generic ad-set rollup writer.
- No change to `venue-spend-allocator.ts` (divides per fixture — separate concern).
- No change to bracket-match logic in `event-code-lifetime-two-pass.ts` for non-Glasgow codes.
- No widening of the 60-day live cron window (PR #481, load-bearing).
- No campaign-level fallback if the ad-set call fails — **throw** and let cron retry
  (`feedback_no_fallback_papering_over_broken_source`).
- Write-time only; no read-time fix.
- Lifetime cache for Glasgow must be handled per D1 or it stays wrong after rollups are fixed.

---

## §8 — POST-SIGN-OFF DISCOVERY: pre-existing Glasgow write-time machinery (premise inversion)

Found while starting Stage B (reading the code I'd modify). **The Stage A sign-off was given without
this.** It materially changes Stage B scope and risk.

`fetchEventDailyMetaMetrics` already contains write-time Glasgow handling — the prompt's
"READ THESE FIRST" list and its clean bracket-match-only premise omitted it:

- **Module:** `lib/dashboard/wc26-glasgow-umbrella.ts` (+ tests). Handles **umbrella** campaigns named
  `[WC26-GLASGOW]` *without* a venue suffix, splitting their spend across the two venue siblings by a
  **cutover date** (`WC26_GLASGOW_UMBRELLA_CUTOVER_DATE = "2026-05-04"`): umbrella spend on/before →
  SWG3, after → O2 (`wc26GlasgowUmbrellaSpendBelongsToVenueEvent`).
- **Wired into all THREE Meta fetch paths:** daily (`meta.ts:2146–2265`), today snapshot
  (`meta.ts:~2475–2513`), and the lifetime two-pass (`meta.ts:~3038–3054`).

**Interaction with the 6925933901665 ad-set split:**
- Campaign 6925933901665 is `[WC26-GLASGOW-O2] TRAFFIC` — it carries the `-O2` suffix, so
  `isWc26GlasgowUmbrellaOnlyCampaignName` returns **false**. The umbrella loop **ignores** it. ✓ No
  double-count between umbrella and ad-set split — they are orthogonal concerns.
- BUT the **primary bracket loop** (filter `[WC26-GLASGOW-O2]`) matches 6925933901665 (full mixed
  spend) + pure-O2 campaigns (£236.29 at baseline) in **all three** fetch paths. The prompt's plan to
  "exclude 6925933901665 in the runner" is not implementable there: the fetch aggregates per-day, so
  the runner has no per-campaign row to subtract. Exclusion must happen **inside the fetch**, and to
  keep daily / today / lifetime consistent it must happen in **all three paths**.

**Revised Stage B scope (vs prompt's stated scope):**
- Touch core `meta.ts` in 3 functions (add an `excludeCampaignIds` skip to each primary bracket loop,
  add `campaign_id` to the requested fields). Non-Glasgow callers pass nothing → byte-identical
  behaviour.
- Replicate `partitionMetaSpendForCampaign("[WC26-GLASGOW-O2] TRAFFIC", adsetSpend)` in the new ad-set
  fetch so the O2/SWG3 ad-set rows get the same regular/presale partition the campaign path applies.
- D1-a engagement split must also live in the lifetime two-pass path (the cache), not only daily.
- New `glasgow-adset-rollup-fetch.ts` + runner wiring + the deletes/call-site removals from §"Stage B
  change set".

This is **cross-cutting** (6+ files incl. core shared `meta.ts`), in financial-attribution code that
already carries delicate Glasgow special-casing and a reconciliation-audit history
(`docs/RECONCILIATION_AUDIT_2026-05-05.md`, referenced by the umbrella module). Per the repo
tool-split heuristic, multi-file architectural work of this shape is the Cursor lane; per
`feedback_audit_first_discipline`, I'm surfacing rather than shipping a same-session fix to delicate
spend code. **Decision needed before any edit (see §9).**

## §9 — REVISED DECISIONS FOR MATAS

**D4 — How to implement the campaign exclusion?**
- (D4-a) Add `excludeCampaignIds?: string[]` to the three `meta.ts` fetch fns; add `campaign_id` to
  fields; skip excluded campaigns in each primary bracket loop. Glasgow path passes
  `[GLASGOW_TRAFFIC_CAMPAIGN_ID]`. Minimal, opt-in, non-Glasgow unaffected.
- (D4-b) Consolidate the ad-set split into a `wc26-glasgow-umbrella.ts`-style module that all three
  fetch paths consult (mirrors the existing umbrella pattern — most consistent with current
  architecture, slightly larger).

**D5 — Lane / sequencing.** Given the change is now cross-cutting core `meta.ts` across 3 fetch paths:
- (D5-a) Proceed here in the `cc/` worktree now (I understand the paths; I'll add tests for each).
- (D5-b) Hand to Cursor as a multi-file architectural PR (matches the tool-split heuristic; avoids
  same-day same-file collision since Cursor already has rollup-writer branches open).
- (D5-c) Narrow this PR to the **rollup write-time spend split only** (daily path), explicitly leave
  today-snapshot + lifetime-cache + engagement as a documented follow-up — smaller, lower-risk, but
  ships internally inconsistent Glasgow numbers (daily ≠ lifetime ≠ today) so NOT recommended.

## Tooling / environment notes

- Working in worktree `~/worktrees/glasgow-adset-rollup-writer` (branch `cc/glasgow-adset-rollup-writer`)
  because Cursor is live on `meta-campaign-builder` (main dir, branch
  `cursor/tiktok-breakdown-dedupe-and-deeplink-username`). Physical separation avoids the
  untracked-file sweep (`feedback_shared_dir_untracked_files_swept_into_other_tool`).
- **Same-file collision risk for Stage B:** active `cursor/` worktrees touch the rollup writer
  (`cursor-rollup-engagement-fanout-r2a`, `cursor-rollup-fanout-audit`, `cursor-glasgow-adset-split`).
  Stage B edits `rollup-sync-runner.ts`. Per CLAUDE.md rule 3 (never edit the same file in both tools
  the same day), confirm none of those Cursor branches is mid-edit on `rollup-sync-runner.ts` before
  Stage B writes begin.
- Meta MCP `ads_get_ad_entities` is down (`OTID` gateway error) — live truth re-pull deferred to PR review.
