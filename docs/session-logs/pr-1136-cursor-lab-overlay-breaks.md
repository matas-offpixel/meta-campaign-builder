## PR

- **Number:** 1136
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1136
- **Branch:** `cursor/lab-overlay-breaks`

## Summary

After #1135 the writer puts each phrase on its own line, and validateCaption flattened those breaks back into one paragraph. A written line now wraps only within itself. A one-word line that is not last joins the next line. The event name, the venue, and a date that fit stay whole. "& more", the slash and empty-line refusals, and four_line are unchanged.

## Scope / files

- `lib/creative-lab/caption-facts.ts`
- `lib/creative-lab/__tests__/caption-facts.test.ts`

## Validation

- [x] `npm test`
- [ ] `npm run build` — CI
- [ ] `frames:check` — fixture captions still wrap to the lines they show

## Notes

Migration: none. Do not add the design-pass label.

Stored lines at long size:

- `Enzo Siragusa, Luke Dean, Reeshy & more` / `Circuit & Engine Rooms` / `27 December` → `["Enzo Siragusa,", "Luke Dean, Reeshy & more", "Circuit & Engine Rooms", "27 December"]`
- `Puzzle 4th Birthday` / `Enzo Siragusa, Luke Dean, Reeshy & more` / `27 December` → `["Puzzle 4th Birthday", "Enzo Siragusa,", "Luke Dean, Reeshy & more", "27 December"]`
- `POV:` / `You just saw the` / `Puzzle 4th Birthday` / `lineup` → `["POV: You just saw the", "Puzzle 4th Birthday", "lineup"]`
