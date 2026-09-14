# Session log

## PR

- **Number:** 944
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/944
- **Branch:** `cursor/tiktok-import-relaunch`

## Summary

Import a live TikTok campaign into the creator so the operator can relaunch it without Smart+ enhancements. TikTok cannot convert Smart+ → manual (copy task refuses Smart+; Smart+ copy has no output-type). Our writer already sends `is_aco: false` / `creative_authorized: false` and never calls `/smart_plus/*`. This PR is the read: list campaigns, map onto `TikTokCampaignDraft` with an honest `dropped[]` list, run through `duplicateTikTokDraftState`, open the wizard. Import writes nothing to TikTok. The source campaign is untouched. Launch is the existing gated button.

This PR is TikTok only. Meta gets the same importer shape next (read → map with `dropped[]` → existing duplicate → wizard). Not started here.

Round 2: a wrong envelope key throws through `logUnmatchedCandidates` instead of producing an empty draft. `excluded_audience_ids` and other uncarriable targeting are requested and listed in `dropped[]`. `saved_audience_id` is never written to `lookalikeAudienceIds`. Legacy Smart+ uses the fully-automated sentence, not "OFF (0 of 0)". Timezone and currency come from `/advertiser/info/` via the existing wrapper. TikTok-added creatives import unassigned.

## Scope / files

- `lib/tiktok/import/{types,readers,map,account,envelope}.ts` — classify the three generations, six GET readers, throw-on-miss envelope walks, map + finalize
- `lib/tiktok/import/__fixtures__/doc-derived-v1.3.ts` — doc-derived v1.3 envelopes; **not a live capture**; not yet verified against a live advertiser
- `lib/tiktok/import/__tests__/import.test.ts` — classify, map (manual / upgraded / legacy), envelope throws, targeting honesty, readers, path allowlist, write/** freeze
- `app/api/tiktok/campaigns/route.ts` — stub becomes a real `/campaign/get/` list
- `app/api/tiktok/campaigns/import/route.ts` — POST import; hydrates currency/timezone via `fetchTikTokAdvertiserInfo`
- `components/tiktok/tiktok-import-{button,picker}.tsx` + library header next to New
- `components/tiktok-wizard/steps/{account-setup,review-launch}.tsx` — dropped list + enhancement line
- `lib/types/tiktok-draft.ts` + `migrateTikTokDraft` — `importMeta` on state JSON, no migration

Did not touch: `lib/tiktok/write/**` (import only reads mapping tables), `evaluate.ts` / `apply.ts` / `gates.ts`, `components/plan/**`, `OFFPIXEL_TIKTOK_WRITES_ENABLED`, frames.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5772 pass, 4 skipped
- [ ] `frames:check` — no frame file touched, no baselines regenerated

## Notes

**Six paths only.** `/campaign/get/`, `/adgroup/get/`, `/ad/get/`, `/smart_plus/adgroup/get/`, `/smart_plus/ad/get/`, `/campaign/spc/get/`. `/smart_plus/ad/get/` `page_size` max 100. Never `ad_ids_v2`. Upgraded campaigns also call `/ad/get/` with `campaign_automation_type: UPGRADED_SMART_PLUS` so the operator sees chosen vs TikTok-added creatives. `/advertiser/info/` is called from the import route via `fetchTikTokAdvertiserInfo` — not as a path string under `lib/tiktok/import/`.

**Fixtures are doc-derived; not yet verified against a live advertiser.** After merge, drive the deployed picker with the operator session and replace this file with a verbatim capture.

**Unverified until capture.** `page_size: 1000` on `/campaign/spc/get/`; `filtering.campaign_automation_type` on `/ad/get/`; `/ad/get/` `ad_id` === `/smart_plus/ad/get/` `creative_id`.

**Name.** Mapped draft goes through `duplicateTikTokDraftState` (clears `publishedIds`, heals schedule), then the name is set to `source — relaunch`.

**Meta parity.** Named in the PR body. Not built.
