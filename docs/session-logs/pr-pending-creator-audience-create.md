# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator-audience-create`

## Summary

The Audiences tab can create a website-pixel audience or a customer list without leaving the draft. Both use the existing writers. The Meta id is added to the current custom-audience group with a populating mark. Pixel events now cover the full funnel. No migration: `meta_custom_audiences` already stores a website-pixel insert.

## Scope / files

- `lib/audiences/bulk-website-types.ts` — six pixel events
- `lib/meta/audience-payload.ts` — event leaf on URL rules too
- `components/steps/audiences/new-audience-control.tsx` — the control
- `app/api/audiences/bulk-website/create/route.ts` — optional single-cell name
- `app/api/audiences/writes-enabled/route.ts` — the same write flag
- `lib/customer-audience/paste.ts` — paste rows into the existing hasher

## Validation

- [x] `npm test` — 6330 tests, 6326 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

Live Meta creates were not run. This environment has no `META_ACCESS_TOKEN` and `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED` is unset, so there is no returned rule to paste. The rule in the PR body is the JSON `buildMetaCustomAudiencePayload` sends.

A new custom-audience id is a normal `custom_group` target. Launch puts it on `targeting.custom_audiences` and `createAdSetWithSalvage` keeps operation_status 441. No new ad-set write in this PR.
