# Meta import round 2

## PR

- **Number:** 977
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/977
- **Branch:** `cursor/meta-import-round-2`

## Summary

Importing `[DHB26-DUBAI] Deep House Bible Dubai — Announce` never saved a draft. The mapper set `draft.id = "import:<campaignId>"`, `campaign_drafts.id` is a uuid, and `saveDraftToDb` (a browser Supabase client, running on the server) only warned. The route still answered `saved: true`, and "Open draft" loaded a blank default draft. That blank draft is what showed "Select ad account…", an empty pixel list and "Select at least one audience source". The import now saves under a fresh uuid with the route's session client, and a failed write is a 500 with the reason.

Also in this PR: imported ad sets that resolve to a place and an age range satisfy the audiences step; carry keys that match no creative are refused and named; a Meta ad is named after its creative on every launch path; and the import picker has Select all and Deselect all.

## Scope / files

- `lib/meta/import/map.ts`: uuid `draftId`; `classifyMetaImportCarry` and `formatRejectedMetaCarryKeys`; a carry key the read never saw goes to `notCarried` as `carry_key_rejected`, with the key.
- `lib/meta/import/save.ts`: refuses rejected keys before mapping; `insertImportedDraft` writes with the route's client and throws on error; logs received, accepted and rejected carry.
- `lib/wizard/import-edits.ts`, `lib/validation.ts`: `importedAdSetsDefineAudience`.
- `lib/creative-name-from-filename.ts`: `metaAdName`.
- `app/api/meta/launch-campaign/route.ts` (both ad loops), `create-creatives-and-ads/route.ts`, `bulk-attach-ads/route.ts`: ad name is `metaAdName(creative.name)`.
- `components/meta/meta-import-flow.ts`, `meta-import-picker.tsx`: Select all, Deselect all, "N of M ticked".
- Fixtures: `lib/meta/import/__fixtures__/captured/meta-import-capture-120249957259050453.json` (DHB, via `scripts/capture-meta-import-raw.mjs`), `lib/meta/import/__fixtures__/meta-ad-account-968594768066330.json` (the `/me/adaccounts` row).
- Tests: `lib/meta/import/__tests__/dhb-round-2.test.ts`, `lib/meta/__tests__/ad-name-is-creative-name.test.ts`, `app/api/meta/bulk-attach-ads/__tests__/route.test.ts`.

## Validation

- [x] `npx tsc --noEmit`: no errors in changed files
- [x] `npm run build`
- [x] `npm test`: 6274 pass, 3 skipped, 0 fail

## Notes

- The DHB campaign is not broad. Of its 21 ad sets, 12 target custom audiences, 6 target interests, 3 are geo and age only, and 2 use `country_groups: ["europe"]`. A saved import already passes the audiences step on its six interest groups. The broad-import rule is tested on the three captured geo-and-age ad sets.
- `country_groups` is not carried by the mapper. The two EU ad sets import with no location and `validateStep` names them. Follow-up.
- The 17 `operator_unticked` did not reproduce. Replaying the live campaign twice through the picker and the mapper carries 20 of 20, with identical keys across reads. The mapper also never checked carry keys against the read, so an unmatched key vanished and its creative was reported unticked. Unmatched keys now refuse the save by name, and the route logs the carry it received.
- The `{text} {YYYY-MM-DD}-{32 hex}` names are on Meta creative objects Meta created: 25 creatives behind 105 ads that all reference our creative by `creative_id`. No code here composes that shape. The per-ad-set suffix on the ad name (`— attached:…`, `— Wide`) was ours.
- Graph `paging.next` URLs in the captured fixtures carried `access_token` (16 in the Ironworks capture on `main`, 4 in the first push of the DHB capture). Both are redacted, the capture script redacts, and `import.test.ts` fails on an unredacted token. `META_ACCESS_TOKEN` should be rotated.
