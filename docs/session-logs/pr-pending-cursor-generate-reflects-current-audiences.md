## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/generate-reflects-current-audiences`

## Summary

Generate Suggestions now drops ad set rows whose source audience is no longer on the draft, imported or not, and keeps every row whose audience still exists exactly as it is. Stale rows that are still on the draft before Generate show a muted "audience removed" subtitle, stay disabled, do not block validation, and are counted on Review. An account-switch row disabled because its custom audience is missing uses the same subtitle.

## Scope / files

- `lib/wizard/import-edits.ts` — source lookup, merge result `{ suggestions, removed }`, review line
- `components/steps/budget-schedule.tsx` — undo notice and stale-row checkbox
- `lib/validation.ts`, `components/steps/review-launch.tsx`, `app/api/meta/launch-campaign/route.ts` — skip stale rows
- `lib/wizard/account-switch.ts` — shared subtitle match
- `lib/wizard/__tests__/generate-current-audiences.test.ts`

## Validation

- [x] `npm test` — 6656 node tests, 6652 pass, 4 skipped, 0 fail; vitest 6 pass
- [x] `npm run build`
- [ ] `npx tsc --noEmit` — covered by the production build

## Notes

On draft `[I26-NYC] Registration` the live mix is 11 custom rows with no group, 6 interest rows, 4 blanks, and an existing Innellea page row. Generate removes 11 and appends nothing. The synthetic test uses the written 15-custom contract. The production row was not written; the screenshot used a clone that was deleted.
