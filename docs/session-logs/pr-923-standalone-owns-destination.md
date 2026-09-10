# Session log

## PR

- **Number:** 923
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/923
- **Branch:** `cursor/standalone-owns-destination`

## Summary

A standalone draft owns its destination. The destination field was gated on `useIsDrawer()`, and every drawer mounts `surface="drawer"` even as `variant="page"`, so `/tiktok-campaign/[id]` and `/google-search/[id]` locked the URL behind a tip that named a canvas the operator cannot reach. The gate now asks whether a plan owns the destination (`planId != null`). Plan-linked drafts stay a badge with the canvas tip; standalone drafts get the same editable field the wizard already rendered.

## Scope / files

- `components/steps/step-surface.tsx` — context carries `planOwnsDestination`; inner providers inherit
- `components/plan/{meta,tiktok,google}-drawer.tsx` — `planOwnsDestination={planId != null}`
- `components/tiktok-wizard/steps/creatives.tsx` — destination gates on ownership
- `components/google-search-wizard/steps/ad-copy.tsx` — same
- `components/steps/creatives.tsx` — same (Meta stays correct on its own merits, not because #922 restored the ladder)
- `lib/plan/__tests__/drawer.test.ts` — tip cannot render while `planId` is null; plan-linked still badges
- `lib/plan/drawer.ts` — comment on the three `destinationTip` copies

Destination field only. Chrome, grid columns, and the rest of `surface="drawer"` stay. No launch caller, no adapter, no schema, no flag change.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5444 pass, 4 skipped)
- [x] `npm run frames:check` — local darwin diffs against Ubuntu rasters (height mismatch = 100%). No baselines regenerated. No frame renders a standalone route or an open drawer, so Ubuntu CI should stay still. If CI names a frame, stop.

## Notes

Matas is blocked on `[IRW0001] Jamie Jones -signup 20 - Interests 3` (`/tiktok-campaign/f5a194e7-2775-4534-904c-d83a37d11ceb`). The 26 creatives already carry `landingPageUrl`; this PR makes the field reachable on the standalone route.
