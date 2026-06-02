# Cursor prompt [Cursor, Sonnet] — TikTok hybrid resolver must surface reach + 2s/6s video views + post-engagement + avg-play-time

Copy this entire block into Cursor as a single message. Sonnet — targeted field-mapping fix across two functions in one file + a regression test.

PREREQUISITE: PR #460 merged.

---

## BUG (confirmed live)

On the BB26-KAYODE share TikTok block (https://app.offpixel.co.uk/share/report/Rul8DeLZBVTZ0kZr), the following metrics render as em-dashes despite the rollup having real data for them:

- **Reach** — em-dash. Rollup has 551,804 across the window.
- **Frequency** — em-dash. Derivable from impressions/reach.
- **Cost per 1000 reached** — em-dash. Derivable from spend/reach * 1000.
- **Video views (2s)** — em-dash. Rollup has 467,730.
- **Video views (6s)** — em-dash. Rollup has 301,644.
- **Avg play time / user** — em-dash. Rollup has tiktok_avg_play_time_ms.

The displayed metrics (Spend £160, Impressions 553k, Clicks 2,455, Video views 100% 4,969, CPM £0.29, CTR 0.44%) ARE present and correct — confirming the hybrid resolver path is otherwise wired correctly. The bug is field-mapping coverage, not the resolver itself.

## ROOT CAUSE

`app/share/report/[token]/page.tsx`. The TikTok hybrid resolver builds a synthetic campaign-totals block from `event_daily_rollups` for events with no manual xlsx import. Two functions in this file are conspiring:

**1.** `aggregateTikTokRollups` (line 1498-1531) only sums **4 columns**: `tiktok_spend`, `tiktok_impressions`, `tiktok_clicks`, `tiktok_video_views`. The rollup schema has 6+ more TikTok columns the aggregator ignores: `tiktok_reach`, `tiktok_video_views_2s`, `tiktok_video_views_6s`, `tiktok_avg_play_time_ms`, `tiktok_post_engagement`, `tiktok_results`.

**2.** `resolveTikTokHybridReport` (line 1284-1363) hard-codes nulls into the `campaign` object for the corresponding share fields:

```ts
reach: null,                          // line 1309
cost_per_1000_reached: null,          // line 1310
frequency: null,                      // line 1311
video_views_2s: null,                 // line 1328
video_views_6s: null,                 // line 1329
avg_play_time_per_user: null,         // line 1334
```

These two are the entire blast radius — UI side renders whatever the campaign object holds, so fixing the resolver source closes the em-dash.

## FIX

In `app/share/report/[token]/page.tsx`:

**Part A — extend `aggregateTikTokRollups`** to sum the missing columns. Return type gains:

```ts
reach: number;                  // sum tiktok_reach (sum-of-daily-reach over-counts; documented elsewhere as a conservative under-estimate for frequency — same caveat applies to Meta reach-sum, keep consistent)
videoViews2s: number;
videoViews6s: number;
postEngagement: number;          // sum tiktok_post_engagement, used downstream if needed
results: number;                 // sum tiktok_results
avgPlayTimeMsTotal: number;      // sum tiktok_avg_play_time_ms — see Part B for how this is averaged
avgPlayTimeMsRows: number;       // count of rows with non-null tiktok_avg_play_time_ms — denominator for the mean
```

Mirror the existing accumulator pattern. Skip null/zero exactly like the existing 4 fields do (`Number(row.tiktok_reach ?? 0)`).

**Part B — wire those into `resolveTikTokHybridReport`** at lines 1309-1334:

```ts
reach: liveTotals.reach,
cost_per_1000_reached:
  liveTotals.reach > 0
    ? (liveTotals.spend / liveTotals.reach) * 1000
    : null,
frequency:
  liveTotals.reach > 0
    ? liveTotals.impressions / liveTotals.reach
    : null,
// ...
video_views_2s: liveTotals.videoViews2s || null,
video_views_6s: liveTotals.videoViews6s || null,
// ...
avg_play_time_per_user:
  liveTotals.avgPlayTimeMsRows > 0
    ? liveTotals.avgPlayTimeMsTotal / liveTotals.avgPlayTimeMsRows
    : null,
```

Use `|| null` for the video-view fields so a window with all-zero rows still surfaces em-dash rather than "0" (matches existing convention for `video_views_p100` which goes through `liveTotals.videoViews100p` without the `|| null` — but that one's load-bearing because the UI renders 0 differently for "no data" vs "real zero"; defer to existing test fixtures if there's ambiguity).

For `avg_play_time_per_user`: the per-row column is `tiktok_avg_play_time_ms` (already in ms). Averaging across days is approximate (doesn't weight by impressions), but it matches what the Meta block does for frequency-derived metrics. Document this in a JSDoc.

## TYPES

`TikTokCampaignTotals` already has all six fields (`reach`, `frequency`, `cost_per_1000_reached`, `video_views_2s`, `video_views_6s`, `avg_play_time_per_user`) — they were just being null-fed. No type changes needed.

If TS complains about the new `liveTotals` return shape, expand the inline return type at line 1501 to include the new fields.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint app/share/report/
node --experimental-strip-types --test 'app/share/__tests__/*.test.ts'
npm run build
```

Tests — co-locate with existing share tests if a `__tests__` dir exists under `app/share/`, otherwise put them in `lib/share/__tests__/` extracting the aggregator function (extraction is encouraged — see [[feedback_helper_name_must_match_contract]] memory, the share path has too much private logic):

- **BB26-KAYODE regression:** rollup rows mirroring the live 22/23/24 May data (Spend £58.72/£61.28/£40, Reach 188k/216k/147k, vv2s 157k/185k/125k, vv6s 98k/121k/81k) → aggregator returns reach=551,804, vv2s=467,730, vv6s=301,644. Resolver then produces non-null frequency, cost_per_1000_reached, video_views_2s, video_views_6s.
- Single-day rollup with spend but null reach → resolver still surfaces spend; reach/frequency/cost_per_1000_reached fall back to null (don't divide by zero).
- All-zero TikTok rollups → resolver returns null for video_views_2s/6s (not "0").
- avg_play_time across multiple days averages by rows-with-data, not by total day count.

## NON-NEGOTIABLES

- Branch: exactly `creator/tiktok-hybrid-resolver-field-coverage`
- Don't touch the manual-import path (`resolveTikTokReportBlock` line 1412-1421) — manual XLSX imports remain authoritative for those breakdowns per the existing comment in the resolver.
- Don't change `geo`, `demographics`, `interests` or `ads` — those are still snapshot-sourced from `tiktok_active_creatives_snapshots`. This fix is campaign-totals only.
- Reach is sum-of-daily-reach (over-counts users active across multiple days). Match the existing Meta reach-sum convention rather than building a deduplication step — that's a bigger architectural change. The "(sum)" label on the Meta block applies here too once the field renders.
- Extract `aggregateTikTokRollups` to `lib/share/tiktok-aggregator.ts` if the test setup needs it isolated. Smaller refactor is fine if not strictly necessary.

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-tiktok-hybrid-resolver-field-coverage.md`. PR title: `feat(share): surface reach + 2s/6s/avg-play-time on hybrid TikTok block`. Note: BB26-KAYODE the test fixture.

## AFTER MERGE

BB26-KAYODE share TikTok block fills in: Reach 551,804 · Frequency ~1.00 · Cost per 1000 reached £0.29 · Video views (2s) 467,730 · Video views (6s) 301,644 · Avg play time/user ~9ms. Em-dashes only remain on fields that genuinely aren't in the rollup yet (interactive addon etc.) — which is correct.

Worth a brief check after deploy: any other brand_campaign event with live TikTok rollup (Black Butter's other shows once they have TikTok activity) gets the same upgrade automatically.
