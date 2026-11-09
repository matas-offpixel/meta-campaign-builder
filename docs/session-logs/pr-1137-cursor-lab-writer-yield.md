## PR

- **Number:** 1137
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1137
- **Branch:** `cursor/lab-writer-yield`

## Summary

A lineup write on Puzzle was keeping one caption of three because most candidates repeated an overlay already stored on the event, and the prompt still offered `{artist}` when the write had no artist. The first call now sees the 20 newest overlays of that style, normalised the same way as the duplicate key. If fewer than n are kept, one refill asks for the shortfall. A token is offered only when it has a value. Pick one counts its options across the written lines.

## Scope / files

- `lib/creative-lab/generate-log.ts`
- `lib/creative-lab/writer.ts`
- `lib/creative-lab/card-write.ts`
- `lib/creative-lab/caption-facts.ts`
- `lib/creative-lab/__tests__/writer.test.ts`
- `lib/creative-lab/__tests__/caption-facts.test.ts`
- `lib/creative-lab/__tests__/generate-live.test.ts`
- `lib/creative-lab/__tests__/each-new.test.ts`

## Validation

- [x] `npm test`
- [ ] `npm run build` — CI
- [ ] `frames:check` — no caption fixture or surface changed

## Notes

Migration: none. Do not add the design-pass label.

The generate log line carries `candidates`, `duplicates`, `rejects` and `calls`. Counts only. No caption text and no primary text.

Puzzle replay, lineup, Best of, How many 3, fake insert. Before is the measurement on this branch before the avoid-list. After is the same replay once the avoid-list, the refill, the token filter and the Pick one line count were in.

| Run | Kept | Candidates | Duplicates | Rejects | Calls |
|---|---|---|---|---|---|
| Before 1 | 0 | 7 | 5 | placeholder 1, pick_one 1 | — |
| Before 2 | 1 | 7 | 3 | placeholder 1, pick_one 1, generic_overlay 1 | — |
| Before 3 | 0 | 7 | 5 | placeholder 1, pick_one 1 | — |
| After 1 | 3 | 7 | 0 | generic_overlay 1, too_long 1, pick_one 1 | 1 |
| After 2 | 3 | 7 | 0 | generic_overlay 1, pick_one 1 | 1 |
| After 3 | 3 | 7 | 0 | generic_overlay 1, pick_one 1, too_long 1 | 1 |

The first call reached n each time, so the refill did not run. `too_long` is a candidate that used to be counted as a duplicate. The paragraph re-wrap was not built.
