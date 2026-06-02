# Cursor prompt [Cursor, Sonnet] — share-report "Paid media Spent" must aggregate across Meta + TikTok + Google Ads

Copy this entire block into Cursor as a single message. Sonnet — small, targeted bug fix with rename + a test. Confirmed bug, screenshot evidence on the BB26-KAYODE share.

PREREQUISITE: none. Standalone fix.

---

## BUG (confirmed live)

On the share at https://app.offpixel.co.uk/share/report/Rul8DeLZBVTZ0kZr the Performance Summary card reads:

> Paid media: £480 Allocated · **£177 Spent (37%)**

Total cross-platform spend is **£477** (Meta £177 + TikTok £160 + Google £140) — visible at the bottom of the same page ("Total Spend £477 across 11 days") and in the Daily Trend chart with Meta / Google Ads / TikTok pills. The headline only counts Meta.

## ROOT CAUSE

`components/share/venue-full-report.tsx:602`:

```ts
const paidMediaSpent = sumLifetimeMetaSpend(rollups, events.length > 1);
```

`sumLifetimeMetaSpend` (line 694–710 in the same file) is hard-coded to Meta. It calls the shared `paidSpendOf` helper but **passes `tiktok_spend: null`** and never passes `google_ads_spend` at all:

```ts
total += paidSpendOf({ ad_spend: spend, tiktok_spend: null });
```

`paidSpendOf` in `lib/dashboard/paid-spend.ts` is *designed* to sum Meta + TikTok + Google Ads (lines 32-34). The bug is the caller passing nulls for two of the three platforms.

This makes the headline "Spent" + "% used" + cost-per-ticket understated on **every brand_campaign event with multi-platform spend**, not just BB26-KAYODE. Quiet, persistent reporting bug.

## FIX

1. **Rename + correct the helper.** In `components/share/venue-full-report.tsx`:
   - Rename `sumLifetimeMetaSpend` → `sumLifetimePaidMediaSpend` so the name matches the contract (paid media = Meta + TikTok + Google Ads, per the `paidSpendOf` JSDoc).
   - Pass real values: `tiktok_spend: row.tiktok_spend, google_ads_spend: row.google_ads_spend`. Keep the existing allocator/presale logic for the Meta column; only TikTok + Google get added.
   - Update the call site at line 602 to the new name.

2. **No call-site logic change beyond the rename.** `paidMediaSpent` already flows correctly into `percentUsed`, `costPerTicket`, and the Performance Summary card — fixing the source closes all three downstream symptoms.

3. **Type check** the `DailyRollupRow` type used by `rollups` to confirm it carries `tiktok_spend` and `google_ads_spend` (it does — `event_daily_rollups` schema, migrations 057 and 064). If TS strict complains about the optional google_ads_spend, default to `null` rather than omitting.

## NEW HELPER (illustrative — match existing style)

```ts
function sumLifetimePaidMediaSpend(
  rollups: DailyRollupRow[],
  isMultiEventVenue: boolean,
): number {
  let total = 0;
  for (const row of rollups) {
    const hasAllocatedSpend =
      row.ad_spend_allocated != null || row.ad_spend_presale != null;
    const metaSpendForRow = hasAllocatedSpend
      ? (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0)
      : isMultiEventVenue
        ? null
        : row.ad_spend;
    total += paidSpendOf({
      ad_spend: metaSpendForRow,
      tiktok_spend: row.tiktok_spend,
      google_ads_spend: row.google_ads_spend ?? null,
    });
  }
  return total;
}
```

## VALIDATION

```bash
npx tsc --noEmit
npx eslint components/share/ lib/dashboard/
node --experimental-strip-types --test 'components/share/__tests__/*.test.ts' 'lib/dashboard/__tests__/*.test.ts'
npm run build
```

Tests — co-located beside `venue-full-report.tsx` if a __tests__ dir exists, or under `lib/dashboard/__tests__/`:

- **The headline bug:** rollups with Meta £100 + TikTok £160 + Google £140 (mirroring BB26-KAYODE) → `sumLifetimePaidMediaSpend` returns £400, not £100. Regression-protect this exact failure.
- Multi-event venue mode: when `isMultiEventVenue=true`, rows where the Meta allocator hasn't run yet (`ad_spend_allocated/_presale` both null) still contribute TikTok + Google spend — Meta column nulls don't suppress the other platforms.
- A row with only `ad_spend` set (Meta only, no TikTok/Google) sums Meta correctly — single-platform regression.
- A row with `google_ads_spend` undefined (older event) doesn't NaN.

## NON-NEGOTIABLES

- Branch: exactly `creator/share-paid-media-cross-platform`
- Rename the helper — the old name was the trap. Don't leave it as `sumLifetimeMetaSpend` while it sums everything.
- Don't change `metaPaidSpendOf` or `paidSpendOf` — those are correct. The bug is one caller.
- Don't touch the Meta-tab MetaReportBlock (it deliberately keeps a Meta-only column elsewhere). This fix is the *cross-platform Performance Summary card only*.

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-share-paid-media-cross-platform.md`. PR title: `fix(share): aggregate Paid media Spent across Meta + TikTok + Google Ads`. Note: confirmed live on BB26-KAYODE share, applies to all brand_campaign events.

## AFTER MERGE

BB26-KAYODE share immediately shows "Paid media: £480 Allocated · £477 Spent (99%)" instead of £177. Worth re-checking the 4theFans dashboard headlines too — same helper is the source for those Performance Summary cards.
