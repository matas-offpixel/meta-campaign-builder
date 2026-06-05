# Session log — instagram_user_id field rename

## PR

- **Number:** 570
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/570
- **Branch:** `cursor/instagram-user-id-field-rename`

## Summary

Renames `instagram_actor_id` → `instagram_user_id` in all three new-ad creative
builders (`buildLinkCreative`, `buildVideoCreative`, `buildMultiPlacementCreative`
in `lib/meta/creative.ts`). This is the true root cause of the 6-PR #100/#1772103
arc: the id value and resolution were always correct; Meta v21+ rejects the legacy
field name even when the id is valid. Proven via `validate_only` API probes on
both v21.0 and v23.0 (PR #569 audit).

Also removes all `TODO(2026-06-12)` temporary observability logs from PRs #565
and #566, and fixes the PRE-POST SUMMARY log which incorrectly reported
`instagram_actor_id OMITTED` for new_ad creatives even when the field was present.

## Scope / files

- `lib/meta/creative.ts` — `MetaObjectStorySpec` type + all 3 new-ad builders +
  `MetaCreativePayload` type doc + removed 2 WIRE_CREATIVE_PAYLOAD TODO logs
- `lib/meta/ig-actor-validator.ts` — removed 2 TODO observability logs
- `app/api/meta/launch-campaign/route.ts` — removed IG_VALIDATOR_RESULT TODO log,
  fixed PRE-POST SUMMARY `new_ad` identity line
- `lib/meta/client.ts` — removed META_WIRE_PAYLOAD /ads TODO log; added focused
  `[adcreatives POST]` verification log (TODO 2026-06-12, remove after Aberdeen)
- `lib/meta/__tests__/creative-ig-identity-regression.test.ts` — updated all
  assertions to `instagram_user_id`; added Case D field-name guard test

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files
- [x] 23 tests pass across 3 test files (creative regression, validator, prefix regression)
- [ ] Vercel green
- [ ] Aberdeen relaunch: `[adcreatives POST]` log shows `instagram_user_id_in_spec` set,
      all 3 ad sets attach, no #100, no 1772103

## Notes

- The existing-post path (`buildExistingPostCreative`) was already correct — it uses
  `instagram_user_id` at the top level (not inside `object_story_spec`). Untouched.
- PR #568's page-level validator (BM-asset → page-level fallback) is intact and still
  necessary — it ensures we only send a validated id, preserving b57a98e protection for
  genuinely unauthorised accounts.
- After Aberdeen verification, open one final cleanup PR to remove the
  `[adcreatives POST]` TODO log added in this PR.
