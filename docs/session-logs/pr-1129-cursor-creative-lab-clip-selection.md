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
- [x] `frames:check`

## Notes

#1125 is merged. Finding…, Importing… and Writing… use its spinner, and HeldLabel keeps the resting width. Generate keeps its own `writing` flag. Migration 217 is not applied. sha256 `5f6368b223b34e8baf392940c7869b2b74ac601b979fa62415574be54dfd74a0`.

Design verdict on `35bd1bc`: the tick uses a real white ring and a bold 12 px check; the count is bold and hidden when nothing is usable; Each selected is one writer call and the browser crosses every caption with every selected clip; "change on Clips" links to the Clips section and the empty round says to select a clip; the header Find reads every lineup artist with a handle; the artist picker is the segmented control with the rights chip. When every line the writer returns is already on the event, the notice is "Every line it wrote is already on this event — change the angle and write again".

Frame baselines (Ubuntu, `only=CL`, head `80873538be7e15e0e65b4715b10b153b826c00f2`): runs 42514713069 and 42514718120. CLS1–CLS4 added. CL1–CL10 and CLV1–CLV4 rewritten (the caption header and Write button sit in the voice frames). CLQ1–CLQ4 matched git and were left. CL5-1280 differs by 83 pixels between the two runs (0.0017%, under the 0.2% gate); the committed file is from 42514713069.

The event-page rail frames mount the same card, so IR1-1280 and IR2-1280 grew. Ubuntu `only=IR` runs 42515870907 and 42515876251 match byte for byte; those two files are committed from 42515870907. The other IR frames matched git.

Generate on Puzzle 4th Birthday (`a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8`), read-only against prod: `clipsAwaitingPreview` does not filter `clips.event_id`. It selects the six lineup clips (Enzo #1–#5 with `event_id` null, Luke #1 filmed at this show). None already have a caption, and the playable lengths are 21.7s ×4, 30s and 30s. The route had no production runtime errors and no runtime logs in the last day. The button cleared its notice and only put `json.notice` back, so a non-JSON failure, or a 200 that wrote nothing, left the generator blank. The set is now the lineup's lab artists — the rows the tiles show — and an empty or failed generate leaves "The captions didn't write — try again."

Rebase frames, Ubuntu, head `3f68550a64672d03a5b5b8d8d7727d9a4304e186`. `only=CL` runs 42520372258 and 42520375492. Byte-identical except CL5-1280 (83 px, 0.0017%) and CLS4-1280 / CLS4-393 (0 px over the 0.1 threshold). Committed from 42520372258: CL2–CL10 at both widths, CLS4 at both widths. CL1, CLV and CLQ matched git. `only=IR` runs 42520379169 and 42520382719 match byte for byte. Committed from 42520379169: IR1-1280, IR2-1280, IR7-393.

The tick's white is `--on-media`. The ring rule sits outside a layer so the border reset does not cover it. Each selected draws only the captions the latest write returned, with ✎ ✕ ✓ on the first preview of each. Find clips is disabled when no lineup artist has a handle. `NO_NEW_CLIPS` is gone.

Verdict frames, Ubuntu, head `89b74c4ce857dbef6b7e62d48e87f576e558c560`. `only=CL` runs 42525861102 and 42525863531. Byte-identical except CL5-1280 (83 px, 0.0017%) and CLS4-1280 (0 px over the 0.1 threshold). Committed from 42525861102: CL1–CL10 at both widths, CLS1–CLS4 at both widths, CLV1 at both widths, CLV2-1280, CLV3 and CLV4 at both widths. CLQ matched git. `only=IR` runs 42525865582 and 42525868065 match byte for byte. Committed from 42525865582: IR1-1280, IR2-1280.
