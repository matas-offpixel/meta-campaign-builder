# Meta Independence & Snapshot Architecture — Research (2026-04-23)

## TL;DR recommendation

**Build snapshot-first in-house on the foundation you already have. Do NOT add Supermetrics / Funnel / Airbyte / BigQuery yet.** The app is already 60% of the way there — `share_insight_snapshots` (migration 036), `event_daily_rollups` (migration 039), and `rollup-sync-runner.ts` exist; the only reason share reports still hit Meta live is that active-creatives caching is a 5-minute TTL piggybacked on render, not a pre-populated cache. Flip it.

**Concretely, the next two weeks of work:**

1. Add an `active_creatives_snapshots` table (one row per `(event_id, date_preset)`, payload jsonb, `fetched_at`, `expires_at`, `is_stale` flag) and a new cron `/api/cron/refresh-active-creatives` that walks the same eligible-events set `rollup-sync-events` already walks. Schedule every 6 hours on the Vercel cron that already exists; tighten to every 2h for events inside the 14-day-to-show window.
2. Flip `app/share/report/[token]/page.tsx` from "read Meta live on cache miss" to "read the snapshot table; on a miss, serve last-good + `is_stale=true` banner; trigger a background refresh but never block the render." The Suspense streaming path survives — the promise now reads from Postgres, not Graph.

**What this buys:** share-report p95 drops from 10–30s to <1s (Postgres read vs Meta fan-out). Meta call volume collapses from "one fan-out per unique visitor per 5 minutes per timeframe" to "one fan-out per event per cron tick." 80004 cascades stop because concurrency is now bounded by the cron, not by viewer traffic. Lambda 800s timeouts become impossible on the share path. Clients always see a number (possibly 6h old) rather than a banner.

**What it costs:** ~3–5 days of Sarah-led dev work on the cron + table + stale-while-revalidate wiring. Zero new SaaS. Zero new infrastructure. Postgres row cost for snapshots is negligible (~5 clients × 10 events × 9 presets × 50KB ≈ 22 MB).

**Why not warehouse/ELT now:** Supermetrics starts at $99/mo for a single account, Funnel at €399/mo, and their value is historical analytics across ad platforms — which isn't your bottleneck. BigQuery + Airbyte is the right move *later* (dashboard strategy layer, cross-event cohort analysis) once there's analytics load to justify it. Today the bottleneck is a single API hotspot on one route; fix that route first. Sarah's BigQuery skills become load-bearing when you bolt the strategy layer on top, not for the share-report incident.

## Current state (verified)

Confirmed by inspecting the repo:

- `app/share/report/[token]/page.tsx` is `dynamic = "force-dynamic"`. The Supabase cache (`share_insight_snapshots`) is read-through from the render path itself — on a miss, the RSC blocks on `fetchEventInsights` and returns a deferred promise for `fetchShareActiveCreatives`, which the page Suspense-streams. Cache write happens after both halves resolve (`resolveReportData` → `.then` → `writeShareSnapshot`). TTL is 5 min (`SHARE_SNAPSHOT_TTL_MS` in `lib/db/share-snapshots.ts`).
- `lib/reporting/active-creatives-fetch.ts`: slim account-level `/ads` (limit=500, safety=12 pages) followed by batched `/?ids=` hydration. `CREATIVE_BATCH_SIZE = 25` (halved from 50), `AD_INSIGHT_CHUNK_CONCURRENCY = 1`, `CAMPAIGN_CONCURRENCY = 3`. Any of these three knobs being wrong is what produced the rate-cascade fingerprint in MEMORY.
- `lib/meta/client.ts`: retry policy split — `TRANSIENT_META_CODES = {1}` gets 4 retries with 500/1500/4000/8000/12000ms backoff; `RATE_LIMIT_META_CODES = {2,4,17,32,341,613}` gets 1 retry at 10s. PR #81.
- Crons in `vercel.json`:
  - `/api/cron/sync-ticketing` — `0 3 * * *` (daily)
  - `/api/cron/refresh-creative-insights` — `0 */2 * * *` (every 2h, heatmap cache)
  - `/api/cron/rollup-sync-events` — `30 */6 * * *` (every 6h, event_daily_rollups)
