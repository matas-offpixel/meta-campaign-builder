# Session log — wizard attach multi-objective parity (PR #600)

## PR

- **Number:** pending
- **URL:** (pending)
- **Branch:** `cc/wizard-attach-multi-objective-parity`

## Audit findings

| Question | Answer |
|----------|--------|
| Bulk-attach uses `assertSameObjective`? | **No** — `/api/meta/bulk-attach-ads` has no objective-compat gate |
| Launch route gate scope | Was `attach_campaign \|\| attach_all_adsets`; **not** `attach_adset` |
| Wizard UI greyout | `getExtraDisabledReason` on all attach modes; bulk-attach omits it |
| "new" mode uses CampaignMultiPicker? | **No** — objective picker is radio buttons only |

## Summary

Drop same-objective greyout for wizard `attach_campaign` and `attach_adset` (parity with bulk-attach). Keep constraint for `attach_all_adsets` only (UI + Phase 0). Launch route uses per-campaign `internalObjective` when creating ad sets under mixed-objective attach_campaign selections.

## Scope / files

- `components/steps/campaign-setup.tsx`
- `app/api/meta/launch-campaign/route.ts`
- `lib/meta/attach-objective.ts` (comment)

## Validation

- [x] `npm run build`
- [x] `lib/meta/__tests__/attach-objective.test.ts`
- [ ] Preview: multi-pick Purchase + Traffic + Reach in attach_campaign / attach_adset
