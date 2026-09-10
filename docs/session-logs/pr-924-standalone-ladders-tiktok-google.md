# Session log

## PR

- **Number:** 924
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/924
- **Branch:** `cursor/standalone-ladders-tiktok-google`

## Summary

`/tiktok-campaign/[id]` and `/google-search/[id]` get their ladders back. Matas could not change the TikTok objective on a live Ironworks draft because the only control sat three disclosures deep (`▸ details` → `▸ campaign` → `<select id="tiktok-objective">`) and Review showed it as settled fact with no way back. Same shape #922 undid for `/campaign/[id]`. `/plan/[id]` is untouched: the three drawers stay byte-identical. Steps are shared — no forks.

## Scope / files

- `components/tiktok-wizard/wizard-shell.tsx` — `WizardStepper` + existing TikTok steps; `ReviewLaunchStep` only when `!linkedPlan`
- `components/google-search-wizard/wizard-shell.tsx` — same for Google; `PushStep` only when `!linkedPlan`; no Review step restored
- `components/wizard/wizard-stepper.tsx` — optional `steps` (default Meta `WIZARD_STEPS`)
- `components/wizard/wizard-footer.tsx` — `showTemplates` (Google has none)
- `components/tiktok-wizard/steps/review-launch.tsx` — every asserted value links to the step that sets it
- `components/google-search-wizard/steps/push.tsx` — stats and hard errors jump to the step that owns them
- `lib/types/tiktok-draft.ts` — `TIKTOK_WIZARD_STEPS` restored
- `lib/google-search/validation.ts` — `GOOGLE_SEARCH_WIZARD_STEPS` restored (7 items; old Review index folded into Push)
- `lib/plan/__tests__/drawer.test.ts` — two-track assertions; `components/plan` freeze still empty

Did not touch: the three drawers, `lib/plan/drawer.ts` (`tiktokDetailRows` stay `editable: false` — those rows are the canvas details, not the standalone ladder), launch callers, adapters, schema, `ENABLE_PLAN_FANOUT`, `OFFPIXEL_TIKTOK_WRITES_ENABLED`.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5446 pass, 4 skipped)
- [x] `npm run frames:check` — local darwin diffs against Ubuntu rasters (height mismatch = 100% on some frames). **No baselines regenerated.** No frame renders a standalone route or an open drawer. Ubuntu CI should stay still. If CI names a frame, stop.

## Notes

Carried from #922 (`ce9d85f`): stepper + footer in the shell; shared draft controller (`useTikTokDraft` / `useGoogleSearchTree`); plan-linked hides Launch/Review/Push and footer `planHref` → `/plan/[id]`; standalone keeps `ReviewLaunchStep` / `PushStep`; canvas still mounts `*DrawerMount` as a sheet; do not grow a stepper on the canvas.

`tiktokDetailRows` row by row — not flipped. See PR body.

Ironworks draft: `/tiktok-campaign/f5a194e7-2775-4534-904c-d83a37d11ceb`. Change objective Lead generation → Traffic from the Campaign step in one click.
