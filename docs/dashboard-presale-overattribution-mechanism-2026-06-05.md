# Presale over-attribution — mechanism diagnosis (Stage A)

**Date:** 2026-06-05
**Scope:** Surface 6 / Bug A from `docs/dashboard-truth-audit-2026-06-04.md` (PR #536).
**Status:** AUDIT-ONLY. No code changed. Recommends a Stage B path that differs
from the original prompt — read "Recommendation" before opening any impl PR.
**Branch:** `cursor/dashboard-fix-s6-presale-overattribution-audit`

---

## TL;DR (three premise corrections + one blocker)

1. **The prompt's premise is wrong.** There is **no** "write-side branch in
   `venue-spend-allocator.ts` where some venues even-split and others
   replicate." The allocator **always divides presale correctly**
   (`venue-spend-allocator.ts:835` `presaleShare = presaleDayTotal / eventCount`).
   The divergence between Brighton (correct) and Edinburgh (broken) is **not** a
   branch in the allocator — it is a **write-order clobber race** between the
   rollup-sync **Meta leg** and the allocator.

2. **The audit's Surface 6 hypothesis is also wrong.** Surface 6 guessed
   "presale double-attributed to the umbrella bucket / cap presale attribution."
   The real mechanism is **intra-venue sibling clobber**: the Meta leg writes the
   *full venue presale total* to **every** sibling row
   (`rollup-sync-runner.ts:724`, live on `main`), and on sibling 2..N syncs it
   re-writes that column **after** the allocator divided it — clobbering the
   per-fixture share back up to the venue total. `SUM(ad_spend_presale)` per
   `event_code` then returns N × truth.

3. **A correct fix already exists and is unmerged: PR #499**
   (`cc/presale-clobber-fix`, opened 2026-06-02, commit `6ccf788`). It makes
   `ad_spend_presale` an **engagement-owner-only** column (owner writes the venue
   total, non-owners write NULL, `upsertMetaRollups` omits NULL so sibling 2..N
   syncs no longer clobber). This is the Option-A "fix the source" shape the
   prompt recommends — already written, with tests + a migration.

4. **BLOCKER for a naive merge of PR #499:** its `migration 102` both (a)
   **collides** with `main` (which now has `102`…`108`), and (b) **zeros ALL
   multi-fixture presale indiscriminately** — including the currently-**correct**
   even-split venues (Brighton, Aberdeen, Margate). Because **every** affected
   presale window is **57–143 days old** (all Jan–Apr 2026), the live 60-day cron
   **cannot repopulate** them. Running migration 102 + relying on the live cron
   would **regress Brighton from +£119 to −£1,585** (presale dropped to £0). A
   wider-window historical backfill is mandatory and is **not** in PR #499.

---

## 1. Data flow (read side) — why all four surfaces inherit the bug

```
event_daily_rollups.ad_spend_presale
  → paid-spend.ts:8-22  metaPaidSpendOf()  =  (ad_spend_allocated ?? ad_spend) + ad_spend_presale
     → Topline:            client-dashboard-aggregations.ts (clientWidePaidSpendOf, per-row SUM)
     → Venue Report:       venue-canonical-funnel.ts sumVenueSpend (SUM allocated + presale)
     → Performance Summary: client-dashboard-aggregations.ts aggregateVenueCampaignPerformance
     → Funnel Pacing:      same buildVenueCanonicalFunnel
```

All four read `SUM(ad_spend_allocated) + SUM(ad_spend_presale)` per `event_code`.
None of them is wrong — they faithfully sum what the writer persisted. The fix
must be **write-side** (per `feedback_no_fallback_papering_over_broken_source`).

---

## 2. Verified DB shape (Supabase, client `37906506-…561a`, 2026-06-05)

### 2a. Per-fixture lifetime presale — replicated vs even-split

| event_code | fixtures | per-fixture SUM(presale) | SUM across fixtures | Meta truth | shape |
|---|--:|--:|--:|--:|---|
| WC26-BRIGHTON | 4 | £426.13 each | **£1,704.52** | £1,704 | **even-split ✓** (each = total ÷ 4) |
| WC26-ABERDEEN | 3 | £149.55 each | **£448.65** | £448.65 | **even-split ✓** |
| WC26-EDINBURGH | 3 | £448.58 each | **£1,345.74** | £448.65 | **replicated ✗** (each = full total) |
| WC26-BIRMINGHAM | 4 | £440.09 each | **£1,760.36** | £440.09 | **replicated ✗** |
| WC26-MANCHESTER | 4 | 236.49 / 375.50 / 236.49 / 236.49 | **£1,084.97** | ~£1,085 | mixed, nets ✓ |

### 2b. Per-day proof (the distinguishing signal)

The naive "all siblings equal on a day" test does **NOT** distinguish broken from
correct — **both** shapes make all siblings equal per day. The difference is
whether each fixture's value equals the **venue-day total** (replicated) or
**venue-day total ÷ n** (split):

- **Brighton 2026-02-27:** each of 4 fixtures = £6.16 → venue-day total £24.64,
  per-fixture = total ÷ 4. **Even-split.**
- **Edinburgh 2026-01-24:** each of 3 fixtures = £145.23 → `SUM` = £435.69, but
  the Meta venue-day total **is** £145.23. Each fixture carries the **full** day
  total. **Replicated (3×).**

### 2c. Affected-venue inventory + historical presale windows

| event_code | fixtures | presale window | days_all_equal | days_split | verdict |
|---|--:|---|--:|--:|---|
| WC26-BIRMINGHAM | 4 | 2026-01-13 → 01-29 | 17 | 0 | replicated ✗ |
| WC26-BOURNEMOUTH | 4 | 2026-01-13 → 01-29 | 17 | 0 | replicated ✗ |
| WC26-BRISTOL | 4 | 2026-01-13 → 01-29 | 17 | 0 | replicated ✗ |
| WC26-LEEDS | 4 | 2026-01-13 → 01-29 | 17 | 0 | replicated ✗ |
| WC26-NEWCASTLE | 4 | 2026-01-13 → 01-29 | 17 | 0 | replicated ✗ |
| WC26-EDINBURGH | 3 | 2026-01-21 → 01-26 | 6 | 0 | replicated ✗ |
| WC26-GLASGOW-SWG3 | 3 | 2026-01-21 → 01-26 | 6 | 0 | replicated ✗ |
| WC26-ABERDEEN | 3 | 2026-02-05 → 02-16 | 12 | 0 | **even-split ✓** |
| WC26-MARGATE | 4 | 2026-03-12 → 03-24 | 13 | 0 | **even-split ✓** |
| WC26-BRIGHTON | 4 | 2026-02-27 → 03-26 | 28 | 0 | **even-split ✓** |
| WC26-MANCHESTER | 4 | 2026-03-31 → 04-09 | 6 | 4 | mixed, nets ✓ |
| WC26-LONDON-PRESALE | 1 | 2026-01-13 → 01-29 | 0 | 0 | solo (n/a) |

**Every** presale window ends on or before 2026-04-09 — i.e. **≥ 57 days** before
today (2026-06-05), and most are **120–143 days** old. This is the crux of the
backfill problem (§5).

---

## 3. Code-level mechanism (the clobber race)

### 3a. Allocator presale handling is CORRECT (read-only confirmation)

- WC26 opponent path: `venue-spend-allocator.ts:833-835` computes
  `presaleShare = presaleDayTotal / eventCount`; `:926` writes that share to
  **every** sibling for the day. `SUM` over siblings = `presaleDayTotal`. ✓
- Non-WC26 path: `equalSplitNonWc26AllocatedSpend` `:437`
  `presaleShares = equalSplitMonetaryAmounts(venuePresale, n)`. ✓
- Solo path: `soloPassThroughAllocatedSpend` `:256` writes the full per-event
  presale (correct — only one row exists). ✓

There is **no allocator branch that replicates** across multiple siblings.

### 3b. The Meta leg clobbers (the actual bug — live on `main`)

`lib/dashboard/rollup-sync-runner.ts:719-736` builds `metaRows`. The
engagement-fanout fix (#471 PR-A.5) made `link_clicks`, `landing_page_views`,
`meta_regs`, … **engagement-owner-only** via `ownedOrNull(...)`. But
`ad_spend_presale` was **left per-fixture** (`main:724`):

```
ad_spend: v.ad_spend,
ad_spend_presale: v.ad_spend_presale,   // ← writes the FULL venue total to EVERY sibling
link_clicks: ownedOrNull(v.link_clicks),
...
```

`runRollupSyncForEvent` runs **once per sibling** (each fixture triggers its own
sync). The venue allocator is batch-deduped per `(client_id, event_code)`. So:

1. Sibling 1 syncs → Meta leg writes full venue presale to sibling 1 → allocator
   runs, divides, writes `total/n` to **all** siblings. State correct.
2. Sibling 2 syncs → Meta leg writes the **full venue total** onto sibling 2
   again, **clobbering** the allocator's `total/n` share — and the allocator pass
   for this event_code is deduped/skipped (already ran this cycle), so the
   divided value is not restored.
3. …repeat for siblings 3..N. Final state: every sibling carries the full venue
   total → `SUM` = N × truth.

Whether a venue ends up correct or broken depends purely on **which sibling
synced last** and whether the allocator re-ran after it. Brighton/Aberdeen/Margate
happened to end on an allocator pass; the 7 replicated venues ended on a
clobbering Meta leg. This is why the same code version (writes on 2026-05-29 for
both Edinburgh @17:08 and Brighton @19:02) produced different shapes — **not** a
per-venue branch.

---

## 4. The existing fix — PR #499 (`cc/presale-clobber-fix`, commit `6ccf788`)

Opened 2026-06-02 (Matas, co-authored Cursor). **Not on `main`.** It implements
exactly the Option-A source fix:

- `rollup-sync-runner.ts:724` → `ad_spend_presale: ownedOrNull(v.ad_spend_presale)`
  (owner writes venue total; non-owners NULL; `upsertMetaRollups` omits NULL so
  sibling 2..N syncs no longer clobber).
- `venue-spend-allocator.ts` comments updated; non-WC26/solo read the owner
  (`primaryId` is the engagement owner) so they keep a valid value.
- `migration 102_recompute_allocator_owned_columns.sql` — zeros multi-fixture
  clobbered rows so the next allocator pass rewrites correct shares.
- Tests: `venue-spend-allocator.test.ts` (+74), `upsert-noop-guard.test.ts` (+52),
  `event-daily-rollups.ts` rework.

This is correct in shape and well-tested. **Do not duplicate it** in a competing
`cursor/` PR (it is a `cc/` branch — Claude Code owned per `CLAUDE.md` tool
ownership).

---

## 5. Two blockers PR #499 does not yet resolve

### 5a. Migration number collision
PR #499 adds `supabase/migrations/102_recompute_allocator_owned_columns.sql`, but
`main` already has `102`…`108` (latest `108_ironworks_spark_backfill_2.sql`). The
migration must be **renumbered to `109`** on rebase.

### 5b. Indiscriminate zero + out-of-window repopulation = regression risk
Migration 102's `HAVING COUNT(DISTINCT r.ad_spend_presale) = 1` matches **every**
multi-fixture venue with equal per-day presale — which includes the
currently-**correct** even-split venues (Brighton, Aberdeen, Margate), because
even-split also makes siblings equal per day (§2b). So the migration zeros
**all** of them and relies on a re-sync to repopulate.

But the allocator can only reach `requestedSince − MAX_ALLOCATOR_BACKFILL_DAYS`
(60 days; `venue-spend-allocator.ts:1058`), i.e. an effective ceiling of ~120
days from today even with the extension, and the live cron's `since` is
`today − 60`. **All** presale windows are 57–143 days old (§2c). Therefore:

- Live cron **cannot** re-touch the Jan–Mar presale dates.
- Migration 102 + live cron alone would set Brighton/Aberdeen/Margate presale to
  **£0** with no repopulation → **regression** (Brighton +£119 → −£1,585).

A **historical backfill that reaches the full presale window** is mandatory and
is not in PR #499.

---

## 6. Recommendation (Stage B)

**Do not open a competing `cursor/` allocator PR.** Instead, in coordination with
the allocator owner (Matas / Claude Code, who owns `cc/presale-clobber-fix`):

1. **Land PR #499's source fix** (engagement-owner-only `ad_spend_presale`),
   rebased onto `main` with the migration **renumbered `102 → 109`**.
2. **Add a one-shot historical rebalance** that reaches the full presale window
   for **all** multi-fixture WC26 venues (broken *and* the zeroed-correct ones).
   Cleanest shape: an admin route that invokes `allocateVenueSpendForCode` with an
   **explicit historical `since`** (bypassing the 60-day cap for this one-shot)
   per affected `event_code`, so the allocator re-fetches the Meta presale total
   per day and writes `total/n` per fixture. This handles replicated and
   even-split venues uniformly and is durable once the §3b clobber is fixed.
   - Mirror the auth + `PUBLIC_PREFIXES` carve-out pattern from PR #494's
     `event-legacy-spend-backfill` route.
   - Must **not** widen the live cron's 60-day cap (PR #481 / #479 silent-drop).
3. **Sequencing matters:** the migration zero and the historical rebalance must
   land together (or the rebalance must run immediately after the migration) so
   the correct venues are never left at £0 in a deployed state.

### Verification gate (Stage B)
Run the `effective_paid` vs Meta-truth query from the prompt; **every**
`ABS(drift) ≤ £150`, including:
- The 7 replicated venues drop to truth (Edinburgh £8,738 → ~£7,840; Birmingham
  £5,518 → ~£4,159; etc.).
- Brighton (£8,955, +£119), Aberdeen (£3,283, +£26), Margate (£1,985, +£17),
  Manchester (£10,551, +£128) **stay unchanged** (not zeroed).
- PR #539 (daily-tracker manual-source suppression) and PR #542 (Topline
  ONSALE+PRESALE) remain intact.

---

## 7. Evidence appendix (queries run)

All against project `zbtldbfjbhfvpksmdvnt`, client `37906506-…561a`, 2026-06-05.

- Per-fixture lifetime presale (§2a): `GROUP BY event_code, event_id`.
- Per-day min/max/sum + `updated_at` (§2b, §3b): confirmed Edinburgh/Birmingham
  `min_p == max_p == venue-day total` (replicated); Brighton `each = day_total/4`
  (even-split). Edinburgh/Birmingham last `updated_at` = 2026-05-29 (after the
  #355 sibling-by-event_code fix of 2026-05-08 → rules out solo-grouping as the
  cause and points to the Meta-leg clobber).
- Affected inventory + windows (§2c): `days_all_equal` / `days_split` per
  event_code.
- Code confirmation: `rollup-sync-runner.ts:724` writes presale per-fixture on
  `main` (clobber live); PR #499 `6ccf788` changes it to `ownedOrNull(...)`.
