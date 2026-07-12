# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/bulk-attach-book-now-multi-placement-block`

## Summary

Escalates the bulk-attach CTA=BOOK_NOW + Dual/Full-mode warning from an
advisory banner to a hard launch block. Previously, choosing BOOK_NOW with
both a Feed (4:5/1:1) and a vertical (9:16) asset uploaded still let the
operator launch — `buildCreativePayload` silently falls back to a single
9:16 asset cross-published to every placement (Meta subcode 1885396,
PR #574/#575), dropping the 4:5 Feed asset with no error surfaced at launch
time. Live incident: WC26 Bournemouth, 2026-07-10 — 10 ads shipped 9:16 to
Feed placements. This PR disables the "Review & launch" and "Launch" buttons
in that scenario and replaces the amber warning with a red block-level
message.

Rebased on `main` after PR #718 ("Launch another variation to these ad sets"
relaunch flow) merged first — both PRs touched the same two wizard files.
The two features are orthogonal, so the rebase also extends the same gate to
PR #718's relaunch-panel "Continue to Configure creatives" button and the
"Launch another variation to these ad sets" trigger button, since a relaunch
of a BOOK_NOW + multi-placement creative would hit the identical Meta
constraint.

## Scope / files

- `lib/meta/creative.ts` — new exported detector `creativeHasBookNowMultiPlacementConflict(creative)`: true when CTA is BOOK_NOW, `assetMode !== "single"`, and any asset variation has both a Feed and a vertical asset uploaded. Reuses the `FEED_RATIOS` constant and `mapCTAToMeta` from the PR #575 fallback logic; checks every variation (broader than `detectMultiPlacement`, which only reads `assetVariations[0]`).
- `lib/meta/__tests__/creative-book-now-multi-placement-block.test.ts` — 7 unit tests (dual/full mode, non-zero variation index, single mode passthrough, non-BOOK_NOW passthrough, no-Feed-asset-yet, unuploaded assets, video assets).
- `components/steps/creatives.tsx` — per-creative CTA warning now uses the shared detector and renders as a red `destructive` block ("Can't launch: switch CTA to Buy Tickets to preserve per-placement asset routing.") instead of an amber advisory line.
- `app/(dashboard)/clients/[id]/bulk-attach/wizard.tsx` — all four launch-adjacent buttons now gate on `bookNowMultiPlacementConflicts.length > 0`: "Review & launch" (step 2→3), "Launch" (step 3), the relaunch panel's "Continue to Configure creatives" (only when "start from current" is checked — otherwise creatives reset to blank and can't conflict), and the "Launch another variation to these ad sets" trigger button. Matching red block messages/tooltips added at each site, mirroring the existing `assetCompletenessIssues` pattern.
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx` — same four gates + block messages (event-scoped wizard mirrors the client-scoped one, including its own copy of the PR #718 relaunch flow).

## Validation

- [x] `npm run build` — exit 0, no type errors
- [x] `npx eslint` on all touched files — 0 errors (pre-existing warnings only, verified unchanged via `git diff`)
- [x] `npm test` — new test file 7/7 passing, `summariseRelaunchGuard` (PR #718) still 6/6 passing; pre-existing unrelated failures (14 tests/suites — Mailchimp/Google Ads/dashboard fixtures, `@/lib` alias resolution under plain `node --test`, `creative-buy-tickets-cta.test.ts`) diffed byte-for-byte identical against a clean `origin/main` worktree — confirmed zero regressions from the rebase or this change

## Notes

Scoped narrowly per request ("small mechanical PR"): did not touch the main
single-campaign wizard's step-4 Continue gate (`components/wizard/wizard-shell.tsx`),
even though it shares the same `Creatives` component and thus now also shows
the escalated red banner — only the banner text/styling change propagates
there, not a hard block. If the same silent-drop bug should also hard-block
the main wizard, that's a follow-up PR.
