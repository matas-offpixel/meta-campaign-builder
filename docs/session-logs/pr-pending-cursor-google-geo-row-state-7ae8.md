# Google Search geo rows keep edits and the right match

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/google-geo-row-state-7ae8`

## Summary

Google Search geo rows were keyed by index and updated from the tree captured at render. A late suggest response wrote an old `geo_targets` array (a second row disappeared) and could store Newcastle's id on a row whose text was already "United Kingdom". Push then skipped suggest because `resolved_resource_name` was set. Rows now have a client-only id, updates apply to the latest list by that id, a response is stored only when the row's text still matches, and push ignores a stored id whose canonical name does not start with the typed location.

## Scope / files

- `components/google-search-wizard/steps/targeting-budget.tsx` — stable row id, abort in-flight suggest on each keystroke and on unmount, empty "Add geo". Wizard and the MML Google drawer both mount this step. No other `resolve-geo` caller.
- `lib/google-search/geo-row-state.ts` — pure row updates and the name/text check.
- `lib/google-ads/campaign-writer.ts` — both suggest skips use that check.
- `lib/google-search/validation.ts` — Review warning `geo_resolution_mismatch` (does not hard-block, so push can still re-resolve).
- `components/plan/google-drawer-details.tsx` — collapsed geo label uses the same check.
- `lib/google-search/geo-targets-codec.ts` — unchanged. It drops unknown keys, so a client id and `resolved_for` are not saved. Push compares `resolved_name` to the location text instead.

## Validation

- [x] `npx tsc --noEmit` (no errors in the files above; the repo still has existing errors elsewhere)
- [x] `npm run build`
- [x] `npm test` (7406 pass, 0 fail, 4 skipped, plus 8 vitest)

## Notes

Did not persist `resolved_for`. The codec rebuilds each target from `location`, `bid_modifier_pct`, and the optional `resolved_*` keys. A stored id is trusted only when there is no canonical name, or the canonical name starts with the typed text after punctuation is folded to spaces. "United Kingdom" does not match "Newcastle upon Tyne, England, United Kingdom". "sunderlan" does match "Sunderland, England, United Kingdom". `components/google-ads/plan-builder.tsx` is a different country/city editor and was left alone.
