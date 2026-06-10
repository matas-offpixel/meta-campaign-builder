# Session log — wizard multi-campaign attach

## PR

- **Number:** 595
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/595
- **Branch:** `cursor/wizard-multi-campaign-attach`

## Summary

Adds multi-select support to the standalone wizard's "Add to existing campaign" mode. Previously operators had to launch the wizard 4 separate times to attach new ad sets and ads to 4 KOC venue campaigns. Now they can tick up to 8 campaigns in Step 1 and a single launch creates one new ad set under each, serially with a 1-second gap between campaigns for rate-limit safety.

## Scope / files

- `lib/types.ts` — extracted `ExistingMetaCampaignSnapshot` interface, added `ATTACH_CAMPAIGN_CAP = 8`, added `existingMetaCampaigns?: ExistingMetaCampaignSnapshot[]` (legacy singular kept `@deprecated`), added `CampaignAttachResult` interface and `LaunchSummary.campaignAttachResults`
- `lib/autosave.ts` — `migrateDraft()` wraps legacy `existingMetaCampaign` → `existingMetaCampaigns[0]`
- `components/steps/campaign-setup.tsx` — `CampaignMultiPicker` replaces `CampaignPicker` in `attach_campaign` mode; single-select kept for `attach_adset`; `attach_adset` mode button disabled when >1 campaigns selected; chip list with X to deselect
- `app/api/meta/launch-campaign/route.ts` — resolves `attachCampaignSnapshots` (multi + legacy fallback), validates all campaigns in Phase 1 in parallel, multi-campaign Phase 2+4 loop after Phase 3 (shared creatives), 1-second sleep between campaigns, adds `campaignAttachResults` to summary
- `components/steps/review-launch.tsx` — multi-campaign count badge, per-campaign events in live feed, aggregated CountChips

## Validation

- [x] `npm run build` — passed
- [x] Existing dropbox + storage-upload unit tests — passed
- [ ] Post-merge: open wizard for any draft → Step 1 → multi-pick 2-3 KOC venue campaigns → launch → verify per-campaign success

## Notes

- Old drafts with single `existingMetaCampaign` are migrated to `existingMetaCampaigns[0]` by `migrateDraft()` — backward compat preserved.
- Creatives (Phase 3) are created once and shared across all campaigns — only ad sets and ads are per-campaign.
- Lookalike ad sets are handled in the additional-campaign loop (Phase 2b lite).
- `attach_adset` behavior is unchanged; multi-select campaigns are incompatible with `attach_adset` and the mode button is disabled when >1 campaign is selected.
