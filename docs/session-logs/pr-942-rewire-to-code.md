# Session log

## PR

- **Number:** 942
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/942
- **Branch:** `cursor/rewire-to-code`

## Summary

One click to match the wiring. A campaignCode / event mismatch resolves to rewire, stamp_event, or ambiguous. The button is the consent; bulk is a preview of the same per-row path. Nothing on Meta changes.

## Scope / files

- `lib/campaign-event-rewire.ts` — resolver
- `lib/db/rewire.ts` — apply via `linkDraftToEvent` / `stampEventCode`
- `lib/db/events.ts` — `linkDraftToEvent` accepts the caller client (same lock)
- `lib/db/armed-campaigns.ts` — attach the resolution on the Armed GET
- `app/api/optimisation/campaigns/[id]/wiring` + `wiring-bulk`
- `components/optimisation/armed-campaign-row.tsx` — per-row button + bulk preview
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5751 pass, 4 skipped)
- [ ] `frames:check` — local `next start` has no Supabase env; CI is the raster truth. `components/plan/**` is not in this diff.

## Notes

- Prod dry-run 2026-09-14 against `f441cdf` main: 42 drafts with a code/event disagreement. 4 rewire, 14 stamp_event, 24 ambiguous. Armed tab: 2 rewire (NX26-AZYR and NX26-SCHAK, both Live), 3 stamp_event, 4 ambiguous.
- Stamp writes `events.event_code`. Woraklis drafts are wired to Colyn today; a stamp on those rows would write Colyn. Four unarmed Jamie Jones drafts (`IRW0004`) are also wired to Colyn — same risk, not on the Armed tab. The preview names from → to. Per-row the operator can skip.
