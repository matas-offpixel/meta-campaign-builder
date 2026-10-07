# Meta import: one row per unique creative

## PR

- **Number:** 1030
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1030
- **Branch:** `cursor/import-unique-creatives`

## Summary

Import from Meta made one draft creative per AdCreative object. A campaign duplicated in Ads Manager has one object per ad, so campaign 120250869474230239 on act_1073273492854557 listed 77 rows for 5 creatives. The import now groups objects by a content key. Each group becomes one draft creative named after its ad (`nameSource: "file"`). It keeps every object id, ad id and ad set id on `importedMeta`, and is assigned to every ad set it ran in. The launch path, `buildCreativePayload` and bulk-attach are untouched.

## Why 75 were unticked (read 7 Oct 2026, read-only)

The picker did not untick anything. The operator unticked 75 rows by hand.

- I replayed the importer's own read (`readMetaLiveCampaign`: 4 GETs plus 4 batch POSTs of GETs) on the campaign. It returned 16 ad sets, 77 ads and 77 distinct creative ids, and all 77 were hydrated.
- `buildMetaImportPicker` on that read gave 77 rows, all enabled and all `defaultTicked`. `metaImportSelectAll` ticks every enabled row on read, and has done since #977.
- The saved draft `edd632be-eda2-482c-b962-aaee66e502e2` (saved 7 Oct 12:12 UTC) records `creativeCounts {read 77, carried 2, notCarried 75}`. All 75 `notCarried` rows have the reason `operator_unticked`. The two kept were one "GDS Video (With Text)" object and one "ES - Static" object, both still under Meta's auto-names.
- A direct `GET /{creative}` with `id,name,object_story_spec,asset_feed_spec,effective_object_story_id,image_hash,video_id,thumbnail_url`, one per ad name, showed this shape:
  - Every object is `asset_feed_spec` with `object_story_spec {page_id, instagram_user_id}`.
  - Each has an `effective_object_story_id` and a `thumbnail_url`.
  - No object has a top-level `image_hash` or `video_id`.
- All 77 object names match the auto-name regex.

So assets did resolve, and resolving once per key was not the fix. The real duplication was this:

- **Videos:** every `asset_feed_spec.videos[]` entry has its own `video_id`. There are 77 distinct ids across 46 video objects, so no object shares one. Ads Manager made a new copy of the video for each duplicated ad. The poster file (the last path segment of `thumbnail_url`) is identical within each creative.
- **Images:** within an ad name, the static objects differ only in `effective_object_story_id`. ES - Static and GDS - Static carry the same two image hashes but differ in copy and Instagram account.

A key on `video_id`, as the brief specified, gives 48 groups here. The content key therefore identifies a video by its poster (`thumbnail_hash`, then the `thumbnail_url` file), and falls back to `video_id` only when there is no poster.

## Before / after on this campaign

| | Before | After |
|---|---|---|
| Picker rows | 77 (77 ticked by default) | 5 (5 ticked) |
| Header | `16 ad sets` · `77 of 77 ticked` | `5 creatives (77 ads) · 5 ticked` |
| Draft creatives on Select all | 77, auto-named | 5: ES - Static (16 ads), ES - Video (16), GDS - Static – Copy (15), GDS - Video – Copy (15), GDS Video (With Text) (15) |
| `creativeCounts` | `{read 77, carried, notCarried}` | `{read 77, uniqueCreatives 5, adsRead 77, carried 5, notCarried 0}` |

The same numbers come from the live read saved locally and from the fixture `lib/meta/import/__fixtures__/gds-duplicated-77.ts`.

Other captures:

- **DHB** (120249957259050453): 25 objects become 11 creatives, of which 6 are carriable. The 5 boosted posts with no asset stay disabled, as before.
- **Capture 52522388611107:** 301 objects become 40 creatives.

Every ad name inside a group was a `<creative> — <ad set>` variant of the same name. The one exception is a single "JJ - Static 1 … Copy 2" ad that runs the Lineup Artwork image; it groups with Lineup Artwork because content wins over name. The two DHB "Motion - Ahmed" uploads have different poster files, so they stay as two rows.

## Rule

- **Content key** (`lib/meta/import/content-key.ts`, re-exported from `lib/learning/ad-facts.ts` as `creativeContentKey`): one implementation.
  - **Existing post:** `post:` + `source_instagram_media_id`, else `object_story_id`, else `effective_object_story_id`.
  - **Otherwise:**
    - The sorted media set: image hashes (link_data, child_attachments, asset_feed_spec), and videos by poster or id.
    - Bodies, titles, descriptions, links and CTAs.
    - `page_id` and `instagram_user_id`. This is wider than the brief: two identical creatives posted from different accounts launch as different ads.
