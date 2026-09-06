# Session log

## PR

- **Number:** 902
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/902
- **Branch:** `cursor/plan-v2-share-parity`

## Summary

Canon §1.6 share-link parity. `/share/plan/[id]` opens one plan, never the list, and renders LAUNCH (read-only), ADJUST and LEARN under `role=client` with the same components. No switcher, no marker. Controls (Launch, unit picker, drawer edit, suggestion / do it / not now / undo) are absent; exhibits stay. System sentences go through `VIZ_CLIENT_SAFE`. `/share/` was already public — PUBLIC_PREFIXES is unchanged.

## Scope / files

- `lib/plan/share-role.ts` — `planShareControls` (the view the workspace calls)
- `lib/plan/share-load.ts` + `app/share/plan/[id]/page.tsx` — one-plan public route
- `components/plan/plan-workspace.tsx` — `role=client` skips persist and operator fetches
- Face surfaces: launch / target / channels / budget / window / assets / header
- `lib/plan/__tests__/share-parity.test.ts` — controls, faces, route, allow-list

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5300 pass, 4 skipped)

## Notes

No migration. Plan UUID is the credential. Merge after A → B → C.
