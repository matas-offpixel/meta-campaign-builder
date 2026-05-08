## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `feat/venue-report-layout-restructure`

## Summary

Restructure the venue report (internal `/clients/[id]/venues/[event_code]` + share `/share/venue/[token]`) around a single sticky header with global Timeframe + Platform filters, a Black-Butter style topline stats grid, and a multi-platform Daily Trend graph. Removes duplicated/scattered sections (top Performance Summary table, standalone Total Marketing Budget line, Linked Campaigns, per-section sync buttons) in favor of one sync button + clean section ordering.

## Scope / files

- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — wire global `?tf=` + `?platform=` URL params, single Sync Now button, sticky header
- `app/share/venue/[token]/page.tsx` — same sticky header + sub-tab bar + share-token auth for Insights/Pacing tabs (parity with internal)
- `components/share/venue-full-report.tsx` — restructure section order, drop Total Marketing Budget line + Linked Campaigns, thread platform filter through children
- `components/share/venue-stats-grid.tsx` — NEW Black-Butter style 10-cell stats grid with platform tabs + empty-state cards
- `components/share/venue-report-header.tsx` — NEW sticky header with title (from `getSeriesDisplayLabel`), Live indicator, Sync Now, sub-tab bar, days-until chip, global Timeframe + Platform selectors
- `components/share/venue-active-creatives.tsx` — accept `platform` filter; group by platform when "All"
- `components/dashboard/events/event-trend-chart.tsx` — accept `platform` filter; lifetime totals in pill labels
- `components/dashboard/events/daily-tracker.tsx` — collapsed-by-default to last 14 days
- `lib/dashboard/platform-colors.ts` — NEW central color spec (Meta blue `#1877F2`, Google Ads red `#EA4335`, TikTok black `#000`)
- `app/api/share/venue/[token]/funnel-pacing/route.ts` — NEW share-token auth path for Funnel Pacing
- `app/api/share/venue/[token]/creative-patterns/route.ts` — NEW share-token auth path for Creative Insights
- Component tests for timeframe + platform filter behavior, layout DOM order, empty-state cards

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] Internal `/clients/[id]/venues/4TF26-ARSENAL-CL-FL` renders title "Arsenal Champions League Final – London" (not "Outernet")
- [ ] Share `/share/venue/[token]` renders identical layout to internal
- [ ] Sticky header stacks vertically below 640px
- [ ] All 4 platform tabs (All/Meta/TikTok/Google Ads) render even with no TikTok/Google Ads data; empty cards link to settings
- [ ] PR #339 trend chart leading-zero trim still in effect

## Notes

- Cross-thread: `components/share/**` is shared between dashboard + share threads. The user explicitly requested this restructure across both surfaces; aligning via this session log + PR description.
- TikTok platform color: black (#000) per user choice (option A vs pink #FE2C55).
- Share-route tabs: full 3-tab parity (Performance / Creative Insights / Funnel Pacing). Adds share-token auth to two new API routes for the Insights + Pacing data paths.
- Performance Summary (3 cards) + Event Breakdown remain lifetime-scoped (decision pills); Stats Grid + Daily Trend + Daily Tracker + Active Creatives respond to the global Timeframe filter.
