# Meta API Bottleneck Audit & Scaling Plan — 2026-05-08

**Trigger:** Audience Builder timing out on video-views fetch. Active Creatives dropping. Thumbnails missing. Already painful at 1 client, will be lethal at 3+ retainers (4thefans, Junction 2, Louder, BR).

**The hard constraint:** Meta's per-ad-account rate budget is roughly 200 calls/hour soft + a hard 80004 hourly lockout when crossed. Hitting it on one client cascades to every UI surface using that account. Multi-client = multi-budget but the *coordination* across our crons + UI is what's burning.

This doc is the diagnosis + the staged fix plan that lets us go from 1 → 5 retainers without the platform melting.

---

## 1. Where the time is actually going

### 1a. Crons run sequentially per event — biggest lever

Every Meta-hitting cron is `for (const event of events)` with no concurrency. Confirmed in:

- `app/api/cron/refresh-active-creatives/route.ts:242`
- `app/api/cron/rollup-sync-events/route.ts:178`
- `app/api/cron/refresh-creative-insights/route.ts:227`

**At today's scale (4tF only, ~5 active events per cycle):**
- refresh-active-creatives: 5 × ~30s = 2.5 min per sweep
- rollup-sync-events: 5 × ~10s = ~50s
- refresh-creative-insights: 5 × ~15s = ~75s

**At target scale (4tF + J2 + Louder + BR ≈ 50 active events):**
- refresh-active-creatives: 50 × 30s = 25 min — **blows past Vercel's 800s maxDuration ceiling**
- rollup-sync-events: 50 × 10s = 8 min
- refresh-creative-insights: 50 × 15s = 12.5 min

This is why we feel it now. We're already running 5 crons every 4 hours, all of them stacking against Meta's per-account budget.

### 1b. Cron schedule is currently 5×/day per surface

From `vercel.json`:

```
sync-ticketing            06,10,14,18,22 (5×)
refresh-creative-insights 06,10,14,18,22 (5×) +10min offset
rollup-sync-events        06,10,14,18,22 (5×) +15min offset
refresh-active-creatives  06,10,14,18,22 (5×) +30min offset
scan-enhancement-flags    every 6h
tiktok-active-creatives   06,10,14,18,22 (5×)
tiktok-breakdowns         06,10,14,18,22 (5×) +45min offset
```

Each Meta cron makes 1 token-extend + N events × M API calls. At 5 events × ~30 calls/event × 5×/day = ~750 cron-driven Meta calls/day per ad account. Not catastrophic alone, but stacks with UI calls + audience builder fetches.

**Verdict:** 5×/day was right when there was 1 client and we hadn't snapshotted yet. Now that snapshots are the source-of-truth and Joe checks the dashboard maybe 6-8 times/day in show-week, the cron cadence can drop to 3×/day for non-show-week events without losing UX. Show-week events (within 7 days of `event_date`) keep tighter cadence.

### 1c. Audience Builder video-views fetch is naturally heavy

`fetchAudienceCampaignVideos` in `lib/audiences/sources.ts:253`:

1. Get campaign (1 call)
2. Page through ads (up to 50 pages × 100 ads = 5000 ads — needed for J2 Fragrance with ~300 ads)
3. Per unique video: 1 video metadata call + sometimes a thumbnail fallback call
4. Concurrency capped at 5 video calls in parallel

For a 200-video campaign that's ~5 ad pages + 200 video calls / 5 = 40 sequential rounds. At ~500ms/round = 20s minimum. Meta latency variance pushes that to 30-40s frequently. **Vercel function default is 10s. The route doesn't declare `maxDuration`** — that's the timeout the user is hitting.

The cache helps (30-min TTL, module-level Map) but it's per-worker — first hit on any cold serverless instance pays full freight.

### 1d. UI surfaces fan out per ad-account

The 4-layer rate-limit hardening pattern (memory: `project_meta_source_picker_rate_limit_pattern`) is good but only applied to source-picker. Other dashboard surfaces still cold-fetch:

- Active Creatives modal — reads snapshot ✅
- Patterns page — reads snapshot ✅
- Daily Spend Tracker — direct Meta call (intermittent 500s reported)
- Refresh Daily Budgets button — direct Meta call
- Audience Builder source picker — protected by 30-min cache + dedupe ✅
- Audience Builder video-views fetch — partially cached, no pre-warm

### 1e. Three crons stacked in 30-min window

Currently sync-ticketing → +10 → refresh-creative-insights → +15 → rollup-sync → +30 → refresh-active-creatives. They share zero coordination, three of them call Meta against the same ad accounts back-to-back. If one trips a 80004, the next two will too.

---

## 2. Diagnosis — what we're actually solving for

