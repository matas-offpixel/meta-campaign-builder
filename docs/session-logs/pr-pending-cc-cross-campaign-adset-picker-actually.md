# Session log — cross-campaign ad-set picker wiring fix

## PR

- **Number:** pending
- **URL:** (pending)
- **Branch:** `cc/cross-campaign-adset-picker-actually`

## Summary

PR #596 merged `CrossCampaignAdSetPicker`, launch-route orphan checks, and validation updates, but **left `attach_adset` on single-select `CampaignPicker`**. Users starting in "Add to existing ad set" could never multi-pick campaigns — Goal 3 UI was dead on prod. This PR wires `CampaignMultiPicker` for `attach_adset`, adds `handleToggleCampaignAdSet` (prunes ad sets when a parent campaign is removed), enforces the 12-ad-set cap in the toggle handler, and tightens the Phase 0 orphan error copy.

## Audit (PR #596 vs prod repro)

| Item | PR #596 claim | Actually on main before this fix |
|------|---------------|----------------------------------|
| Goal 1 objective compat | Shipped | ✅ `assertSameObjective`, `getExtraDisabledReason` |
| Goal 2 attach_all_adsets | Shipped | ✅ mode + launch Phase 2 |
| Goal 3 CrossCampaignAdSetPicker | Shipped | ⚠️ component exists but unreachable — `attach_adset` used `CampaignPicker` (single) |
| `CROSS_CAMPAIGN_ADSET_CAP` | Shipped | ✅ in `lib/types.ts` |
| Phase 0 orphan check (multi campaign) | Shipped | ✅ Set of campaign IDs (error copy improved here) |
| `existingMetaAdSets` validation | Shipped | ✅ in `lib/validation.ts` |

## Scope / files

- `components/steps/campaign-setup.tsx` — `CampaignMultiPicker` for `attach_adset`; `handleToggleCampaignAdSet`
- `components/steps/cross-campaign-adset-picker.tsx` — cap tooltip copy
- `app/api/meta/launch-campaign/route.ts` — clearer Phase 0 orphan message

## Validation

- [x] `node --test lib/meta/__tests__/attach-objective.test.ts`
- [x] `npm run build`
- [ ] Vercel Preview: attach_adset → multi-pick 2 same-objective campaigns → CrossCampaignAdSetPicker sections appear

## Notes

Root cause of "PR shipped but prod broken": backend + cross picker landed; campaign multi-select was only wired for `attach_campaign` / `attach_all_adsets` family, not `attach_adset`.
