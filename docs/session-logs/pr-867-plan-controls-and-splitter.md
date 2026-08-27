# Session log — plan controls and splitter

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/plan-controls-and-splitter`

## Summary

Simplify the plan page opening inputs: a wide library dialog, a buffered
Now start, event-resolved end chips, platform toggles, Daily/Lifetime
mode, and a locked/unlocked splitter. Presentation + plan-state only —
adapters still receive daily values; fan-out still skips a zero daily.

## End-date inventory

Resolved from `events` only:

| Chip | Column | On plan page |
|---|---|---|
| Presale | `events.presale_at` | loaded; button only if non-null |
| General sale | `events.general_sale_at` | loaded; button only if non-null |
| Event date | `events.event_date` | already loaded |

Not used: `d2c_event_copy` (no dates), `page_events` (countdown only),
`event_ad_plans` (table does not exist).

## Renormalisation + rounding

Preset weights are Meta / TikTok / Google. When a platform is off:

- Meta selected → Meta keeps its weight; the remainder (100 − Meta) is
  split among other selected platforms in their original ratio. Google
  off on 90/5/5 → 90/10 (TikTok inherits Google's 5).
- Meta off → remaining platforms renormalise in their original ratio
  (5:5 → 50/50). One remaining → 100.

Locked allocation: residue after rounding lands on the **largest
share**, so pennies sum exactly to the total.

## Budget-mode derivation

Lifetime ÷ inclusive scheduled days = daily total, then the splitter
runs. No schedule → lifetime is inert (`No schedule` chip). Adapters
unchanged.

## Dialog

`panelClassName` now **replaces** the default `max-w-md`. Picker uses
`max-w-5xl`. Pick rows: name + status; objective glyph + account chip +
relative date; Use pinned right.

## Validation

- [x] `npx eslint` on touched files — clean
- [x] `npx tsc --noEmit` — no errors in touched files
- [x] `npm run build` — compiled successfully
- [x] `npm test` — 4674 tests, 1183 suites; 4671 pass, 0 fail, 3 skipped
- [x] Falsified against parent sha `2b0aa64`: no `PLAN_START_BUFFER_MINUTES`;
      Dialog still concatenates `max-w-md` + `panelClassName`