- **Name:** the most common ad name in the group, with ties going to the earliest `created_time`. When no ad carries a name, the object's own name is used, but never a Meta auto-name (`/^(.+?)\s\d{4}-\d{2}-\d{2}-[0-9a-f]{32}$/`). The stripped prefix comes after that, then the id.
- **Representative object:** the first carriable object by ad `created_time`. The draft row is built from it, and its id is the carry key. Any member id in `carry` carries the whole group, so a stale client still saves.
- **Counts:** `notCarried` is per unique creative. The Review line reads `N ad sets · carried of uniqueCreatives creatives carried (adsRead ads) · notCarried not carried`. Older drafts fall back to `read`.
- `migrateDraft` now passes `importedMeta` through. Before this change, `migrateCreative` rebuilt every field explicitly and would have dropped it.

## Scope / files

- `lib/meta/import/content-key.ts` (new): `creativeContentKey`, `META_AUTO_CREATIVE_NAME`, `isMetaAutoCreativeName`, `stripMetaAutoCreativeName`.
- `lib/meta/import/groups.ts` (new): `groupMetaImportCreatives`, `metaImportCreativeCarriable`.
- `lib/meta/import/map.ts`, `picker.ts`, `types.ts`, `creative-copy.ts` (exports `hasAppBuiltSpec`).
- `lib/types.ts`: `AdCreativeDraft.importedMeta`.
- `lib/autosave.ts`: passes `importedMeta` through.
- `lib/learning/ad-facts.ts`: re-exports `creativeContentKey`.
- `components/meta/meta-import-flow.ts`: `metaImportPickerHeaderLine` and `metaImportRowAdSetsLine` are new, `metaImportCountsLine` changed, and `metaImportTickedLine` is removed.
- `components/meta/meta-import-picker.tsx`: the header line, and an "in N ad sets" row note with the list on hover and on click.
- Boundaries: `lib/meta/**`, `components/meta/**`, `lib/autosave.ts` and `lib/types.ts` are wizard-owned or shared. The brief scoped the import files explicitly. The `lib/autosave.ts` and `lib/types.ts` changes are one optional field and its passthrough.

## Tests

- `lib/meta/import/__tests__/unique-creatives.test.ts` (new, 20 tests):
  - GDS 77: one object per ad, all auto-named.
  - The picker lists 5 rows, all ticked, with the header "5 creatives (77 ads) · 5 ticked".
  - The mapper gives 5 draft creatives named after the ad, keeping every object, ad and ad set.
  - Each creative is assigned to every ad set it ran in.
  - Unticked counts are per unique creative, and any member id carries its creative.
  - Before grouping, a `video_id` key would have split the 46 video objects one per ad.
  - `creativeContentKey`:
    - it is the import's own function, re-exported;
    - same media and copy give one key, whatever the image order;
    - different copy, media, CTA or Instagram account give a different key;
    - a video is keyed by its poster file;
    - a video with no poster falls back to its id;
    - an existing post is keyed by its story id;
    - it returns null when the read has neither media nor a post.
  - Auto-names:
    - the pattern matches;
    - it does not match an operator name, a short hash or uppercase hex.
  - Naming:
    - an object's own name is kept only when no ad name exists;
    - an auto-name with no ad name falls back to the stripped prefix;
    - the most common ad name wins, and a tie goes to the first created.
  - Existing posts group by story id, and each group keeps its ad sets.
  - `migrateDraft` keeps `importedMeta` and `nameSource: "file"`.
- Updated:
  - `dhb-round-2.test.ts`: 20 carriable objects are 6 unique creatives, and the header line is "11 creatives (105 ads)".
  - `existing-post.test.ts`: thirteen boosts of one post are carried as one creative.
  - `meta-import-ui.test.ts`: the counts line uses unique creatives.

## Validation

- [x] `npm test`: 6,781 node tests and 6 vitest pass.
- [x] `npm run build`
- [x] `npx tsc --noEmit`: no new errors in touched files. Four errors already on main remain, in `country-group-labels.test.ts` and `existing-post.test.ts` l.48.
- [x] `eslint` on touched files

## Notes

- A poster file is shared by copies of one video. Two different videos given the same custom poster would merge. The copy and the account are still part of the key, so the creatives would also need identical copy.
- No Meta writes. The diagnosis used GETs and Graph batch POSTs of GETs only. Nothing in Meta was renamed.
- PR B (insights by content) can call `creativeContentKey(spec)` on a creative read. `launched_ads` and the recorder are unchanged.
