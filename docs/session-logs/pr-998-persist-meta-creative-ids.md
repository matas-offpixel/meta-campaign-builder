# Session log

## PR

- **Number:** 998
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/998
- **Branch:** `cursor/persist-meta-creative-ids`

## Summary

Launch built `updatedCreatives`, stamped `metaCreativeId` as Phase 3 created each creative, then persisted `publishedDraft` from the original `draft`. Those stamps were discarded, so a published draft's `draft_json.creatives[]` had no Meta creative ids and no ad ids. The published draft now stores `creatives` from `stampPublishedCreatives`: Phase 3 ids, Phase 4 ad ids, then multi-campaign ad ids recorded against the creative name.

## Scope / files

- `lib/types.ts` — optional `AdCreativeDraft.metaAdIds` (lives in `draft_json`; no migration)
- `lib/meta/persist-launch-creatives.ts` — `stampPublishedCreatives`
- `app/api/meta/launch-campaign/route.ts` — persist the stamped creatives; record each successful `MC[ci]` ad id by creative name
- `lib/meta/__tests__/persist-launch-creatives.test.ts`
- Nothing sent to Meta changes. `buildAdPayload`, `createMetaCreative`, `createMetaAd`, and the Graph calls are untouched. #969's write-set guard is unchanged.

## Validation

- [x] `npm test` — 6439 tests, 6435 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled in 18.5s, TypeScript in 32.7s. The only warning is the known `render-reel` `export const config`.
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

`cleanSuggestions` still strips `metaAdSetId`. The persist comment says that strip keeps the draft clean so re-launches start fresh without stale IDs. That reason applies to ad set suggestions: they are recreated each launch. It does not apply to creatives. The published creative row is how relaunch, attach, and reconcile find the Meta objects that already exist, so `metaCreativeId` and `metaAdIds` stay on the creative. A creative that failed Phase 3 is not in `creativesCreated` and is stored with neither id.
