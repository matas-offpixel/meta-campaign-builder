# Session log

## PR

- **Number:** 982
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/982
- **Branch:** `cursor/meta-creatives-existing-post-filename`

## Summary

A boosted Instagram post was imported as a new ad, so the wizard demanded a caption and URL the post already is. Those creatives now import as an existing post, with the captured URL, CTA, and media type. A Meta wizard upload of a file onto `Ad N` names the creative from the filename.

## Scope / files

- `lib/meta/import/creative-copy.ts` — existing-post classification
- `lib/meta/import/map.ts` — `sourceType: "existing_post"`; app-built specs stay new
- `lib/creatives/asset-variation-updater.ts` — `applyNamedVariationUpdate`
- `components/steps/creatives.tsx` — slot and bulk uploads use it

## Validation

- [x] `npm test` — 6305 pass, 3 skipped
- [x] `npm run build`
- [ ] check runs (reported in the thread, not in this file)

## Notes

SCHAK `120251738050060755`: 27 creatives, 13 boosted (Instagram permalink, `effective_object_story_id` as `{page}_{post}`, no `object_story_id`, no spec), 14 app-built (`asset_feed_spec`). The 13 import as Facebook existing posts because that is the id shape Meta returned. **0 of 13 have `link_url`**; all 13 have `call_to_action_type` `SIGN_UP` and `video_id`. Relaunching an Instagram-native shadow post by sending that `{page}_{post}` id as `object_story_id` is untested. `nameMetaCreativeFromAssets` only renames `""` or `Ad N`. DHB still imports from `asset_feed_spec`. The importer writes nothing to Meta.
