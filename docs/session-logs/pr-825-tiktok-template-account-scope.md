# Session log

## PR

- **Number:** 825
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/825
- **Branch:** `cursor/tiktok-template-account-scope`

## Summary

Templates keep account setup in the snapshot and restore it when loaded for the same client. Cross-client loads still strip advertiser/identity/pixel. The UI says which happened. identityBcId is always nulled on apply so #803 re-resolves it. Review summary chip now uses the same client-resolvable preflight issues that disable Launch.

## Scope / files

- `lib/tiktok-wizard/templates.ts`
- `lib/tiktok-wizard/review.ts`
- `lib/tiktok-wizard/library.ts`
- `components/tiktok-wizard/wizard-shell.tsx`
- `components/tiktok-wizard/steps/review-launch.tsx`
- `components/dashboard/tiktok-campaign-library.tsx`

## Validation

- [x] `npm run build`
- [x] `npm test` — `4158 = 4142 passed + 13 failed + 3 skipped`. Pre-existing failures still 13.

## Notes

- identityBcId: re-resolve on load (never restore from snapshot).
- Schedule start/end always nulled.
- Follow-up: snapshot `clientId`/`eventId` no longer overwrite the target draft. Foreign apply twice stays stripped. Notice has a third unscoped branch. Chip uses the same expression as `launchDisabled` (killswitch included).
- Rebased onto `2ce2af4` (#826). Chip now has a test that a lone `bid-strategy` preflight issue makes `summary.ok === false`.
