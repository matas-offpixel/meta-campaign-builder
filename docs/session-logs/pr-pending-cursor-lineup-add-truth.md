# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/lineup-add-truth`

## Summary

A lineup claim was treating the original save as a new artist. Only lab rows count, and a row is new only when it is more than a minute after the first lineup save, or after a stored lineup_add proposal. Re-saving the lineup keeps each artist's created_at.

## Scope / files

- `lib/releases/derived.ts` — `lineupRung` baseline
- `lib/db/releases.ts` — lab rows and the stored proposal time
- `lib/creative-lab/lineup.ts` — upsert, keeping `created_at`
- No migration

## Validation

- [x] `node --test` on the bank and lineup tests
- [ ] `npm test` (CI)
- [ ] `npm run build` (CI)
- [ ] frames:check (CI)

## Notes

No new words. No frame is expected to move. The design-pass label is not added.