Three layered failure modes:

**Mode A: Vercel function timeout** (10-300s ceiling per route).
- Hits: Audience Builder video-views, Daily Spend Tracker on long campaigns.
- Fix: declare `maxDuration`, add timeout guards, return 207/206 partial responses.

**Mode B: Meta soft rate limit** (#4/#17/#80004 → forces 1-retry single-shot delay).
- Hits: cron sweeps when multiple events fan out within seconds.
- Fix: per-account semaphore, scheduled gaps, snapshot-first reads.

**Mode C: User-perceived stalls** (waiting for pages, modals, video lists to load).
- Hits: every UI surface that hits Meta directly on user click.
- Fix: precompute + cache + show stale-while-revalidate.

These are different problems with different fixes. Stop conflating them.

---

## 3. The plan — staged push, ~10 days

### Stage 1 — Stop the bleeding (this weekend, ~3 Cursor hours)

**PR-D: `perf/audience-builder-maxduration-and-precache`**
- Set `export const maxDuration = 60` on `/api/audiences/sources/campaign-videos` and `/api/audiences/sources/multi-campaign-videos`. (Vercel Pro allows up to 800s.)
- Add a "Refreshing video list…" skeleton state in the UI so users see progress instead of a spinner.
- Pre-warm the cache: when user opens Audience Builder for a client, fire-and-forget background fetch for top-3 most-recent campaigns' videos.
- Persist the cache to `audience_source_cache` table (mig 080). Module-level Map dies on cold start; DB cache survives.

**PR-E: `perf/cron-cadence-reduction`**
- Drop refresh-active-creatives + refresh-creative-insights + rollup-sync-events from 5×/day to 3×/day for non-show-week events: `0 6,12,18 * * *`.
- Add a "show-week" branch in eligibility runner: if `event_date` within 7 days, sweep at 5×/day cadence for that event only.
- Result: ~40% fewer Meta calls/day with no UX degradation outside show-week.

**PR-F: `perf/cron-stagger-extension`**
- Stretch the 3 stacked crons from 30-min window to 90-min window.
- 06:00 sync-ticketing → 06:30 refresh-creative-insights → 07:00 rollup-sync-events → 07:30 refresh-active-creatives.
- Spreads Meta calls across the hour; eases hourly-budget pressure.

### Stage 2 — Parallelise crons safely (next week, ~1 Cursor day)

**PR-G: `perf/cron-event-parallelism`**
- Replace sequential `for (const event of events)` with chunked parallelism:
  ```ts
  const EVENT_CONCURRENCY = 4; // tunable per cron
  for (let i = 0; i < events.length; i += EVENT_CONCURRENCY) {
    const chunk = events.slice(i, i + EVENT_CONCURRENCY);
    await Promise.all(chunk.map(e => processEvent(e)));
  }
  ```
- Concurrency = 4 means 50-event sweep drops from 25 min → 6 min for refresh-active-creatives.
- **Critical guardrail:** group events by `client.meta_ad_account_id` first, then process *each ad-account group sequentially* but events *within an account* in parallel only when they share campaign IDs. Prevents stacking calls on one Meta account while parallelising across accounts.
- Apply same pattern to all 3 Meta-hitting crons.

**PR-H: `perf/per-account-meta-semaphore`**
- New module `lib/meta/account-semaphore.ts`. Per-`ad_account_id` token-bucket semaphore tracking calls/minute and calls/hour.
- All `graphGetWithToken` calls acquire from the semaphore for their account before firing.
- Surface the semaphore state in `/api/internal/meta-budget` for ops visibility.
- Prevents the cascade where cron + UI + audience builder all hit one ad account simultaneously and trip 80004.

### Stage 3 — Snapshot the rest (week 2-3, ~3-4 Cursor days)

The internal-dashboard snapshot pattern (Friday reflection Ring 2) generalises to:

**PR-I: `perf/audience-source-snapshots`**
- New table `audience_source_snapshots` (campaigns/videos/pages per ad-account). Same payload-blob template as `active_creatives_snapshots`.
- Cron `/api/cron/refresh-audience-sources` writes snapshots 2×/day per active client.
- Audience Builder reads snapshot first, falls back to live + 30s spinner.
- **Result:** Audience Builder open-to-usable < 500ms instead of 20-40s.

**PR-J: `perf/daily-spend-tracker-snapshots`**
- Same pattern for the daily spend tracker (already flagged as intermittent 500).
- Cron writes per-event daily spend rollup; UI reads from rollup table not Meta direct.

**PR-K: `perf/thumbnail-warm-tier-2`**
- Currently: thumbnails are warmed by `warmCreativeThumbnailsForGroups` after snapshot writes.
- Issue: warm fails silently sometimes; UI shows broken images.
- Fix: extend `creative_thumbnail_cache` with `warm_attempts`, `last_warm_error`, `next_warm_at`. Background retry queue (cron) re-warms failed thumbnails on a 6h backoff.

### Stage 4 — Architecture for scale (week 4-6)

**Webhook ingestion via Meta's Webhook API.**
Meta supports webhooks for ad-account changes (`ads_insights`, `ad_account_business_objects` partially). Means: instead of polling every 4 hours, we react to "ad_paused" / "campaign_status_changed" events as they happen.

- Faster freshness for the ops surfaces that need it (active creatives status, campaign pause events).
- Drops the polling burden for objects that change rarely.
- Doesn't replace insights polling (Meta doesn't webhook spend/impression data) but cuts the surface area.

