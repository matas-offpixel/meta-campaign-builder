# Session log

## PR

- **Number:** 920
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/920
- **Branch:** `cursor/tiktok-says-it-early`

## Summary

TikTok says it cannot run at the moment it gets a share of the money, not after the operator has written copy and prepared a draft. Three findings from walking the Electric Group advertiser (`7681317718284304385`) on 2026-09-08: the £50 GBP ad-group floor, a pixel with `events: []` under a conversion objective, and schedule times that are the advertiser's clock (`Etc/GMT`), an hour behind London until 25 Oct. Causes land in `lib/plan/preflight.ts` and flow to the canvas list and launch tip. No canvas redraw, no frames, no mapper change.

## Scope / files

- `lib/plan/tiktok-early.ts` — floor / unverified-currency / empty-pixel / advertiser-clock helpers
- `lib/plan/preflight.ts` — emit them when `tiktokDaily > 0`; supersede the late launch wording for the same cause
- `lib/plan/__tests__/tiktok-early.test.ts` — live 2026-09-08 fixtures
- `components/tiktok-wizard/steps/account-setup.tsx` — empty-pixel sentence where the pixel is chosen
- `components/tiktok-wizard/steps/budget-schedule.tsx` — clock label where schedule times are entered

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5424 pass, 4 skipped)

## Notes

- Floor is per ad group, per day. GBP 50 from `TIKTOK_MIN_DAILY_BUDGET_BY_CURRENCY`. A £50 plan across three ad groups still fails (`£50 a day each — three ad groups needs £150`).
- Unknown currency is a warning that names the currency, never silence.
- Pixel sentence names Traffic — the objective that needs no pixel event. Events list must be known-empty (`[]`); an unloaded list does not invent the finding.
- `formatWallClockForTikTok` is unchanged. The label does not convert or adjust times.
- `ENABLE_PLAN_FANOUT` and `OFFPIXEL_TIKTOK_WRITES_ENABLED` unchanged. No launch caller. No frames.