- `rollup-sync-events` cron already walks `(ticketing-linked events ∩ general_sale_at within ±60 days)` and calls `runRollupSyncForEvent` per event. Meta leg + Eventbrite leg run per event with isolated try/catch. **This is exactly the loop shape the active-creatives refresh needs.**
- `event_daily_rollups` (migration 039) stores daily per-event `(ad_spend, link_clicks, tickets_sold, revenue, source_meta_at, source_eventbrite_at)`. Unique `(event_id, date)`. Populated only by `rollup-sync-runner.ts`.
- `share_insight_snapshots` (migration 036) stores `(share_token, date_preset, custom_since, custom_until)` → `payload jsonb` with 5-min TTL. Unique on the quad (migration 037 made it `NULLS NOT DISTINCT`). Read via `readShareSnapshot`, written via `writeShareSnapshot`. Service-role only; RLS `false` as a defensive backstop.
- Vercel Pro: `maxDuration = 800` set on the cron and on the share page's route handler. No way to go higher.

**Where the pain actually is (measured, not assumed):**

- The pain is *not* "we read Meta too much in aggregate" — it's "the share page is a user-triggered fan-out on a cold cache." Five open share-report tabs across four timeframes = 20 simultaneous account-scoped Meta calls, each doing a multi-page `/ads` sweep and a batched `/?ids=` hydration. That's the 80004 cascade.
- The 2-hourly creative-insights cron and the 6-hourly rollup cron already run without triggering 80004 — serialised per account, 10s inter-account spacing. **Snapshot-first would move share rendering onto the same cron posture instead of VIP traffic.**
- Clients with 300+ active creatives per event amplify every dimension: more ads in `/ads`, more hydration batches, more per-ad insights calls. The only known control is fewer, less frequent Meta calls — which is what snapshotting is.

## Option 1: Snapshot-first in-house (RECOMMENDED)

### Architecture

New table:

```sql
-- migration 041_active_creatives_snapshots.sql
create table if not exists active_creatives_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  date_preset        text not null,
  custom_since       date,
  custom_until       date,
  payload            jsonb not null,  -- ShareActiveCreativesResult
  fetched_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  last_refresh_error text,
  is_stale           boolean not null default false,
  unique (event_id, date_preset, custom_since, custom_until)
);
create index acs_event_preset_idx on active_creatives_snapshots
  (event_id, date_preset, expires_at desc);
```

**Note:** key this by `event_id` (not `share_token`) — the same underlying event can be surfaced by multiple share tokens (owner copy + client copy) and by the internal dashboard; share keying doubles the row count and halves cache utility.

New cron: `/api/cron/refresh-active-creatives`, scheduled `15 */6 * * *` in `vercel.json` (offset from rollup-sync to avoid account contention). Walks the same eligibility query `rollup-sync-events` uses. For each event × preset combination (limit to presets actually used — `maximum`, `last_7d`, `last_14d`, `last_30d` cover ≥95% of views; skip `today`/`yesterday` since those are cheap to compute live from `event_daily_rollups` when needed), call the existing `fetchShareActiveCreatives` and upsert.

Inside 14 days of show date, a per-event cadence bump (every 2h) — read `events.general_sale_at` / `event_date`, branch on distance. Mirrors the "daily vs weekly vs archived" cadence split already in MEMORY.

### Share-page change

`resolveReportData` in `app/share/report/[token]/page.tsx`:

- Replace `readShareSnapshot` + deferred-live-Meta pattern with `readActiveCreativesSnapshot(event_id, datePreset, customRange)`.
- On hit → render immediately, no Suspense boundary needed.
- On miss → return last-good snapshot (ignore `expires_at`) with `is_stale: true`; fire-and-forget a `/api/internal/refresh-snapshot?event_id=…&preset=…` POST that's idempotent and non-blocking. Do NOT call Meta from the render path at all.
- On zero rows ever written (brand-new event) → fall back to current live-fetch path, but cap the Suspense timeout at 20s and then show a friendly "Numbers warming up — refresh in a minute" placeholder rather than ReportUnavailable.
- Add a subtle stale banner: *"Data as of 4 hours ago · [Refresh]"* with the Refresh button hitting the same internal route that the cron does.

Delete the 5-minute TTL gating — the new table is the source of truth; TTL is advisory for the background refresher, not a cache-bust for readers.

### Engineering cost

- 1 migration (new table). 2h incl. review.
- 1 new cron route. ~0.5 day — copy-paste `rollup-sync-events` structure, swap the runner.
- New reader module `lib/db/active-creatives-snapshots.ts` mirroring `share-snapshots.ts`. 0.5 day.
- Share page refactor. 1 day (the tricky bit is the stale-while-revalidate + background refresh trigger).
- Internal refresh route (POST `/api/internal/refresh-active-creatives`). 0.5 day. Must be CRON_SECRET-gated OR owner-session-gated; idempotent via row-level `is_stale` flag so concurrent share-page loads don't self-DDoS.
- Backfill cron run to warm the table. 0.5 day monitoring.

