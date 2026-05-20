# Session log — Bulk page audiences: followers emit one cell

## PR

- **Number:** 435
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/435
- **Branch:** `cursor/creator/bulk-page-followers-no-retention`

## Summary

The Bulk Page Audiences matrix builder was multiplying followers subtypes
across every ticked retention window, producing identical duplicate audiences.
Page-followers Custom Audiences are always-live on Meta (the payload builder
already forces `retention_seconds=0`), so "FB followers 30d / 60d / 180d /
365d" are four identical Meta audiences. Confirmed live 2026-05-20: a
4-subtype × 4-retention Innervisions run created 8 redundant follower
audiences. This PR fixes `buildPagePreview` to emit exactly ONE cell per
followers subtype, regardless of how many retention windows are ticked.
Engagement subtypes keep the full matrix unchanged.

## Scope / files

- `lib/audiences/bulk-page-types.ts` — Core fix. `isFollowersSubtype` is now
  a type predicate (was `boolean`, now `subtype is "page_followers_fb" |
  "page_followers_ig"` — enables TypeScript narrowing into `FOLLOWERS_CELL_PHRASE`).
  Added `FOLLOWERS_CELL_PHRASE` (lookup for the no-retention name: "FB page
  followers" / "IG page followers") and `FOLLOWERS_RETENTION_SENTINEL = 365`
  (matching funnel-presets convention for always-live audiences). In
  `buildPagePreview`, the followers branch now `continue`s after pushing a
  single cell; engagement subtypes iterate over `opts.retentions` as before.
  The single followers cell carries `retentionDays: 365` (stored in DB; Meta
  ignores this, forcing `retention_seconds=0` in the payload), funnel stage
  `top_of_funnel`, and a name without any `Nd` suffix
  (e.g. `[innervisions] FB page followers`).

- `app/(dashboard)/audiences/[clientId]/bulk-page/bulk-page-form.tsx` — UI.
  Updated Step 2 description ("Followers subtypes always produce exactly one
  audience — retention not applicable"). Added a contextual note at Step 3
  (retention) shown only when a followers subtype is ticked: "Retention not
  applicable to followers — one audience each regardless of how many windows
  are ticked." Preview cell display shows "always-live" instead of "365d" for
  followers cells.

- `lib/audiences/__tests__/bulk-page.test.ts` — Tests updated + 3 new tests.
  - Updated "2 subtypes × 4 retentions" → 5 cells (engagement×4 + followers×1).
  - Updated "4 subtypes × 4 retentions" → 10 cells (2 eng×4 + 2 fol×1).
  - New: "followers always produce exactly 1 cell regardless of retention count".
  - New: "followers cell has NO retention suffix (always-live naming)".
  - New: "labelOverride applied to followers cell name".
  - New: "only engagement subtypes still produce the full N×M matrix".

## Validation

- [x] `npm run build` — green (type-predicate fix required for `FOLLOWERS_CELL_PHRASE` indexing).
- [x] `node --experimental-strip-types --test` — 32/32 pass.
- [x] `npm run lint` — no new errors from changed files.

## Notes

Post-merge cleanup (for Matas, not this PR): archive the 8 redundant
Innervisions follower audiences from the 2026-05-20 run — keep one
FB followers + one IG followers, archive the other 6.
