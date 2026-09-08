# Session log

## PR

- **Number:** 922
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/922
- **Branch:** `cursor/restore-campaign-wizard`

## Summary

`/campaign/[id]` gets its eight-step ladder back. Objective and optimisation goal are their own steps again — one click, no `▸ details` ▸ `▸ campaign`. `/plan/[id]` is untouched: MetaDrawer, three tabs, `details` stay. The #879/#883 defect fixes that were not a surface removal stay (shared `useCampaignDraft`, plan-linked Launch pointer, #871 blocker closer, Ironworks defaults, drawer width).

## Scope / files

- `components/wizard/wizard-stepper.tsx` — recovered from `d40c700^`
- `components/wizard/wizard-shell.tsx` — ladder from `d6c4be7`, still on `useCampaignDraft`
- `components/wizard/wizard-footer.tsx` — Back / Continue / templates restored; `showLaunch` / `planHref` kept
- `lib/types.ts` — `WIZARD_STEPS` restored (the stepper reads it)
- `lib/plan/__tests__/drawer.test.ts` — two-track assertions; canvas / frames / launch-route git-diff guard

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5440 pass, 4 skipped)
- [x] canvas / frames / `launch-campaign` have no diff against main — `frames:check` must stay green with zero regenerated baselines

## Notes

Kept from #879: `useCampaignDraft` shared with the plan drawer; standalone ReviewLaunch + Launch; plan-linked footer points at the canvas.

Kept from #883: blocker popover closer, resolvable client default, drawer width, TikTok destination — none of those files are in this PR.

Not restored: TikTok / Google ladders. Those stay drawers.
