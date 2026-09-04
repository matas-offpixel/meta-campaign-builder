# Session log

## PR

- **Number:** 885
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/885
- **Branch:** `cursor/canvas-polish-apply`

## Summary

PR 8b applies the #884 tokens to canvas and drawer surfaces: per-zone gutters and a testable height budget, identity chips resolved from stored caches (never a live Meta/TikTok/Google call), segmented target/budget controls, `formatVizMoment` on operator-facing dates, five audience source rows, creatives asset-first in the drawer, and decisions/details row rhythm.

## Scope / files

- `lib/plan/canvas.ts` — `planCanvasHeightBudget()`
- `lib/plan/identity-chips.ts` + `identity-names-load.ts` — name map, display, server loader
- `app/(dashboard)/plan/[id]/page.tsx` — identity-name query
- `components/plan/**` — gutters, type scale, segmented controls, details, decisions
- `components/steps/audiences/audiences-step.tsx` — five rows, no `ui/tabs`
- `components/steps/creatives.tsx` — 160px hero slots, identity disclosure
- `components/optimisation/automation-arm-control.tsx` — type tokens + `formatVizMoment`

## Validation

- [x] `npx tsc --noEmit` (no new errors in 8b files; pre-existing test-file noise remains)
- [x] `npm run build`
- [x] `npm test` (5093 pass, 3 skipped)

## Notes

### Zone heights vs spec (1372 × 883, chrome 72)

| Zone | Spec | Implementation |
|---|---|---|
| A header | 88 | `min-h-[88px]` |
| B window | 64 | `min-h-[64px]` (WindowBar is already `h-16`) |
| C budget | 80 | `min-h-[80px]` |
| D target | 80 | `min-h-[80px]` |
| E channels | 120 | `min-h-[120px]` |
| F assets | 72 | `min-h-[72px]` |
| G launch | 48 | `min-h-[48px]` |

Gutters: A→B `normal` 20, B→C / C→D `tight` 16, D→E `loose` 24, E→F `normal` 20, F→G `loose` 24. Content 552 + gutters 120 = **672**. Launch bottom `launchY` = 72 + 672 = **744**.

### Identity-name sources

| Chip | Source | Still shows id + ┄ when |
|---|---|---|
| Meta ad account | `user_ad_account_list_cache` + `bm_ad_accounts.name` | cache miss and BM sync never ran |
| Meta pixel | `bm_pixels.name` | no BM pixel row |
| Page | `bm_pages.page_name` | no BM page row |
| IG | `bm_ig_accounts.ig_username` | no BM IG row |
| TikTok advertiser | `tiktok_accounts.account_name` | no linked TikTok account row |
| TikTok identity | **none stored** | always (id + ┄) |
| Google customer | `google_ads_accounts.account_name` | no matching customer row |

### Spec items not built as written

- `ThresholdBand` sm/md heights stay as 8a left them — 8b must not edit `components/viz/**`.
- Identity names load on the plan page from stored tables, not via `GET /api/meta/*` from `plan-identity-chips.tsx` (user instruction: never call platforms from canvas render).
- TikTok identity has no display-name cache in tree; unknown = id + ┄.
- Audience rows replace Tabs for wizard and drawer (grep-guard: no `@/components/ui/tabs` import).
- `toISOString()` remains in `plan-workspace.tsx` for localStorage / PATCH timestamps — not rendered.
