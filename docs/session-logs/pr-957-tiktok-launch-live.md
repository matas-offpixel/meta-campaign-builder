# Session log — TikTok launch live

## PR

- **Number:** 957
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/957
- **Branch:** `cursor/tiktok-launch-live`

## Summary

TikTok launches default live (`ENABLE` at campaign, ad group, and ad).
Paused stays on Review for smoke tests. The button names the mode, the
choice persists on the draft JSON, and a live click confirms spend × days
in the advertiser timezone before anything is written. Success copy says
when delivery starts instead of sending the operator to Ads Manager to
enable a switch that is already on.

## Scope / files

- `lib/tiktok/write/mapping.ts` — `resolveTikTokLaunchOperationStatus` plus the
  three `operation_status` lines. Nothing else in that file.
- `lib/tiktok-wizard/launch-live.ts` — confirm sentence, button label, success copy
- `components/tiktok-wizard/steps/review-launch.tsx` — select + confirm + button
- `lib/tiktok-wizard/launch-progress.ts` — live vs paused success panel
- `CLAUDE.md` + launch-campaign route comment — remaining gates, not the old pause gate

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 6036 pass, 0 fail, 4 skipped

## Notes

- Per-launch choice is the right shape. Always-live would remove the only
  safe smoke-test against a client account. The three statuses stay coupled.
- `mapping.ts` already excluded from the write-path guard; preflight.ts
  untouched so the #956 companion stays.
- Historical published drafts with no `launchPaused` still show paused
  success copy. New live launches stamp `launchPaused: false`.
