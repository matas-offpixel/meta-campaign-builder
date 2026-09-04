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
- [x] `npm test` — 5068 pass, 3 skipped, 0 fail (Chrome-pass follow-up)

## Follow-up — Chrome pass on `75632e7` (app.offpixel.co.uk/plan/abf386e4-… Ironworks)

1. Blocker popover: portal + deferred #871 closer + Escape + `BLOCKER_BADGE_DISMISS` on drawer open/Done. Pin: `blockerBadgeAfterGesture("open-other-row")` + badge source-guard.
2. Blocker row click: `onOpenAnchor(row.anchor)` → `openDrawerOrWizard(..., anchor ?? row.anchor)`. Pin: `blockerBadgeAfterGesture("row", { anchor: { drawer: "meta", section: "f-audiences" } })`.
3. Details/preflight resolve client defaults (`apply*` always, even on a linked empty draft); first drawer open writes via `fill*IfEmpty`; mirror `validateStep(..., resolved)`. Pin: `resolveDetailField` + empty linked Meta draft in `channel-defaults.test.ts`.
4. Plan destination URL reaches TikTok `DestinationBadge` and Google final-URL badge; ad-text hydrates from the first item (derive path already in `asset-routing.test.ts`).
5. Drawer `lg:w-[min(880px,64vw)]` / `max-lg:inset-0` + dim backdrop; creatives `grid-cols-1` when `surface="drawer"`.
6. Copy: "no page groups" / "no lookalike groups".

## Notes

Kept (importer still exists): `getVisibleSteps`, `LoadTemplateModal` / `TikTokLoadTemplateModal`, `WizardFooter` (Launch / Save Draft / errors, no Back/Continue), Meta `ReviewLaunch` launch panel, TikTok `ReviewLaunchStep`, Google `PushStep`, `wizardHrefForDraft` (Meta overflow + prepare-draft API).
