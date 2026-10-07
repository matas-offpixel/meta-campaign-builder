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

A key on `video_id`, as the brief specified, gives 48 groups here. Round 1 keyed a video by its poster file instead. Round 2 replaced that (see below): a poster file is not a video identity.

## Before / after on this campaign

| | Before | After |
|---|---|---|
| Picker rows | 77 (77 ticked by default) | 5 (5 ticked) |
| Header | `16 ad sets` · `77 of 77 ticked` | `5 creatives (77 ads) · 5 ticked` |
| Draft creatives on Select all | 77, auto-named | 5: ES - Static (16 ads), ES - Video (16), GDS - Static – Copy (15), GDS - Video – Copy (15), GDS Video (With Text) (15) |
| `creativeCounts` | `{read 77, carried, notCarried}` | `{read 77, uniqueCreatives 5, adsRead 77, carried 5, notCarried 0}` |

The same numbers come from the live read saved locally and from the fixture `lib/meta/import/__fixtures__/gds-duplicated-77.ts`.

Other captures:

- **DHB** (120249957259050453): 25 objects become 9 creatives, of which 4 are carriable. The 5 boosted posts with no asset stay disabled, as before. Round 1 gave 11 here; round 2 explains the change.
- **Capture 52522388611107:** 301 objects become 40 creatives. This is unchanged by round 2, because every video there carries a poster hash.

One "JJ - Static 1 … Copy 2" ad runs the Lineup Artwork image. It groups with Lineup Artwork, because content wins over name.

## Rule

- **Content key** (`lib/meta/import/content-key.ts`, re-exported from `lib/learning/ad-facts.ts` as `creativeContentKey`): one implementation.
  - **Existing post:** `post:` + `source_instagram_media_id`, else `object_story_id`, else `effective_object_story_id`.
  - **Otherwise:**
    - The sorted media set: image hashes (link_data, child_attachments, asset_feed_spec), plus videos. A video with a poster hash is keyed by that hash. A video without one is keyed by the ad name stem, or by poster file plus slot when its ads carry no name, or by id.
    - Bodies, titles, descriptions, links and CTAs.
    - `page_id` and `instagram_user_id`. This is wider than the brief: two identical creatives posted from different accounts launch as different ads.
- **Name:** the most common ad name in the group, after our ` — <ad set>` / ` — attached:<id>` suffix is stripped, with ties going to the earliest `created_time`. When no ad carries a name, the object's own name is used, but never a Meta auto-name (`/^(.+?)\s\d{4}-\d{2}-\d{2}-[0-9a-f]{32}$/`). The stripped prefix comes after that, then the id.
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
    - a video is keyed by its poster file when no stem is given;
    - a video with no poster falls back to its id;
    - the same poster file in a different slot is a different video;
    - with a stem, different posters under one stem, copy and account are one creative;
    - with a stem, the same poster under a different stem or copy stays apart;
    - a poster hash wins over the stem;
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
  - `dhb-round-2.test.ts`: 20 carriable objects are 4 unique creatives, and the header line is "9 creatives (105 ads) · 4 ticked".
- `unique-creatives.test.ts`, round 2: the ad name suffix tests (strip ours and collapse spaces; keep a trailing ` – Copy` and any ` — ` that is not an ad set; the stem drops ` – Copy N`).
- `capture-unique-creatives.test.ts` (new):
  - DHB: 9 rows (2 static, 2 motion, 5 boosted posts), and names carry no ad set suffix.
  - DHB: the original Motion - Ahmed and its Ads Manager copies are one row despite different posters.
  - DHB: a poster shared across Ahmed-body and Artwork-body creatives never merges them.
  - DHB: rows with the same name get a story-id disambiguator.
  - Jamie Jones: 301 objects are 40 rows, and no name keeps our ad set suffix.
  - Jamie Jones: eighteen JJ - Feed Video posts can be told apart by story id.
  - `existing-post.test.ts`: thirteen boosts of one post are carried as one creative.
  - `meta-import-ui.test.ts`: the counts line uses unique creatives.

## Validation

