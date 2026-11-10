# Session log

## PR

- **Number:** 1180
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1180
- **Branch:** `cursor/clips-too-small-916`

## Summary

Existing Lab clips whose 9:16 crop window is under 675 px stay in the library. The tile reads "Too small for 9:16" and the clip cannot be ticked into a selection, a round, a T1 template, or a caption render. New imports are unchanged.

## Scope / files

- `lib/creative-lab/import-quality.ts` — `tooSmallFor916` via `footageWindow`
- `lib/creative-lab/surface.ts`, `selection.ts`, `clips.tsx` — tile status and the tick
- `lib/creative-lab/propose.ts`, `card-write.ts`, `render.ts` — round, generate, and render gates
- `scripts/t1-video-drafts.mts` — no template when the 9:16 window is under 675
- `scripts/untick-too-small-916.mts` — dry-run list for Puzzle's Luke clips

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (CI; a worktree symlink panics a local Turbopack build)
- [ ] `npm test` (the surface, propose, and render cases)

## Notes

No migration. Dimensions come from the moov probe the event page already runs. A missing size is not a refusal.

Puzzle 4th Birthday is in selection mode `chosen`. Dry run, nothing written:

- Luke 1 `5604f7f6-b3ae-4825-9f3c-e98c2fd38ef6` — 956 × 718, 9:16 window 404 px. Selection row is already false.
- Luke 15 `fcbff7df-3199-467f-85ed-2bda7f3d8569` — 1920 × 1080, 608 px. No selection row.
- Luke 16 `34eac259-e316-48e1-8abf-ffe257af9f44` — 1920 × 1080, 608 px. No selection row.
- Luke 18 `c826692d-fa66-497c-ac4a-f58487d8f62e` — 1920 × 1080, 608 px. No selection row.
- Luke 21 `7eae7f7b-e619-4199-999b-ac64a0e999b8` — 1920 × 1080, 608 px. No selection row.

Zero rows would be unticked. The gate leaves all five out of a round, a template and a render.
