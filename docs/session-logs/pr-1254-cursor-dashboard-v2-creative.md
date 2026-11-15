# Session log

## PR

- **Number:** 1254
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1254
- **Branch:** `cursor/dashboard-v2-creative`

## Summary

HE5 adds the E4 creative section on the sales dashboard and the client share link. Scores are the stored `creative_scores` rows. Spend, results, tags, TikTok snapshots, Lab renders and the refresh's pause lines are read through the helpers that already return them. A format cost shows only where that objective spent £500 or more. When the on-sale refresh is on for a single show, least impact is that show's pause lines.

## Scope / files

- `lib/dashboard/creative-section.ts` and the objective, fixture and server readers
- `components/dashboard/creative-section/**`
- Sales and share pages mount the section under the existing panels
- Frames CR1 / CR1S (Charlotte de Witte) and CR2 (Jamie Jones TikTok) at 1280 and 393
- Refresh line anchors so a pause row can open its line

## Validation

- [x] `node --test lib/dashboard/__tests__/creative-section.test.ts`
- [x] `vitest run components/dashboard/sales/__tests__/creative-section.test.tsx`
- [x] `tsc --noEmit` reports no errors in the touched files
- [x] `frames:check` ran on the PR. Overflow guard passed. The pixel diff is red until Ubuntu baselines exist for CR1, CR1S and CR2 (no local PNGs committed).

## Notes

Design fail at `62d71fc`, four items. The frame is now Charlotte de Witte (IRW0006), whose scored ad names say UGC, Static and Presale Reminder. UGC and static show a cost per signup; presale reminder stays under £500, so its costs are —. A share render drops Lab, refresh-line and Ads Manager links. On a phone the top 10 stacks; the TikTok table still scrolls inside its frame. This show has no TikTok snapshot. Completion stays covered by the IRW0001 window figures in the unit test.

Design fail at `9bcff19`. The source line names Meta, TikTok, or both, and only when that channel has rows. Phone rows say purchases; the title stays "Top 10 by sales". CR2 is Jamie Jones, internal, with the 15 Nov TikTok snapshot (window to 10 Oct). CR1 still says there are no TikTok creatives yet.

CI run https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/43711882421 (head `62d71fc`): `npm test` and `npm run build` passed. Overflow guard passed. `frames:check` failed only with `MISSING CR1-1280`, `CR1-393`, `CR1S-1280`, `CR1S-393` — the Ubuntu baselines are committed after a design pass, not from this machine. The earlier run failed `npm test` because the share page imported `lib/learning/read.ts`, which reaches the copy library. Score names are now the same latest `creative_scores` snapshot, read in the section server.
