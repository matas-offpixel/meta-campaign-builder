# Session log

## PR

- **Number:** 932
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/932
- **Branch:** `cursor/audiences-tabs-flow-across`

## Summary

#879 flattened the Meta Audiences tab bar into a stacked column of `edit ▸` rows. #922 restored the wizard ladder; nobody restored these tabs. This PR puts `Tabs` / `TabPanel` back around the same panels, on both the wizard ladder and the Meta drawer, with the current glyphs, short nouns, and richer counts. Selecting a tab is the edit — `edit ▸` is gone.

## Scope / files

- `components/steps/audiences/audiences-step.tsx` — restore the left-to-right bar. State (`AudienceTab`, `activeTab`, `initialAudienceTab`) is unchanged. Panels, props, and handlers are unchanged. The `surface` container width branch stays; the bar is not forked on `surface` or `useIsDrawer()`.
- `lib/plan/__tests__/drawer.test.ts` — the #879 grep-guard now asserts the restore.

Did not touch: `components/ui/tabs.tsx`, `components/plan/**`, `lib/meta/**`, frames.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5477 pass, 4 skipped)

## Notes

Counts live in the tab label (`▦ pages · 3 groups · 22 pages`). `Tabs.count` is a number pill sized `h-5 min-w-5`. Extending it to `number | string` would either squash those strings into a badge they do not fit, or restyle the four dashboard callers (`client-detail`, `event-detail`, `event-detail-tabs`, `event-reporting-tabs`). Those callers stay byte-identical because the shared component did not change.

`initialAudienceTab` still opens on `pages` when the draft already has page groups.
