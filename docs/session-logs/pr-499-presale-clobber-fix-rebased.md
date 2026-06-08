# PR #499 — presale clobber fix (Stage B, rebased)

**Date:** 2026-06-05 (opened) → 2026-06-08 (rebased + finalised)
**Branch:** `cc/presale-clobber-fix`
**Stage A audit:** `docs/dashboard-presale-overattribution-mechanism-2026-06-05.md` (PR #543)
**Tool:** Claude Code (cc/ branch — Claude Code owned per CLAUDE.md)

---

## What this PR fixes

The Meta leg of rollup-sync wrote the **full venue presale total** to **every**
sibling row of a multi-fixture `event_code`. The venue allocator divides presale
correctly on the first sibling's sync, but it is batch-deduped per
`(client_id, event_code)`, so subsequent sibling syncs re-wrote the column back
to the venue total — clobbering the allocator's divided share on siblings 2..N.
`SUM(ad_spend_presale)` per `event_code` then returned **N × truth**.

**Core fix** (`lib/dashboard/rollup-sync-runner.ts:735`): `ad_spend_presale`
joins the engagement-owner-only column group (`ownedOrNull`) alongside
`link_clicks`, `landing_page_views`, `meta_regs`. Owner writes the venue total,
non-owners write NULL, `upsertMetaRollups` omits NULL, allocator divides. Tests:
`venue-spend-allocator.test.ts`, `upsert-noop-guard.test.ts`.

---

## Premise corrections (vs the original Stage B prompt)

The original prompt described a migration and guardrails that did **not** match
reality. Corrected before implementing:

1. **The prompt's `102_presale_zero_multi_fixture_clobbered.sql` did not exist.**
   The real migration was `102_recompute_allocator_owned_columns.sql`, and its
   logic (`HAVING COUNT(DISTINCT ad_spend_presale) = 1`) zeroed **all** equal-
   valued multi-fixture siblings — including the currently-**correct** even-split
   venues (Brighton, Aberdeen, Margate). That would have regressed Brighton
   +£119 → −£1,585 in the deploy gap.
2. **The prompt said "do not touch `venue-spend-allocator.ts`."** PR #499 already
   modifies it (comments + the non-WC26 owner-read note) — that is intended PR
   content, not drift.
3. **The prompt's "Fix 2" (zero non-owner rows, keep owner)** would itself
   regress even-split venues: their owner row carries `total/n`, not the full
   total, so `SUM` would collapse. The engagement-owner proxy cannot distinguish
   replicated from even-split (audit §2b).

**Decision (per AskUserQuestion):** zero **broken-only**. Migration zeros
`ad_spend_presale` for **only the 7 verified replicated venues** (BIRMINGHAM,
BOURNEMOUTH, BRISTOL, LEEDS, NEWCASTLE, EDINBURGH, GLASGOW-SWG3), scoped to client
`37906506-…561a`. Even-split + mixed-correct venues are never touched. The
one-shot backfill route does the redistribution.

---

## The Cursor collision (2026-06-05 → 06-08)

Cursor was running in the **same working directory** on `cc/presale-clobber-fix`
doing unrelated asset-queue / customer-audience work (PR #578/#587). This caused:

- Cursor repeatedly **reverted** in-place edits to shared files
  (`public-routes.ts`, `package.json`) within seconds (stale-buffer hazard,
  CLAUDE.md rule #6).
- My two **new** files (`109_presale_zero_clobbered_broken_venues.sql` and
  `app/api/admin/event-presale-backfill/route.ts`), being untracked, were swept
  into Cursor's commit `59bcfa8` and **merged to `main` via PR #578** — but
  **without** the carve-out and **without** the core source fix.

**Net state discovered on 2026-06-08:**
- Migration `109` (broken-only, my content) — **file on main, NOT applied to the
  DB** (`list_migrations` shows no presale_zero entry).
- Backfill route — **on main but unreachable** (no `PUBLIC_PREFIXES` carve-out →
  proxy 307s the Bearer curl to /login).
- Core source fix — **still only on this branch** (PR #499 open).
- The 7 venues are **still inflated in prod** (EDINBURGH £1,345.74, BIRMINGHAM
  £1,760.36, …); even-split venues correct (BRIGHTON £1,704.52). **No data
  damage** — the original bug is simply still live.

---

## What this PR commit now contains

- Core source fix (`rollup-sync-runner.ts`, `venue-spend-allocator.ts`,
  `event-daily-rollups.ts`) + tests — rebased onto current `origin/main`.
- **Removed** the superseded `102_recompute_allocator_owned_columns.sql`
  (replaced by `109`, already on main).
- **Added** the `PUBLIC_PREFIXES` carve-out for `/api/admin/event-presale-backfill`
  — this is what actually makes the already-merged route reachable.
- **Test-harness fix:** `server-only` devDependency + `--conditions react-server`
  on the `test` script. `event-daily-rollups.ts` / `creative-insight-snapshots.ts`
  do `import "server-only"`, which Next provides at bundle time but `node --test`
  cannot resolve; the new test (`upsert-noop-guard.test.ts`) never actually ran
  green before (no CI exists). Now 18/18 pass.

**Not in this PR (already on main via PR #578):** migration `109`, the backfill
route file.

**Pre-existing main test failures (NOT this PR):** `lib/clients/asset-queue/__tests__/`
`copy-generator` + `sheet-parse` use extensionless relative imports that
`node --test` cannot resolve; one `graphGetWithToken` assertion. Fail with or
without this PR's flag — Cursor-owned, out of scope.

---

## Post-merge runbook

1. Merge PR #499 (force-push first — branch is rebased onto current main).
2. **Apply migration 109** in Supabase (it is on main but unapplied). Run the
   pre-flight SELECT in the migration header first; confirm it touches **only**
   the 7 broken venues (Brighton/Aberdeen/Margate/Manchester must NOT appear).
3. **Run the backfill** (now reachable via the carve-out):
   ```
   curl -X POST https://app.offpixel.co.uk/api/admin/event-presale-backfill \
     -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
     -d '{"client_id":"37906506-56b7-4d58-ab62-1b042e2b561a"}'
   ```
   The route passes an explicit historical `since` (default 365d) which the
   allocator honours (`resolveAllocatorSince` only extends backward, never clamps
   forward) — reaching the Jan–Apr 2026 presale windows the 60-day cron cannot.
4. **Verify** with the effective-vs-truth query (audit §6): every `ABS(drift) ≤
   £150`; the 7 venues drop to truth; Brighton/Aberdeen/Margate/Manchester
   unchanged. Migration + backfill must run together (audit §6.3) so no venue is
   left at £0 in a deployed state.

## Follow-up for the human (Cursor branch cleanup)

Commit `59bcfa8` on `cursor/asset-queue-regression-fixes` (already on main via
PR #578) contains the two presale files that don't belong to the asset-queue
work. They are harmless on main (route gated, migration unapplied) but were a
cross-tool contamination — noted here for the record. Future parallel work must
use separate worktrees (CLAUDE.md rule #6).
