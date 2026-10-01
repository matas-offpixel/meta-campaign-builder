# Session log

## PR

- **Number:** 1008
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1008
- **Branch:** `cursor/library-row-action-overflow`

## Summary

Published library rows had grown a button per action, so the meta line wrapped under the cluster. Manage rows now keep Open and put the rest in the existing overflow menu. Audience and destination dialogs open from that menu and say why they cannot write when the gate is off.

## Scope / files

- `components/library/library-rows.tsx` — Open plus OverflowMenu; meta line stays one line
- `components/library/adset-audience-push.tsx`, `adset-destination-push.tsx` — controlled `open` / `onOpenChange`; no trigger when controlled
- `components/library/__tests__/library-rows.test.tsx` — Vitest + Testing Library
- `vitest.config.ts`, `package.json` — run that suite after `npm test`

## Validation

- [x] `npm test` — 6537 passed, 4 skipped, plus 5 Vitest
- [x] `npm run build`

## Notes

Drafts and archived rows pick up the same menu. The pick variant and the Delete? confirm strip are unchanged. Write paths and the gate are unchanged.
