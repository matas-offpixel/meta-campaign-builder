# Session log

## PR

- **Number:** 804
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/804
- **Branch:** `cursor/tiktok-campaign-name-collision`

## Summary

Two mid-flight launch failures left `[IRW0001] Jamie Jones -sig` taken on advertiser 7639802149165301776. Preflight now lists existing campaign names via `/campaign/get/` and blocks before any write. 40002 "Campaign name already exists" maps to a Step 2 rename (suggested suffix keeps `[EVENT_CODE]`). Campaign cleanup logs `outcome=deleted` or `outcome=failed` with the campaign id.

## Scope / files

- `lib/tiktok/write/campaign-names.ts` — fetch, suggest, collision message
- Preflight + launch + error-classify + cleanup logging

## Validation

- [x] `npm run build`
- [x] `npm test` — 3980 = 3964 passed + 13 failed + 3 skipped (13 pre-existing)
- [x] eslint on changed files clean

## Notes

Rollback: `cleanupTikTokCampaign` does call `/campaign/delete/` (tests confirm the path). Errors were previously only `console.warn` and easy to miss. Two live failures left the name taken after rollback, which is consistent with either a silent delete failure or TikTok reserving names after delete. If the next failed launch logs `outcome=deleted` and the name is still taken, retry means rename — not a second launch of the same name.

Did not change OFFPIXEL_TIKTOK_WRITES_ENABLED, paused create, identity/budget preflight, or Meta.
