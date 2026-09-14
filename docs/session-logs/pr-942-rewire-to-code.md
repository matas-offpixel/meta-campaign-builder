# Session log

## PR

- **Number:** 942
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/942
- **Branch:** `cursor/rewire-to-code`

## Summary

One click to match the wiring. A campaignCode / event mismatch resolves to rewire, stamp_event, or ambiguous. The button is the consent. Bulk is rewire only, on the ids the operator previewed. A stamp is per-row and refuses when the client has more than one uncoded event. Nothing on Meta changes.

## Scope / files

- `lib/campaign-event-rewire.ts` — resolver; uncoded-event refusal; shared name fallback
- `lib/db/rewire.ts` — apply via `linkDraftToEvent` / `stampEventCode` (null guard) / `applyPreviewedRewires`
- `lib/db/events.ts` — `linkDraftToEvent` requires the caller client
- `lib/db/armed-campaigns.ts` — attach the resolution on the Armed GET
- `app/api/optimisation/campaigns/[id]/wiring` + `wiring-bulk` (previewed ids, rewire only)
- `components/optimisation/armed-campaign-row.tsx` — per-row stamp + rewire-only bulk
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5754 pass, 4 skipped)
- [ ] `frames:check` — CI

## Notes

- Prod dry-run 2026-09-14 after the uncoded-event rule: 42 disagreements. 4 rewire, 3 stamp_event, 35 ambiguous. The 11 Louder rows that used to stamp (including two armed Woraklis drafts wired to Colyn, and four Jamie Jones `IRW0004` drafts also on Colyn) are now ambiguous — Louder has 13 uncoded events.
- Remaining stamps, each a claim that the draft and the event are the same show: `Test003` → Test001; `V2-TEST-01` → TEST; `V2-TEST-01 (Copy)` → TEST.
- Armed tab: 2 rewire (AZYR and SCHAK, both Live), 0 stamp, 7 ambiguous.
