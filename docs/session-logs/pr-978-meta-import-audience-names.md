# Meta import audience names

## PR

- **Number:** 978
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/978
- **Branch:** `cursor/meta-import-audience-names`

## Summary

Imported custom audiences kept only the id, so the Audiences step showed bare ids until Load. The read's names are now stored on the group, chips use them before the account list loads, and a draft with custom audiences loads that list on open. Audiences named in this app's engagement convention are badged page-derived. A batched subtype/rule read moves an audience onto a page group only when the rule names one page id, and takes it out of Custom.

## Scope / files

- `lib/types.ts` — optional `CustomAudienceGroup.audienceNames`
- `lib/meta/import/map.ts` — copies the name off `targeting.custom_audiences[]`
- `lib/meta/import/page-audiences.ts` — name badge, batched rule read, page-group reconstruction
- `lib/meta/import/save.ts` — runs the rule read after mapping; a failure leaves audiences under Custom
- `components/steps/audiences/custom-audiences-panel.tsx` — auto-load, named chips, badge
- Fixture `lib/meta/import/__fixtures__/meta-import-audiences-120249957259050453.json`
- `lib/meta/import/__tests__/page-audiences.test.ts`

## Validation

- [x] `npm test` — 6281 pass, 3 skipped, 0 fail
- [x] `npm run build`

## Notes

DHB: 72 memberships, 68 distinct audiences, 3 batch calls. 31 rules resolved to a page id and moved. 34 are Instagram business sources (no page id) and stay under Custom, badged when the name matches. 1 pixel and 2 lookalikes stay under Custom with no badge.
