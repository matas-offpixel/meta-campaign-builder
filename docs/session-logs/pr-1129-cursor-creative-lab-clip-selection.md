# Session log

## PR

- **Number:** 1129
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1129
- **Branch:** `cursor/creative-lab-clip-selection`

## Summary

Creative Lab clip selection: a tick on each usable clip, persisted per event, and the generator, round matrix and renders read that selection. The Drive export UI is not in this PR.

## Scope / files

- `supabase/migrations/217_creative_lab_clip_selection.sql` (written, not applied)
- `lib/creative-lab/selection.ts`, `selection-store.ts`, `card-write.ts`, `propose.ts`
- `components/dashboard/events/creative-lab/clips.tsx`, `captions.tsx`, `round.tsx`, `lineup.tsx`
- CLS1–CLS4 frames

## Validation

- [x] `npm test`
- [x] `npm run build`
- [ ] `frames:check`

## Notes

PR #1125 (`cc/lab-live-fixes-1`) was still open, so Finding… and Importing… were built on main. Importing… reuses the candidate `importing` state. Generate keeps its own `writing` flag. Migration 217 is not applied. sha256 `5f6368b223b34e8baf392940c7869b2b74ac601b979fa62415574be54dfd74a0`.

Frame baselines (Ubuntu, `only=CL`, head `80873538be7e15e0e65b4715b10b153b826c00f2`): runs 42514713069 and 42514718120. CLS1–CLS4 added. CL1–CL10 and CLV1–CLV4 rewritten (the caption header and Write button sit in the voice frames). CLQ1–CLQ4 matched git and were left. CL5-1280 differs by 83 pixels between the two runs (0.0017%, under the 0.2% gate); the committed file is from 42514713069.

The event-page rail frames mount the same card, so IR1-1280 and IR2-1280 grew. Ubuntu `only=IR` runs 42515870907 and 42515876251 match byte for byte; those two files are committed from 42515870907. The other IR frames matched git.

Generate on Puzzle 4th Birthday (`a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8`), read-only against prod: `clipsAwaitingPreview` does not filter `clips.event_id`. It selects the six lineup clips (Enzo #1–#5 with `event_id` null, Luke #1 filmed at this show). None already have a caption, and the playable lengths are 21.7s ×4, 30s and 30s. The route had no production runtime errors and no runtime logs in the last day. The button cleared its notice and only put `json.notice` back, so a non-JSON failure, or a 200 that wrote nothing, left the generator blank. The set is now the lineup's lab artists — the rows the tiles show — and an empty or failed generate leaves "The captions didn't write — try again."
