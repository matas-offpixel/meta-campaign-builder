# PR #527 — fix(share-report): hide DAYS UNTIL EVENT card on brand_campaign

**Branch:** `cursor/hide-days-until-event-brand-campaign`
**PR:** pending
**Date:** 2026-06-03

## Problem

Ironworks brand awareness share report (`kind = brand_campaign`) showed a
"DAYS UNTIL EVENT → YESTERDAY" card even though always-on brand campaigns
have no single event date to count down to. The card is meaningless and
looks broken for venue awareness reporting.

## Fix

In `components/report/event-report-view.tsx`:

- Gate the StatCard with `event.kind !== "brand_campaign" && event.eventDate != null`
- Skip the entire top stats row when no cards would render (brand_campaign
  share reports with Meta data previously showed an empty section with only
  the days-until card)

Internal dashboard reporting tab uses the same `EventReportView` (embedded
variant), so gating applies there automatically. `event-detail.tsx` already
hid the days-until badge in the page header for brand campaigns.

## Files changed

| File | Change |
|------|--------|
| `components/report/event-report-view.tsx` | Hide days-until card for brand_campaign |