**Move to a queue-based job runner (Inngest or QStash).**
Vercel cron is fine for our scale today. At 50+ events × multiple platforms (Meta + TikTok + Google Ads + Eventbrite + fourthefans), we'll outgrow it. Inngest gives us:
- Retries per-job with persistent state.
- Concurrency limits per "key" (e.g. per ad-account) — replaces the semaphore in PR-H natively.
- Observable job runs (replaces cron logs).
- Free tier covers 50K runs/month, paid is $20/mo for 1M.

**Per-client API plane.** Long-term: each client's data lives behind its own snapshot tables + edge-cached API routes. Cross-client dashboard reads aggregate across snapshots, never touching Meta. Meta calls only happen in the snapshot-write path.

---

## 4. What this lets us scale to

| Phase | Active events | Daily Meta calls | Median UI load | Status |
|---|---|---|---|---|
| Today | 5 (4tF) | ~750 | 1-3s + occasional 20s+ stalls | Stressed |
| Post-Stage-1 | 5 | ~450 | 1-3s, no 20s+ stalls | Comfortable |
| Post-Stage-2 | 50 (4tF+J2+Louder+BR) | ~3000 | 1-3s | Comfortable |
| Post-Stage-3 | 100+ | ~3000 (snapshots dominate) | <500ms | Productisable |
| Post-Stage-4 | 250+ (full agency-OS pitch) | ~3000 (webhook + queue) | <200ms | Demo-grade |

The ceiling without Stage 3 is roughly **30-40 active events** before the perceived UX deteriorates. Stage 3 is the productisation gate — below it we're a tool, above it we're a platform.

---

## 5. Quick answer: BB bottom-funnel relaunch this week

Your specific ask: relaunch BB with 75%/95% video-views audiences across 4tF + J2 + Louder. Without Stage 1 shipping first, here's the manual workaround:

**Option A — Build audiences in batches by ad-account, not by client.**
- Open Audience Builder, pick one ad-account, build all video-view audiences for that account (75% + 95% across all relevant campaigns), commit, then move to the next ad-account.
- Why: the per-account 30-min cache means consecutive builds within an account hit cache; jumping between accounts cold-fetches each time.

**Option B — Pre-warm the night before.**
- Tonight, open the Audience Builder for each ad-account once. Don't commit anything. Just trigger the campaign-list + top-campaign-videos fetches.
- Cache lives 30 min per worker but if you open all ad-accounts within a 5-min window, the warm sticks for the next half hour.
- Tomorrow morning, build everything in one continuous session before the cache expires.

**Option C (preferred if Stage 1 lands tonight) — ship PR-D this weekend.**
- 1-line `maxDuration = 60` plus the DB-backed cache. ~3 Cursor hours.
- Means BB relaunch on Monday with no timeouts.

Realistic answer: ship PR-D Saturday so Monday's BB relaunch is uninterrupted. That alone fixes the immediate bottleneck. Stage 2 + 3 protect the J2 + Louder + BR onboarding ramp.

---

## 6. Action queue

**Tonight (Friday):**
- Capture this audit to memory.
- Add Stage 1 PRs to Cursor queue.

**Saturday:**
- Ship PR-D (audience-builder maxDuration + DB cache).
- Ship PR-E (cron cadence to 3×/day non-show-week).
- Smoke-test Audience Builder against 4tF + J2 video-views fetches.

**Sunday:**
- Joe walkthrough prep.
- Verify weekend deploys haven't broken anything.

**Monday:**
- BB bottom-funnel audiences built (using Option A or whatever PR-D gives us).
- Drop PR-G (cron parallelism) into Cursor.

**Week 2:**
- PR-H (per-account semaphore) — protects the parallelism in PR-G.
- PR-I, PR-J (snapshot expansion).

**Week 3-4:**
- PR-K (thumbnail warm hardening).
- Inngest spike — see if it makes sense before BR ramp.
