# Session log

## PR

- **Number:** 944
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/944
- **Branch:** `cursor/tiktok-import-relaunch`

## Summary

Import a live TikTok campaign into the creator so the operator can relaunch it without Smart+ enhancements. TikTok cannot convert Smart+ → manual (copy task refuses Smart+; Smart+ copy has no output-type). Our writer already sends `is_aco: false` / `creative_authorized: false` and never calls `/smart_plus/*`. This PR is the read: list campaigns, map onto `TikTokCampaignDraft` with an honest `dropped[]` list, run through `duplicateTikTokDraftState`, open the wizard. Import writes nothing to TikTok. The source campaign is untouched. Launch is the existing gated button.

This PR is TikTok only. Meta gets the same importer shape next (read → map with `dropped[]` → existing duplicate → wizard). Not started here.

## Scope / files

- `lib/tiktok/import/{types,readers,map,account}.ts` — classify the three generations, six GET readers, map + finalize
- `lib/tiktok/import/__fixtures__/ironworks-v1.3.ts` — documented v1.3 envelopes (live Ironworks capture needs `TIKTOK_TOKEN_KEY`)
- `lib/tiktok/import/__tests__/import.test.ts` — classify, map (manual / upgraded / legacy), readers, path allowlist, write/** freeze
- `app/api/tiktok/campaigns/route.ts` — stub becomes a real `/campaign/get/` list
- `app/api/tiktok/campaigns/import/route.ts` — POST import
- `components/tiktok/tiktok-import-{button,picker}.tsx` + library header next to New
- `components/tiktok-wizard/steps/{account-setup,review-launch}.tsx` — dropped list + enhancement line
- `lib/types/tiktok-draft.ts` + `migrateTikTokDraft` — `importMeta` on state JSON, no migration

Did not touch: `lib/tiktok/write/**` (import only reads mapping tables), `evaluate.ts` / `apply.ts` / `gates.ts`, `components/plan/**`, `OFFPIXEL_TIKTOK_WRITES_ENABLED`, frames.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5767 pass, 4 skipped
- [x] `frames:check` — no frame file touched, no baselines regenerated

## Notes

**Six paths only.** `/campaign/get/`, `/adgroup/get/`, `/ad/get/`, `/smart_plus/adgroup/get/`, `/smart_plus/ad/get/`, `/campaign/spc/get/`. `/smart_plus/ad/get/` `page_size` max 100. Never `ad_ids_v2`. Upgraded campaigns also call `/ad/get/` with `campaign_automation_type: UPGRADED_SMART_PLUS` so the operator sees chosen vs TikTok-added creatives.

**Fixtures.** Live capture against advertiser `7639802149165301776` was not possible from this worktree (no `TIKTOK_TOKEN_KEY`). Fixtures match the documented v1.3 envelopes; replace with verbatim Ironworks rows when a read-only capture can run.

**Name.** Mapped draft goes through `duplicateTikTokDraftState` (clears `publishedIds`, heals schedule), then the name is set to `source — relaunch`.

**Meta parity.** Named in the PR body. Not built.