- [x] `npm test`: 6,781 node tests and 6 vitest pass.
- [x] `npm run build`
- [x] `npx tsc --noEmit`: no new errors in touched files. Four errors already on main remain, in `country-group-labels.test.ts` and `existing-post.test.ts` l.48.
- [x] `eslint` on touched files

## Notes

- The residual risk is documented on `creativeContentKey`. A video without a poster hash merges by stem, so two different videos under the same ad name, copy and account become one creative. Without a stem it falls back to poster plus slot, where a reused poster in the same slot would merge two videos.
- No Meta writes. The diagnosis used GETs and Graph batch POSTs of GETs only. Nothing in Meta was renamed.
- PR B (insights by content) can call `creativeContentKey(spec)` on a creative read. `launched_ads` and the recorder are unchanged.

## Round 2 (review against the DHB and Jamie Jones captures)

1. **Ad set suffix in names.** Draft creatives were named "Static - Ahmed  — Wide", "Motion - Ahmed  — attached:120249957296630453" and "JJ - Motion 4 — Jamie Jones Adv+". With `nameSource: "file"`, #1009 never repaired them, and a relaunch would have appended a second suffix.
   - `adNameWithoutAdSetSuffix` now strips a trailing ` — <text>` before the majority vote, when `<text>` is an ad set name in the bundle or matches `attached:<digits>`. It also collapses double spaces.
   - An Ads Manager ` – Copy` that follows the suffix is kept: "Adam Ten - Static 1  — Adam ten Adv+ – Copy" becomes "Adam Ten - Static 1 – Copy".
2. **A poster is not a video identity.** In DHB, poster `813650309_…_n.jpg` is the feed video of the Ahmed-body copies and the story video of the Artwork-body copies: 8 `video_id`s, two videos. The original "Motion - Ahmed" (posters 813059653 / 813773856) and its copies (813650309 / 813692178) share an ad name and body but no poster. Round 1 gave 4 motion rows where there are 2.
   - A video is keyed by its poster hash when Meta returns one. That is `asset_feed_spec.videos[].thumbnail_hash` or `object_story_spec.video_data.image_hash`. On 52522388611107 it is the second: every video there is `video_data` with an `image_hash`. DHB has no hash on any of its 20 video entries.
   - Otherwise the video is keyed by the **ad name stem**: the suffix-stripped name without ` – Copy N` (`adNameStem`), plus copy and account. The original and its copies merge, and Ahmed and Artwork stay apart because their stems and bodies differ.
   - With no named ads, the key is poster file plus slot (feed / story), then `video_id`.
   - On the GDS fixture, "GDS - Video" and "GDS - Video – Copy" share the stem "GDS - Video", so it is still 5.
3. **Same-name rows.** A picker row whose name repeats gets a `nameHint`: `post …<last 6 of the story id>` for a boosted post, otherwise `…<last 6 of the creative id>`. That covers the 5 DHB "Feed - Motion" rows and the 18 "JJ - Feed Video" rows on 52522388611107.

DHB rows before and after round 2:

| Round 1 (11 rows) | Round 2 (9 rows) |
|---|---|
| Static - Ahmed  — Wide (5 objects) | Static - Ahmed (5 objects, 21 ad sets) |
| Motion - Ahmed  — attached:…96630453 (4) | Motion - Ahmed (5: the original plus 4 copies) |
| Motion - Artwork — attached:…96630453 (4) | Motion - Artwork (5: the original plus 4 copies) |
| Motion - Ahmed  — attached:…92970453 (1, the original) | |
| Motion - Artwork — attached:…92970453 (1, the original) | |
| Static - Artwork — Wide (5) | Static - Artwork (5, 21 ad sets) |
| Feed - Motion — Wide ×2, — All customs 2 ×2, — DHB Primary (5 boosted posts, disabled) | Feed - Motion ×5, each with `post …<6 digits>` (disabled) |

That is 2 motion and 2 static rows that can be carried, plus the 5 boosted posts. Those posts have no permalink or Instagram account in the read, so they stay `no_asset_reported`, as they have since #977.
