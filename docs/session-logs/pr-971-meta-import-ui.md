# The Meta importer gets an entry point

## PR

- **Number:** 971
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/971
- **Branch:** `cursor/meta-import-ui`

## Summary

#970 shipped the import route and left no screen that calls it. The Campaign Library header now has **Import from Meta**, beside New Campaign, following the TikTok import dialog: pick an ad account (auto-selected when there is one), read with no `carry`, tick creatives, pick an event, then save. A successful save shows what was not carried, then opens the new draft. The same report sits on the Meta drawer's details disclosure.

## Scope / files

- `components/meta/meta-import-button.tsx`, `meta-import-picker.tsx`, `meta-import-event-select.tsx`, `meta-import-report.tsx`, `meta-import-flow.ts`
- `components/library/campaign-library.tsx` mounts the button
- `components/plan/meta-drawer-details.tsx` shows `importMeta` once the draft exists
- `package.json` test script also runs `components/meta/**/__tests__/*.test.ts`
- `lib/db/__tests__/rewire.test.ts` still freezes `components/plan`, and now allows this one details file. The importer under `lib/meta/import/**` is unchanged.

## Validation

- [x] `npm test`: 6181 pass, 0 fail
- [x] `npm run build`
- [ ] Not clicked through in a browser

## Notes

Save does not navigate by itself. The dialog stays on the report (`notCarried` with reasons, dropped fields behind a count, ad-set and creative counts) and **Open draft** routes to `/campaign/{id}`. Routing on the save response would hide that report.

The campaign list is `GET /api/meta/campaigns`. A campaign whose objective the list marks incompatible shows that reason, including the objective, and Read stays disabled. A route error is rendered as the route's `error` string.
