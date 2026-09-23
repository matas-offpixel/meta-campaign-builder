# Session log

## PR

- **Number:** 962
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/962
- **Branch:** `cursor/google-search-push-live`

## Summary

Google Search push now creates campaigns live unless the operator sends `launchPaused: true` or the build sheet marks that campaign paused. The Push panel states the live count, the paused count, and each paused campaign by name before the operator commits. Search Partners are turned off in a separate commit, because every build sheet says to.

## Scope / files

- `lib/google-ads/push-status.ts` — one resolver for campaign, ad group, and ad status
- `lib/google-ads/campaign-writer.ts` — builders take the resolved status; start-date and null-URL gates run before any mutate
- `app/api/google-search/[id]/push/route.ts` — strict `launchPaused` / `confirmStart` parse before the plan is loaded
- `components/google-search-wizard/steps/push.tsx` — confirmation sentence, paused checkbox, past-start confirm
- Tests in `lib/google-ads/__tests__/`, plus the paused-everywhere audit and the drawer diff exclusion for the single-campaign fixture date

## Validation

- [x] `npm run build` (TypeScript step finished; pre-existing remotion `config` warning)
- [x] `npm test` — 6079 pass, 0 fail, 4 skipped
- [ ] `npx tsc --noEmit` — not run separately; `next build` typecheck passed

## Notes

`launchPaused` matches TikTok's name for the same choice. The route is still push. Default is live.

Precedence: `launchPaused: true` pauses everything. Otherwise a campaign the sheet marks PAUSED stays paused (`status_at_launch` or `status_at_launch_by_campaign` for that campaign's name). Everything else follows the operator. An ad group whose name contains `(PAUSED)` is paused. That is a name convention, not a column. In single-campaign mode the map pauses an ad group whose C-code matches a paused source, and does not pause the merged campaign.

#961 said push already hardcodes Search Partners off. It did not: `targetSearchNetwork` was true. This branch turns it off in its own commit. Display expansion (`targetContentNetwork`) was already false.

No killswitch. Keywords stay ENABLED. No migration. `lib/google-search/xlsx-import.ts` was not edited.
