# PR 1 of the import arc — a capture path, and a relaunch that carries originals only

## PR

- **Number:** 945
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/945
- **Branch:** `cursor/tiktok-import-capture`

## Summary

#944 shipped green and failed live on both paths. The manual path never ran at all
(`/adgroup/get/` rejected `fields.32` = `connection_type`, a name that is not a TikTok
field); the Upgraded Smart+ path saved draft `c8bca9ff-d22a-4a9e-82ec-e491281dd309` with
45 asset-less creatives assigned to the ad group and the same 45 creatives again,
unassigned, with real `video_id`s. Neither failure was reachable from CI, because the
only fixture was hand-written from documentation: a fixture cannot reject a field name,
and a `creative_list[]` row written by the same person who wrote the mapper cannot
disagree with it.

This PR does five things. It adds a **raw capture route** so the fixture can stop being
a guess. It takes `connection_type` out and pins the live accepted-field list as the
first captured fixture in `lib/tiktok/import/`. It **rewrites the `/smart_plus/ad/get/`
walk from the documented shape** — every creative field is nested under `creative_info`,
the ad id is `smart_plus_ad_id`, and the join key to `/ad/get/` is
`creative_list[].smart_plus_creative_id`, documented as equal to `ad_id`. It separates
**absent from false** in the enhancement counters. And it implements the decided meaning
of *relaunch*: the import carries **only creatives whose `video_id` is in the
advertiser's Creative Library**, deduped by `video_id`, all assigned; everything else is
reported in `importMeta.notCarried[]` with a name, an `ad_id` and a reason.

The audit report that specified this work (`tiktok-import-audit-report-2026-09-15.md`)
commits with it, amended in the two places review corrected: the join key is documented
(§4) and indices 33–35 are already adjudicated (§1.2).

## Scope / files

- `lib/tiktok/import/readers.ts` — `connection_type` removed; `TikTokSmartPlusAdRow` /
  `TikTokSmartPlusCreativeRow` / `TikTokSmartPlusCreativeInfo` retyped from the
  documented nesting, with the doc URL on the type; `fetchTikTokCreativeLibraryVideoIds`
  (paged, capped, throws on a truncated read); `readTikTokLiveCampaign` returns
  `{ads, smartPlusAds, libraryVideoIds}` and no longer pre-splits chosen/added; zero
  creatives across **both** upgraded reads is the failure condition, not zero on one.
- `lib/tiktok/import/map.ts` — rewritten upgraded walk; one normalised `SourceCreative`
  per source ad regardless of which read produced it; `joinUpgradedSources`
  (`smart_plus_creative_id` → `video_id` → `tiktok_item_id`); `carryCreatives`
  implementing the Creative Library rule, dedupe, Spark, carousel exclusion; ad-level
  `ad_text_list` / `call_to_action_list` / `landing_page_url_list` carried at `[0]` with
  the remainder in `dropped[]`; `applyTargeting` throws on unmappable `age_groups` and
  on empty `location_ids`; `resolveAccountIdentity` no longer borrows an identity;
  `displayName` is left blank rather than invented.
- `lib/tiktok/import/record.ts` (new) — `recordingTikTokGet`, a `tiktokGet` wrapper that
  records path, params, verbatim `data`, and the error envelope on rejection.
- `app/api/tiktok/campaigns/import/raw/route.ts` (new) — `GET`, session + operator
  allowlist (`isOperator`), runs the same reads with the recorder injected, returns the
  calls in order, returns what was captured before a throw. No mapping, no save.
