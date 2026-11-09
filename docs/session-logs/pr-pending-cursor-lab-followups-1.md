## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/lab-followups-1`

## Summary

The border reset moves into `@layer base`, so a `border-{colour}` utility paints again, and the one-off `.border-on-media` rule is gone. Each selected, before a write, counts How many × the selected clips and says "Write to see these on the clips."

## Scope / files

- `app/globals.css`
- `components/dashboard/events/creative-lab/captions.tsx`
- `lib/creative-lab/selection.ts`
- `lib/creative-lab/__tests__/selection.test.ts`

## Validation

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `frames:check`

## Notes

Migration: none. The tick's white stays `--on-media`. Before a write the line is what Write will make (`3 captions × 4 clips = 12 previews` at the default). After a write it counts the captions that write returned. No clips selected still uses "No clip selected — select clips to see the captions on them."
