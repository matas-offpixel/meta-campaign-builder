# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/dashboard-v2-creative`

## Summary

HE5 adds the E4 creative section on the sales dashboard and the client share link. Scores are the stored `creative_scores` rows. Spend, results, tags, TikTok snapshots, Lab renders and the refresh's pause lines are read through the helpers that already return them. A format cost shows only where that objective spent £500 or more. When the on-sale refresh is on for a single show, least impact is that show's pause lines.

## Scope / files

- `lib/dashboard/creative-section.ts` and the objective, fixture and server readers
- `components/dashboard/creative-section/**`
- Sales and share pages mount the section under the existing panels
- Frames CR1 / CR1S at 1280 and 393, from the IRW0001 read of 15 Nov 2026
- Refresh line anchors so a pause row can open its line

## Validation

- [x] `node --test lib/dashboard/__tests__/creative-section.test.ts`
- [x] `vitest run components/dashboard/sales/__tests__/creative-section.test.tsx`
- [x] `tsc --noEmit` reports no errors in the touched files
- [ ] `frames:check` on the PR

## Notes

IRW0001's scored ad names are not S14 file names, and none of its AI tag labels are the five format names, so that fixture's format table is empty. The £500 gate is covered by a constructed S14 input in the unit test. The frame is the top signup and purchase creatives of Jamie Jones (IRW0001), not the season-report drawing.
