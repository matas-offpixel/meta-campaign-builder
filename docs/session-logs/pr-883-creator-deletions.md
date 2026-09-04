# Session log

## PR

- **Number:** 883
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/883
- **Branch:** `cursor/creator-deletions`

## Summary

PR 7 of 7 of the campaign creator redesign: delete zero-importer wizard chrome (steppers, dead step files, Prose/Chrome, the chrome codemod, asset-routing-matrix), keep every file that still has an importer, pass Google `wizardContext` from the canvas so details show names, and put Save-as-Template on the Meta and TikTok drawer headers next to the loader.

## Scope / files

- Deleted: `wizard-stepper.tsx`, `tiktok-wizard/wizard-footer.tsx`, `campaign-picker.tsx`, `google-search-wizard/steps/review.tsx`, `asset-routing-matrix.tsx`, `scripts/codemod-step-chrome.mjs`
- Deleted exports: `WIZARD_STEPS`, `TIKTOK_WIZARD_STEPS`, `GOOGLE_SEARCH_WIZARD_STEPS` (validateStep stays)
- Deleted primitives: `Prose`, `Chrome` from `step-surface.tsx` (Datum, StatusLine, CardDescription kept)
- Fixes: Google canvas `wizardContext`; Save-as-Template on Meta + TikTok drawer headers
- Guards: zero-`<p>` / ui-card `CardDescription` across steps + both wizard dirs + plan + optimisation; no Stepper / Back-Continue Footer
- Docs: CLAUDE.md canvas + drawers; spec Shipped #876–#883

## Validation

- [x] `npx tsc --noEmit` (app/components compile; next build is the arbiter)
- [x] `npm run build` — compiled, TypeScript finished, 187 static pages
- [x] `npm test` — 5057 pass, 3 skipped, 0 fail

## Notes

**Hold merge** until a Chrome pass on prod (`75632e7` / #882). Findings land on this same branch as a follow-up commit before merge.

Kept (importer still exists): `getVisibleSteps`, `LoadTemplateModal` / `TikTokLoadTemplateModal`, `WizardFooter` (Launch / Save Draft / errors, no Back/Continue), Meta `ReviewLaunch` launch panel, TikTok `ReviewLaunchStep`, Google `PushStep`, `wizardHrefForDraft` (Meta overflow + prepare-draft API).
