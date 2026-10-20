# Session log

## PR

- **Number:** 724
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/724
- **Branch:** `cursor/lp-admin-save-preserves-artwork`

## Summary

P0 fix: every admin dashboard save silently wiped `content.artwork_url` from
the rendered landing page. Root cause: `rebuildModulesFromLegacy`
(`lib/admin/page-modules-sync.ts`) rebuilds `page_events.modules` — the LP
renderer's post-migration-139 source of truth for the hero carousel — from
`heroImages`/`youtubeUrl`/`bottomImages`/`brand*` only. It had no parameter
for `content.artwork_url`, so any admin-uploaded artwork was dropped from
`modules.hero_carousel.images` on every save, even when nothing about the
artwork itself changed. Manually SQL-patched 3× today on the Jackies Mallorca
LP (`page_event_id 40873449-8464-4f87-a035-40cef5a7b79d`) before this fix.

Fix: `rebuildModulesFromLegacy` now takes `artworkUrl: string | null` and
always pins it to hero-carousel slide 1 when present, deduped against
`heroImages` so manually re-adding the same artwork never double-renders it.
The one real call site (`modulesFor` in `lib/actions/update-page-event.ts`,
which every admin mutation — save / upload / remove / reorder — funnels
through) now extracts `artworkUrl` from the post-mutation `content` object it
was already receiving, so all four call sites pick up the fix without
individually threading a new parameter.

## Scope / files

- `lib/admin/page-modules-sync.ts` — `LegacyModuleInputs.artworkUrl` +
  hero-carousel build logic (pin + dedup)
- `lib/actions/update-page-event.ts` — `modulesFor` now reads
  `content.artwork_url` and passes it through (single change point; covers
  `savePageEvent`, `uploadPageImage`, `removePageImage`, `reorderPageImage`)
- `lib/admin/__tests__/page-modules-sync.test.ts` — added 4 artwork cases +
  updated the 3 existing cases for the new required field

## Validation

- [x] `npm test` (`node --experimental-strip-types --test 'lib/admin/__tests__/page-modules-sync.test.ts'`) — 7/7 pass, including all 4 requested cases (artwork+empty hero, artwork+3 hero, artwork+dupe-in-hero dedup, null artwork byte-identical)
- [x] Full `lib/**/__tests__/*.test.ts` — 3103/3117 pass; same 14 pre-existing, unrelated failures as the prior baseline, zero new failures
- [x] `npx eslint` on all 3 changed files — clean
- [x] `npx tsc --noEmit` — no new errors (447 pre-existing lines vs 440 prior baseline, none referencing these files)

## Notes

- Confirmed the only actual caller of `rebuildModulesFromLegacy` is the
  `modulesFor` helper in `update-page-event.ts` (grepped); it's called from
  all 4 admin mutation paths, all of which already pass the post-mutation
  `content` object (with `artwork_url` set/cleared/unchanged as
  appropriate) as the first argument — so one edit point covers every
  caller, per the ask's Change 2.
- Did NOT touch `resolveModuleSources` (reader side) or move/collapse
  `artwork_url` — both explicitly out of scope per the ask's DO NOT list.
- No migration/backfill: existing pages self-heal on their next admin save
  (per the ask's Change 4).
- **Not self-merging** — flagged for Matas review per the ask ("Do NOT
  self-merge"). This is a live P0 (3 manual SQL patches today on the Jackies
  Mallorca LP) blocking 3 other LP polish tasks, so flagging for fast review.
