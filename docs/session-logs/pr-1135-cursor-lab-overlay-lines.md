## PR

- **Number:** 1135
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1135
- **Branch:** `cursor/lab-overlay-lines`

## Summary

Puzzle's overlay rendered as "Puzzle 4th Birthday / / Enzo Siragusa, / Luke Dean, Reeshy & / more / Southampton / 27 December" because the writer copied " / " from the lineup examples and the line breaker treated "/" as a word. Line breaks are now the only separator. "& more" stays one phrase, a lone "more", "&" or "w/" is pulled onto a neighbour line, and an empty line, a slash or pipe separator, or more than the style's max lines is refused with "This caption is too long — shorten it." A stored row with those lines cannot render.

## Scope / files

- `lib/creative-lab/writer.ts` — overlay contract
- `lib/creative-lab/corpus.ts` — lineup examples use line breaks
- `lib/creative-lab/caption-facts.ts` — glue, rebalance, refusal
- `lib/creative-lab/render.ts` — the same refusal before a burn
- `lib/creative-lab/__tests__/caption-facts.test.ts` — the Puzzle caption

## Validation

- [x] `npm test`
- [x] `npm run build`
- [ ] `frames:check` — fixture lines did not reflow; none re-shot unless CI shows a mover

## Notes

Migration: none. The exact stored lines are `["Puzzle 4th Birthday", "", "Enzo Siragusa,", "Luke Dean, Reeshy &", "more", "Southampton", "27 December"]`. Long size stays 5 lines of 24.
