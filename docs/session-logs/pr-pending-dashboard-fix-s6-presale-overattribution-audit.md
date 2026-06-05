# Session log — S6 presale over-attribution mechanism (Stage A, audit-only)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/dashboard-fix-s6-presale-overattribution-audit`

## Summary

Stage A diagnosis of the +£10,664 portfolio presale over-attribution (Surface 6
/ Bug A from PR #536). Audit-only — no code changed. Traced the mechanism with
live Supabase queries and git archaeology and corrected two wrong premises:

1. The prompt's "two write-side branches (split vs replicate) in the allocator"
   is wrong. The allocator always divides presale correctly. The bug is a
   **clobber race** in `rollup-sync-runner.ts:724` (live on main): the Meta leg
   writes the full venue presale total to every sibling, clobbering the
   allocator's divided per-fixture share on siblings 2..N.
2. The audit's Surface 6 "umbrella double-attribution" hypothesis is wrong —
   it's intra-venue sibling clobber.

Found that a correct fix already exists as **open PR #499**
(`cc/presale-clobber-fix`, commit `6ccf788`, engagement-owner-only
`ad_spend_presale`) — unmerged. Flagged two blockers: its migration `102`
collides with main (now at `108`) and must renumber to `109`; and its migration
zeros ALL multi-fixture presale indiscriminately, which would regress the
currently-correct Brighton/Aberdeen/Margate to £0 because every presale window
is 57–143 days old (outside the 60-day cron) and cannot be repopulated without a
wider-window historical backfill.

## Deliverable

- `docs/dashboard-presale-overattribution-mechanism-2026-06-05.md`

## Scope / files

- Docs only. No production code touched. `venue-spend-allocator.ts`,
  `rollup-sync-runner.ts`, `paid-spend.ts`, `lib/insights/meta.ts` read-only.

## Validation

- [x] Mechanism verified against live DB (per-fixture/per-day presale shape,
      updated_at timestamps)
- [x] Clobber line confirmed live on main (`rollup-sync-runner.ts:724`)
- [x] PR #499 confirmed unmerged + migration collision identified

## Notes

- Recommendation: do NOT open a competing `cursor/` impl PR. Land PR #499's
  source fix (rebase + renumber migration 102→109) and add a one-shot historical
  rebalance reaching the full Jan–Apr presale window for all multi-fixture WC26
  venues, sequenced with the migration so correct venues are never left at £0.
- Coordinate with Matas / Claude Code (`cc/presale-clobber-fix` is a `cc/`
  branch — Cursor must not edit it per CLAUDE.md tool ownership).
