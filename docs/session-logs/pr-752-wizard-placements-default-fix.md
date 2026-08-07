# Session log

## PR

- **Number:** 752
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/752
- **Branch:** `cursor/wizard-placements-default-fix`

## Summary

Follow-up correction to PR #751 (task #117, wizard-wide Placements config).
The manual-mode seed the Step 5 "Placements" card writes the moment an
operator flips the toggle from Advantage+ to Manual (`MANUAL_PLACEMENT_DEFAULTS`
in `components/steps/budget-schedule.tsx`) shipped as `FB Feed + IG Feed only`.
That was the wrong default per the operator's actual intent: FB Reels/Story/
Marketplace underperform for electronic music campaigns, while IG's Reels/
Story/Explore are strong placements that shouldn't be excluded by default.
Corrected seed:

- Facebook: **Feed only** (unchanged)
- Instagram: **all** positions — Feed/Stream, Reels, Story, Explore,
  Explore Home, IG Search (was Feed/Stream only)
- Audience Network / Messenger: still OFF, still opt-in (unchanged)
- Device platforms: left unset in the seed (Meta already treats an absent
  `device_platforms` field as "both" — `buildPlacementConfigTargeting` and
  the picker's own fallback already handle this; previously the seed set
  `devicePlatforms: ["mobile", "desktop"]` explicitly, which was functionally
  identical but no longer matches the spec's exact shape)

No backend/Meta-payload logic changed — `lib/meta/placement-config.ts` and
`lib/meta/adset.ts` already handled arbitrary `instagramPositions` arrays
correctly from PR #751; this is purely a change to the initial value the
wizard UI seeds when an operator first switches a campaign (or a per-ad-set
override) to Manual placements. Existing drafts / already-selected manual
configs are untouched — this only affects the one-time seed on toggle-flip.

## Scope / files

- `components/steps/budget-schedule.tsx` — `MANUAL_PLACEMENT_DEFAULTS`
  constant corrected to the shape above. No other logic changed; the IG
  checkbox rendering already reads live off `effective.instagramPositions`
  (`igPositions.includes(p.value)`), so all 6 IG checkboxes render checked
  automatically now that the seed includes all 6 values — operator can still
  uncheck any of them. The two advanced-only IG positions (Explore Home, IG
  Search) are checked but sit behind the existing "Show advanced placements"
  disclosure, same as before this fix.
- `lib/meta/__tests__/manual-placement-default.test.ts` (new) — source
  assertion pinning the corrected `MANUAL_PLACEMENT_DEFAULTS` shape in
  `budget-schedule.tsx`, a behavioural test feeding that exact shape through
  `buildPlacementConfigTargeting` to confirm the resulting Meta targeting
  payload (`facebook_positions: ["feed"]`, `instagram_positions` with all 6
  values, no `audience_network_positions`, no `device_platforms`), and a
  regression guard that the old single-IG-position default is gone.

## Validation

- [x] `npx tsc --noEmit` — clean
- [x] `npx eslint components/steps/budget-schedule.tsx lib/meta/__tests__/manual-placement-default.test.ts` — clean
- [x] `npm test` — 3387 tests (+3 new), 3371 pass, 13 pre-existing/unrelated
  failures unchanged (same set documented in the PR #751 log: dashboard
  venue-trend-points / `@/lib` path-alias resolution, a canonical-tickets
  window test, the creative-buy-tickets-cta rotation test, asset-queue
  copy-generator/sheet-parse — all fail identically on a clean `main` before
  this branch's changes)

## Notes

- See "Correction 2026-08-07" note added to
  `docs/session-logs/pr-751-wizard-placements-config.md` for the
  cross-reference from the original PR.
- No migration, no Meta-payload logic change — UI seed value only.