**Total: 3–5 days of focused Sarah-led work.** Mirrors the PR #67 two-phase refactor she's already shipped.

### Cost

- Vercel: one extra cron execution per 6h × ~60 events × ~4 presets = 240 calls per day (vs ~5 per share-report-viewer-minute today). **Lower aggregate Meta volume.**
- Supabase: 22 MB estimate for 5 clients. Free-tier.
- Zero SaaS fees.

### Time-to-ship

~1 week including PR review and backfill.

### Pros

- Reuses `share_insight_snapshots` pattern and `rollup-sync-runner` scaffolding — no new architecture, just more of what already works.
- Eliminates the 80004 cascade root cause: share traffic no longer maps to Meta calls.
- Clients see numbers, not banners. Stale > unavailable every time.
- Sarah can own it end-to-end; no platform-migration risk.

### Cons

- Doesn't help with the heatmap / Active Creatives dashboard view (those already have their own cron — `refresh-creative-insights`). Scoped fix.
- "Snapshot as of 4h ago" is a minor positioning change vs the current "live!" framing. Worth an email to top clients; most won't notice.
- Still dependent on Meta — just not on user-viewing-the-page time. If Meta is down, the last snapshot keeps serving, which is strictly better than today.

## Option 2: Third-party ELT (Supermetrics / Funnel.io / Airbyte / Fivetran)

### Tools compared (verified on 2026-04-23)

| Tool | Entry price / mo | Meta Ads destination | Supabase/Postgres destination | Fit |
|------|------------------|---------------------|------------------------------|-----|
| **Supermetrics** (supermetrics.com/pricing) | $99 "Essential" for single Meta account + Sheets/Looker; Warehouse SKU starts ~$349/mo per account for BigQuery/Snowflake | Yes | BigQuery, Snowflake, Redshift, S3. NO native Supabase. | Poor — priced per account, 10 clients = $1k+/mo before you've shipped anything |
| **Funnel.io** (funnel.io/pricing) | From €399/mo "Starter"; per-source rows drive cost | Yes, strong | BigQuery, Snowflake, Redshift. No direct Postgres. | Overkill — built for marketing mix modelling across 500+ connectors |
| **Improvado** | Custom only; typical $20k+/year floor (G2 buyer reports) | Yes | BigQuery primarily | Not at this scale |
| **Windsor.ai** (windsor.ai/pricing) | $23/mo per connector, $95/mo for 5 connectors | Yes | Postgres (direct), BigQuery, Sheets | Cheapest option; schema you don't control |
| **Fivetran** (fivetran.com/pricing) | $500/mo starter free-tier-adjacent, then consumption-based MAR (monthly active rows); Meta Ads source is certified | Yes | Postgres (incl. Supabase) | MAR pricing punishes row-heavy sources like Meta insights — budget blows at scale |
| **Airbyte Cloud** (airbyte.com/pricing) | Pay-as-you-go from ~$2.50 per credit; Meta Ads source costs ~$10/mo per 100k rows for typical ad-insights use | Yes | Postgres/Supabase direct (native connector) | Best-in-class price-to-function; self-host OSS version drops it to infra cost |
| **Stitch** (stitchdata.com/pricing) | $100/mo "Standard" 5M rows; Talend-owned, maintenance mode | Yes | Postgres, BigQuery | Stagnant; no reason to pick over Airbyte |
| **Rudderstack** | CDP-first, not great for ad-insights sync | — | — | Wrong tool |

### The winner if you did pick one: Airbyte Cloud (native Meta Ads → Supabase Postgres)

