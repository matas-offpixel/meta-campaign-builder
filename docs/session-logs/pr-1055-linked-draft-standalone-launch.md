# Session log

## PR

- **Number:** 1055
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1055
- **Branch:** `cursor/linked-draft-standalone-launch`

## Summary

A plan link was hiding Review and Launch for every linked Meta draft. Attach drafts and already-published drafts had nowhere to launch, because the canvas only starts a new campaign, paused. The canvas now takes Launch only for an unpublished new campaign whose Meta row is still idle or failed. Every other linked draft launches from the creator. Review always renders.

## Scope / files

- `lib/plan/linked-plan.ts` — `planOwnsLaunch`. Meta loader also returns `metaLaunchStatus`. The campaign page passes that summary into the shell; wizard mode and draft status are on the client draft, so the shell is the call site.
- `components/wizard/wizard-shell.tsx` — uses the helper for Review and the footer Launch button.
- `components/steps/review-launch.tsx` — when the canvas owns Launch, the review stays and the canvas pointer replaces the launch controls.
- `app/api/meta/launch-campaign/route.ts` — no refusal of a plan-linked draft. `recordWizardMetaLaunch` at lines 2042 and 4987 writes the plan row after a wizard launch; it does not block one. The helper and the route agree because the route has no second rule.
- `lib/meta/__tests__/transient-retry.test.ts` — retry still re-enters `handleLaunch`, omitted only when the canvas owns Launch.

## Validation

- [x] `npm test` — 7300 pass, 0 fail, 4 skipped; vitest library rows 8 pass
- [x] `npx tsc --noEmit` — no errors in touched files
- [x] ESLint on touched files — clean except 8 pre-existing unused-import warnings in `review-launch.tsx`
- [x] `npm run build` — typecheck and page data succeeded. A gitignored `scripts/out/gds-groups.mts` fails the local typecheck; that directory is not in CI and was set aside for this run, then restored.
- [ ] Screenshot of `/campaign/645ed600-6863-4175-af9a-2a7234b0e7b1` Review. Not captured: no signed-in browser in this session. Launch was not pressed.

## Notes

`"new"` is the new-campaign wizard mode. Migration 194 is unrelated and was not touched.
