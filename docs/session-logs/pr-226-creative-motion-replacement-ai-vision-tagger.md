# Session log

## PR

- **Number:** 226
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/226
- **Branch:** `creative/motion-replacement-ai-vision-tagger`

## Summary

Adds a cron-only OpenAI vision auto-tagger for the Motion creative taxonomy, behind `ENABLE_AI_AUTOTAG`, so active-creatives snapshots can seed `source='ai'` assignments without moving Meta or OpenAI work into the viewer path.

## Scope / files

- `lib/intelligence/auto-tagger.ts` and tests for the closed-taxonomy OpenAI prompt and hallucinated-value filtering.
- `lib/db/creative-tags.ts` assignment payloads extended with `model_version`.
- `app/api/cron/refresh-active-creatives/route.ts` sidecar tagging after successful snapshot writes.
- `scripts/validate-ai-tagging.ts` manual-seed validation against latest active-creatives snapshots.
- `supabase/migrations/068_creative_tag_assignment_model_version.sql` adds the model identity column and source/model index.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] `npm run lint -- lib/intelligence/auto-tagger.ts lib/intelligence/__tests__/auto-tagger.test.ts lib/db/creative-tags.ts app/api/cron/refresh-active-creatives/route.ts scripts/validate-ai-tagging.ts`

## Notes

Validation script still needs to be run post-merge after migration 068 is applied and the production manual seed rows are present for `SEED_USER_ID`.