- Airbyte has a [Facebook Marketing source](https://docs.airbyte.com/integrations/sources/facebook-marketing) that supports `ads_insights`, `ads_insights_age_and_gender`, `ads_insights_country`, etc., with incremental sync on `date_start`.
- Native Postgres destination writes directly into the same Supabase instance you already run.
- Cost at scale: ~$50–150/mo for 5–10 ad accounts at daily sync granularity.
- Self-host route: Airbyte OSS on a $10/mo Hetzner VM or as a Supabase Edge function schedule wrapper — zero recurring SaaS.

### Why it's still the wrong answer right now

- **It doesn't solve the creative hydration problem.** Airbyte's `ads_insights` gives you numbers; the share page's active-creatives section needs `thumbnail_url`, `effective_object_story_id`, `image_hash`, and the `/?ids=` batch hydration dance — all of which is creative-object metadata, not insights. You'd still run your own Meta fetch for creatives.
- **It adds a second source of truth.** Today the app is Meta-live. Adding Airbyte adds an eventual-consistency lag (typically 6–24h for Meta ad insights through ELT — Meta's own attribution updates lag 1–3 days anyway). You'd need to reconcile.
- **Bootstrap time is longer than snapshot-first.** Schema design + backfill + QA + production cut-over is a 2–3 week project minimum, not 3–5 days.
- **It's ELT without a data warehouse.** You'd land Airbyte rows into Supabase, but Supabase Postgres is OLTP — running the kind of aggregations BI users want from `ads_insights` hurts the same database your share page reads from. Either this turns into "Option 3 with extra steps" or it's stuck at the same scale constraints you have today.

### When ELT becomes right

When you want cross-client / cross-event analytics, creative-fatigue scoring across a 12-month window, or self-serve BI dashboards for clients. That's the strategy layer from MEMORY, not the share-report incident. See Option 3.

## Option 3: BigQuery warehouse (Sarah-led, future)

### Evaluation

This is the right *eventual* shape. Sarah's 4 GCP certifications make this a natural fit, and the MEMORY note on the dashboard strategy layer ("must learn from past event data, not just organise campaigns") points directly at an OLAP warehouse as the substrate for cohort analysis, benchmark computation, and creative-health backtesting across events.

### 6-month TCO at your scale (~5-10 clients, 300+ creatives/client, 60-day retention on ad insights)

- **Airbyte Cloud Meta → BigQuery**: $50–150/mo. Let's call it $100.
- **BigQuery storage**: 10 clients × ~500k rows ad_insights/month × 12 months hot = ~60M rows ≈ 12 GB active storage. Active storage is [$0.02/GB/month](https://cloud.google.com/bigquery/pricing#storage) ≈ $0.24/mo. Negligible.
- **BigQuery compute**: On-demand $6.25/TB scanned ([pricing](https://cloud.google.com/bigquery/pricing#analysis_pricing_models)). A well-partitioned `ads_insights` table for share-report reads = <1 GB scanned per query. 1000 share-report loads/day × 30 days × <1 GB = <30 GB/month. **<$1/mo.** First 1 TB/month is free anyway.
- **Engineering**: ~3–4 weeks Sarah-led (warehouse schema, dbt models, thin Next.js API layer that queries BQ via service-account-authenticated handler, testing, cutover).

**TCO: ~$110/mo SaaS + existing Supabase + 3–4 weeks one-time build.**

### What it unlocks beyond fixing timeouts

- Cross-event benchmarks (cost-per-ticket trend across all 4TheFans shows last 6 months)
- Cohort analysis (first-week-spend vs final-attendance conversion curves)
- Creative fatigue scoring with proper 30-day windows (today the health badge is two-axis; BQ would let you add longitudinal decay curves)
- The strategy-layer dashboard Matt wants
- Audit trail (`ads_insights` snapshots are immutable in BQ; easy to answer "what did this campaign look like 3 weeks ago")
- Decoupling Supabase from analytics load — OLTP stays fast

### Why NOT to do this first

- **It's 5× the work of snapshot-first and solves the same acute problem with more moving parts.** Acute fix first; strategic fix second.
- **It adds a cross-cloud dependency on the critical share-report path** (Supabase auth, BQ reads). Every new ingress point is a new failure mode. Build BQ as the analytics plane, not the share-report plane.
- **It requires stable production data** to model against. You're still changing active-creatives schema monthly; freezing a BQ schema right now means rework in 2 months.

### Right separation of concerns (target, 6 months out)

- **Supabase (OLTP)**: auth, drafts, clients, events, share tokens, ticketing links, creative_templates, user settings — everything that mutates transactionally.
- **Supabase Postgres (cache)**: `share_insight_snapshots`, `active_creatives_snapshots`, `event_daily_rollups` — materialised views of Meta data for the hot read path.
- **BigQuery (OLAP)**: full `ads_insights` history, audit log of snapshots, benchmark tables, cohort aggregates. Queried by a thin Next.js `/api/analytics/*` surface, never from render path.

### Practical blockers for an immediate BQ move

- The `/share/report/[token]/page.tsx` render path isn't coupled to Supabase in a way that blocks swapping to BQ — but it IS coupled to `EventInsightsPayload` and `ShareActiveCreativesResult` shapes. Those are the contracts you'd re-implement as BQ queries. Doable but high-churn.
- No service-account auth wired to the Vercel deploy for BQ yet. Half a day.
- No dbt or equivalent pipeline. Airbyte raw → dbt-transformed tables is the standard pattern — add ~1 week.

## Recommendation (detailed)

**Ship Option 1 in the next 2 weeks. Defer Option 3 to Q3.**

The incident signature is very specific: user-triggered Meta fan-outs on a cold cache, amplified by multi-timeframe tab behaviour and high-creative-count events. The fix that matches the signature is: **don't fan out from render paths.** That's snapshot-first. Every other option (ELT, warehouse) also includes that fix plus additional architecture. Ship the fix, then add architecture when the business case (strategy layer, benchmarks) justifies it.

Option 1 is small enough that Sarah can ship it alongside her other work in the current sprint. It reuses three already-shipped foundations (`share_insight_snapshots`, `event_daily_rollups`, `rollup-sync-runner`) so there's no "introducing a new concept" tax. And it leaves Option 3 undamaged — the `active_creatives_snapshots` table becomes a natural staging surface to compare against a future BQ-sourced equivalent.

**Concrete next step (one Cursor prompt):** a PR that adds migration 041 + `lib/db/active-creatives-snapshots.ts` + `/api/cron/refresh-active-creatives` + `/api/internal/refresh-active-creatives` + share-page rewire + backfill script. Scope it tightly; the blast radius is one route and one cron.

**Second concrete step (separate PR):** once the cron has 48h of clean runs, delete the `deferredCreatives` Suspense path from `app/share/report/[token]/page.tsx` entirely. It's dead weight once the cache is the source of truth. Every line of live-Meta-fetch code removed from the render path is risk removed.

## Appendix: things to NOT do

- **Do NOT raise Vercel function budget.** You're on Pro at 800s max. There's no higher tier short of Enterprise, and the problem is fan-out concurrency, not per-call duration. Raising the ceiling just lets the ceiling be hit harder.
- **Do NOT use Meta's async insights (`insights_async` / async report runs).** Async jobs avoid the synchronous rate budget but have their own job-concurrency limits (~5 running per account) AND take 1–10 minutes to complete. They're designed for "pull last quarter's full breakdown nightly", not for a share-page render. You'd trade fast-failure for slow-failure.
- **Do NOT bump `CREATIVE_BATCH_SIZE` back to 50.** It was halved for Meta's "reduce the amount of data" cap and the fix is real. Snapshot-first makes this knob irrelevant — cron time isn't user-facing latency.
- **Do NOT bump `AD_INSIGHT_CHUNK_CONCURRENCY` above 1.** The MEMORY note on rate cascade is correct; parallel per-ad insights is what created PR #52.
- **Do NOT try to cache Meta CDN thumbnail URLs beyond mirroring into Supabase Storage.** Meta rotates those URLs aggressively (~24h). The share-snapshot TTL was partly protecting against this; the new table inherits the same semantics. Mirroring images into Supabase Storage is a separate PR and a separate budget; plan for it but don't couple.
- **Do NOT add Supermetrics as an interim measure.** Per-account pricing at 10+ clients = $1k+/mo recurring, and it doesn't solve the creative-hydration problem. The only scenario where Supermetrics is right is "client wants a Google Sheet of ad data" — which isn't the ask.
- **Do NOT build a BigQuery integration for the share-report path in the same PR as the cache.** Two independent changes to the hot path = bisect hell. Snapshot-first ships clean; BQ slots in alongside later.
- **Do NOT key the new snapshot table by `share_token`.** Multiple share tokens can exist per event (owner preview + client preview + internal reviews); keying by share token doubles row count and halves cache hit rate. Key by `event_id`.
- **Do NOT delete `share_insight_snapshots`.** It still has value as the headline-metrics cache — just stop piggybacking active-creatives onto it. The two payloads have different refresh cadences and different stale tolerance.
- **Do NOT migrate to Snowflake.** GCP/BigQuery aligns with Sarah's certifications; Snowflake doesn't. Alignment here is a real cost-saver, not a preference.
- **Do NOT couple this work to the Facebook reconnect token bug.** Per MEMORY, that fix is being done in Cursor and the callback files are off-limits. The snapshot path uses the already-resolved owner token from `getOwnerFacebookToken`, so there's no overlap.
