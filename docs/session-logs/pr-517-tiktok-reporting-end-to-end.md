# PR pending — fix(tiktok): complete reporting integration

Branch: `cursor/tiktok-reporting-end-to-end`
PR: [#517](https://github.com/matas-offpixel/meta-campaign-builder/pull/517)
Date: 2026-06-03

---

## Phase 1 — Investigation report

All findings below are **empirical**: verified against the production
Supabase project (`zbtldbfjbhfvpksmdvnt`) and by calling the live TikTok
Business API for the Ironworks advertiser (`7639802149165301776`,
account `15e11c2d-…`, event `68535c85-…`, code `IRWOHD`).

### Phase 1 question answers

| # | Question | Answer |
|---|----------|--------|
| A | `event_daily_rollups.tiktok_engagement_results` column exists in prod? | **YES** — `integer`, added by migration 103. |
| B | `/api/cron/tiktok-breakdowns` scheduled in `vercel.json`? | **YES** — `45 6,10,14,18,22 * * *`. |
| C | `/api/cron/tiktok-active-creatives` scheduled in `vercel.json`? | **YES** — `30 6,10,14,18,22 * * *`. |
| D | What does `tiktok-breakdowns` return for IRWOHD? | `ok:false, rows:0, wroteSnapshot:false, error:"Invalid value for dimensions: province_id is not supported."` — **same error for all 8 events**. |
| E | What does `tiktok-active-creatives` return for IRWOHD? | `ok:false, rows:0, wroteSnapshot:false, error:"fields.6 … not acceptable … error is thumbnail_url"` — **same error for all 8 events**. |

So both crons **are scheduled and do fire** — they fail inside the fetch and
the snapshot writers correctly refuse to overwrite last-good on `kind:"error"`,
leaving both tables empty (0 rows platform-wide, confirmed via SQL).

### Production data state (IRWOHD)

- `event_daily_rollups`: 10 rows, `tiktok_spend=£1086.06`, `tiktok_results=191`,
  **`tiktok_engagement_results=0`**, `tiktok_impressions=537707`,
  last sync `2026-06-03 00:15`.
- `tiktok_breakdown_snapshots`: **0 rows** (0 platform-wide).
- `tiktok_active_creatives_snapshots`: **0 rows** (0 platform-wide).

### Schemas / unique constraints (match the writers' `onConflict`)

- `tiktok_breakdown_snapshots` UNIQUE `(event_id, dimension, dimension_value, window_since, window_until)`.
- `tiktok_active_creatives_snapshots` UNIQUE `(event_id, ad_id, window_since, window_until)`.

The upsert conflict targets are correct. Writes were never the problem — the
**fetch throws before the write is reached**.

---

### Problem 2 — `tiktok_breakdown_snapshots` empty → ROOT CAUSE FOUND

`lib/tiktok/breakdowns.ts` calls `/report/integrated/get/` with
**`report_type: "BASIC"`**. Live probe of the IRWOHD advertiser:

| dimension | `report_type:BASIC` | `report_type:AUDIENCE` |
|-----------|----------|-------------|
| `country_code` | OK | OK |
| `province_id` (region) | **FAIL** "not supported" | **OK (18 rows)** |
| `city_id` (city) | FAIL | **FAIL** "not supported" |
| `age` | **FAIL** | OK |
| `gender` | **FAIL** | OK |
| `age`+`gender` | **FAIL** | OK |
| `interest_category` | **FAIL** | OK |

Two compounding bugs:
1. **Wrong `report_type`.** Audience/geo/interest breakdowns require
   `report_type:"AUDIENCE"`. With `BASIC`, only `country_code` is valid.
2. **No per-dimension error isolation.** `fetchTikTokBreakdowns` loops
   dimensions in one try block; `country` succeeds first, then `region`
   throws and discards the entire accumulated result (incl. country).
3. `city_id` is unsupported even under `AUDIENCE` → must be dropped.

The metric list works fine under `AUDIENCE` (sample rows return
spend/impressions/reach/clicks/ctr/video_* correctly), and the breakdown
table has **no results/engagement column**, so the "goal-blind metrics"
hypothesis from the brief does **not** apply to this table — the real
blocker is `report_type` + dimension validity.

**Fix:** switch breakdown calls to `report_type:"AUDIENCE"`, drop `city`,
wrap each dimension in its own try/catch so one unsupported dimension never
discards the others.

---

### Problem 3 — `tiktok_active_creatives_snapshots` empty → ROOT CAUSE FOUND

`lib/tiktok/share-render.ts` `fetchAllAds()` requests `AD_FIELDS` from
`/ad/get/` including **`thumbnail_url`** (index 6) and **`preview_url`** —
neither is a valid `/v1.3/ad/get/` field. TikTok rejects the whole call:
`fields.6 … error is thumbnail_url`. The throw bubbles up → cron writes
`kind:"error"` → 0 rows. (Same invalid-field class as PR #511.)

Live probe confirms `/ad/get/` succeeds with the corrected field set
(`ad_id, ad_name, campaign_id, campaign_name, operation_status,
secondary_status, ad_text, video_id, image_ids, landing_page_url`), and
video thumbnails are recoverable via `/file/video/ad/info/`
(`video_cover_url` / `preview_url`).

**Fix:** drop `thumbnail_url`/`preview_url` from `AD_FIELDS`; add
`video_id`/`image_ids`; resolve thumbnail + deeplink from
`/file/video/ad/info/` (best-effort), falling back to `landing_page_url`.
This function also powers live share rendering, so the TikTok Active
Creatives section has **never** rendered for any event — this fix unblocks
both the cron and the live render.

---

### Problem 1 — `tiktok_engagement_results = 0` → THE BRIEF'S PREMISE IS WRONG

The code path is **correct**: `resolveRollupCountsFromMetrics` →
per-day aggregation (`rollup-insights.ts`) → `runTikTokRollupLeg` (passes
rows untouched) → `upsertTikTokRollups` (SET clause includes
`tiktok_engagement_results`). The column exists. The cron ran today.

The brief assumed `tiktok_engagement_results` should hold **488,868
view_content events**. Live API truth for the 3 IRWOHD campaigns:

| campaign | objective_type | adgroup optimization_goal | conversion | **view_content** | impressions | follows |
|----------|------|-----|-----------|--------------|-------------|---------|
| `[IRWOHD] VENUE SIGNUP` | LEAD_GENERATION | CONVERT | 109 | **0** | 278,491 | 116 |
| `[IRWOHD] VENUE SIGNUP` | LEAD_GENERATION | CONVERT | 65 | **0** | 208,354 | 73 |
| `[IRWOHD] VENUE ENGAGEMENT` | ENGAGEMENT | FOLLOWERS | 0 | **0** | 2,452 | 257 |

Findings:
1. **`view_content` is genuinely `0`** for every IRWOHD campaign. The code
   correctly reads it; there is simply nothing to read. So
   `engagement_results` being 0 is *correct given the current metric mapping*.
2. The brief's "488,868 view_content" ≈ **total impressions** (489,297) — a
   misread of the Ads Manager impressions column, not a conversion event.
3. **`optimization_goal` is never returned by `/campaign/get/`** — it is an
   **ad-group** field. `/campaign/get/` returns `objective_type`. Every
   goal-aware code path that keys off campaign `optimization_goal`
   (rollup-insights, insights) therefore always falls through to the
   `view_content` fallback. This is a latent architecture bug, not specific
   to IRWOHD.
4. `complete_registration` is an **invalid metric** for this advertiser
   (no registration-objective campaigns); requesting it 400s the call.
   Valid: `conversion`, `view_content`, `real_time_conversion`,
   `total_purchase`, `purchase`, `form`, `on_web_order`, `follows`,
   `engagements`, `profile_visits`, `total_landing_page_view`, …

**Consequence:** there is no surgical "make view_content flow" fix — the
value is 0. A correct fix must (a) classify campaigns by `objective_type`
(reliably returned) rather than the always-undefined campaign
`optimization_goal`, and (b) choose what "engagement results" means for an
ENGAGEMENT-objective campaign. The IRWOHD ENGAGEMENT campaign optimises
FOLLOWERS, so its real headline result is **follows = 257** (alt:
`engagements = 462`). **This is a product decision and is surfaced to the
owner before implementing — the brief's acceptance fixture (488k) cannot be
satisfied because it does not exist in the data.**

---

## Phase 2 — fixes (this PR)

- **Problem 2** — breakdowns: `report_type:"AUDIENCE"`, drop `city`,
  per-dimension error isolation. *(implemented)*
- **Problem 3** — active creatives: valid `AD_FIELDS` + thumbnail/deeplink
  via `/file/video/ad/info/`. *(implemented)*
- **Problem 1** — engagement results: **blocked on owner metric decision**
  (follows vs engagements vs leave conversion-only). Documented above.