- `lib/tiktok/import/types.ts` — `notCarried[]` and its reasons; carry counts
  (`sourceRows / carried / deduped / notCarried / unjoined`); on/off/**absent** counters;
  `/file/video/ad/search/` added to `TIKTOK_IMPORT_PATHS` with the reason in a comment.
- `lib/tiktok/import/__fixtures__/captured/adgroup-get-accepted-fields-2026-09-15.ts`
  (new) — the accepted-field list, headed as a capture from an error body, and honest
  that it is partial.
- `lib/tiktok/import/__fixtures__/doc-derived-v1.3.ts` — rewritten to the documented
  nesting; header now separates VERIFIED LIVE / FALSIFIED LIVE / UNKNOWN UNTIL CAPTURE.
- `lib/types/tiktok-draft.ts`, `lib/tiktok-wizard/migrate-draft.ts` — the new
  `importMeta` shape, plus normalisation for drafts saved before it.
- `components/tiktok-wizard/steps/account-setup.tsx` — Step 1 renders carried /
  not-carried, the not-carried names, and an unjoined warning when one applies.

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched paths (repo has pre-existing
      jest-typing noise in `app/**/__tests__`).
- [x] `npm run build`
- [x] `npm test` — 5830 pass, 0 fail (45 in the import suite, up from 19).
- [x] `npx eslint` on touched paths — 0 errors.

## Notes

### One deliberate deviation from the test plan

The plan said a `/ad/get/` row with no `video_id`, `image_ids` or `tiktok_item_id`
should **throw**. It does not; it is reported as
`notCarried[{reason: "no_asset_reported"}]` with its name and `ad_id`. Throwing would
make the Ironworks Smart+ campaign permanently unimportable, because three of its 45
rows are `auto carousel generation_*` with no video — real rows that legitimately
cannot be carried. The regression the throw was there to catch (a wrong nesting key
making *every* row look asset-less) is caught instead by a hard throw when **zero**
creatives can be carried, which is strictly louder for that case: #944's draft would
have been one error rather than a saved draft of 45 hollow creatives. A
`creative_list[]` row with no `creative_info` at all still throws through
`logUnmatchedCandidates`, as does a missing `creative_list` or `targeting_spec`.

### Field names this PR did and did not add

`connection_type` came out. Nothing went in: `display_name` and `ad_format` are both
real `/ad/get/` fields that would improve the draft, and both are deliberately **not
requested**, because one unvalidated name in `fields` rejects the whole request and
that is the bug this PR exists to fix. Consequences, accepted for now: every carried
creative has a blank `displayName` (named in `dropped[]`, so Step 1 says so and the
operator fills it in), and a carousel is only recognised when its `ad_format` reaches
us through `creative_list[].creative_info` — a carousel that appears only in `/ad/get/`
is reported as `no_asset_reported` instead. Both are one-line changes once the capture
pins the accepted lists for `/ad/get/`.

### The partial accepted list

The live error body listed 152 names. The operator note transcribed 19 of them (two
verbatim from the untruncated prefix, the rest read off the body). The fixture says so
in its header, and the test requires every name `ADGROUP_GET_FIELDS` sends to be in
either the accepted list or an explicit `PENDING_CAPTURE` list — so a new field name
cannot be added without a decision, and a stale pending entry fails too. The capture
round replaces the partial list with the verbatim body.

### Unverified until capture

- The `creative_list[]` shape itself. It is documented
  (<https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3>) and has
  not been seen on the wire. If the capture disagrees, the mapper follows the capture.
- `page_size: 1000` on `/campaign/spc/get/`.
- Whether `excluded_audience_ids` arrives under `targeting_spec` on an upgraded ad
  group that has one.

### Guards

Six paths became seven: `/file/video/ad/search/` is read on every import because
library membership is now the carry rule. It is the same endpoint (and the same
wrapper) the wizard's video picker already uses, and it is a GET. No POST to TikTok.
`lib/tiktok/write/**` untouched — PR 3 stays cancelled; the audit ran the bad draft
through the real `collectTikTokLaunchPreflight` and it blocks. `evaluate.ts`,
`apply.ts`, `gates.ts`, `components/plan/**` untouched. No migration.

### Not this PR

Draft `c8bca9ff-d22a-4a9e-82ec-e491281dd309` stays in the library. `migrateTikTokDraft`
now reads its enhancement counters as *"is_aco not reported on 45 of 45"* instead of
*"true on 0 of 45"*, and drops its `{chosen: 45, tiktokAdded: 45}` line rather than
restating a number that counted the same creatives twice. The 90 creatives on it are
unchanged; Matas decides.
