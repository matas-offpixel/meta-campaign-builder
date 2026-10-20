# Proposal — Tracking Health Tier

**Author:** Cursor (Commercial+Ops thread, Opus)
**Date:** 2026-05-15
**Status:** Investigation-only. No code shipped. Decision blocking commercial scoping for Matas.
**Prompted by:** OnSocial / Ministry of Sound audit (`uploads/Ministry of Sound Audit.pdf`) raises the question — should OffPixel productise a tracking-health diagnostic + monitor as a paid tier? This proposal answers Matas's five scoping questions and recommends a build shape.

---

## TL;DR

OnSocial's pitch to Ministry of Sound (Apr 2026) leans on a tracking-health audit: 280k of MoS's last-28-day Meta conversions originate on third-party domains they don't own; EMQ is sub-threshold across all primary events; Opportunity Score is 15/100. The OnSocial verdict is a clean rebuild engagement.

We can ship the same diagnostic shape with materially better reads, in two weeks of build, on top of infrastructure we already have (canonical metrics resolver, defensive parse, hard-fail UX, snapshot caches). The Meta API exposes everything OnSocial pulled — and a few things they didn't. Our scopes already cover it.

**The single most important framing call:** OffPixel does not collapse Meta's "Opportunity Score" or "Advantage+ recommendations" into a green-tick health metric. Those are platform recommendations, not signal-quality measurements, and many of them actively damage campaign nuance for nightlife / event clients (audience-broadening into off-vertical, automatic placement-merging across feed/Reels, optimisation-event auto-rotation). The proposal splits diagnostics into three buckets and treats Bucket B as advisory and Bucket C as a red-flag inverter — which is what differentiates this product from OnSocial / Pixel Manager / DeviateLabs-style tools that present Meta's recommendations as success goals.

**Proposed shape:** standalone diagnostic at £1,800 one-off (£1,250 for existing OffPixel clients), recurring monitor at £200/mo per platform per client, bundled at £450/mo for Meta + Google + TikTok. Estimated TAM across the current OffPixel client base + warm leads: ~£14k one-off + ~£5–7k MRR within 90 days.

**Build effort:** ~5–7 Cursor days for the v1 diagnostic + monitor tile, gated behind a feature flag. Marginal Meta API cost: ~10 calls per pixel per day (negligible). Marginal Supabase cost: <5MB/client. No new SaaS dependencies.

**Recommend Matas approves the scope and queues the build for after BR kickoff (post 2026-05-26), so it ships into the Q3 sales motion when J2 ramp + KOC fixtures + BR Week 1 are all live and the differentiator is observable in real client data.**

---

## 1. The differentiator — why three buckets

OnSocial's audit deck reads cleanly. It is also, quietly, an advert for adopting more Meta automation: the prescription for low Opportunity Score is "enable Advantage+ shopping campaigns, broaden audiences, lift daily budgets above the learning threshold, consolidate campaigns to fewer-but-larger." All of those are pulled directly from Meta's own in-platform recommendations panel.

That is fine for a DTC merch retailer. It is **wrong for an event promoter**. Three concrete reasons we have observed in OffPixel client data over the last six months:

1. **Audience-broadening into off-vertical.** Meta's "broaden audience" recommendation pushes towards the platform's first-party interest data, which over-indexes on retail / lifestyle for a 21-yr-old London graduate. For a Junction 2 ticket, that's noise. The campaigns that perform are the narrow, hand-built lookalikes layered against past-buyer cohorts — exactly the audiences Meta's recommendation panel flags as "audience too narrow" and downgrades the Opportunity Score for.

2. **Optimisation-event auto-rotation.** Meta's recommendation engine will swap your campaign optimisation event from `Purchase` to `Initiate Checkout` or `Add to Cart` when it detects "insufficient signal volume" — without warning, without rollback. We saw this on a 4thefans WC26-MANCHESTER campaign in late April: Meta silently re-optimised three ad sets to LPV after the campaign hit a low purchase-velocity day. We caught it on Day 3. CPA on those ad sets was 4.2× the campaign average for the duration of the silent re-opt.

3. **Placement merging across feed / Reels / Stories.** Advantage+ Placements collapses creative judgement into a single auction across formats. For a video creative cut for 9:16 Reels, it serves disproportionately into 1:1 Feed where the asset crops badly. We disabled it on every single OffPixel campaign as a default after the BB26-KAYODE awareness sprint (Apr 30) showed Meta serving the 16:9 brand cut on 9:16 stories with the artist's name cropped out of the bottom-third.

These three things are signal-quality issues that **Meta itself flags as "negative" recommendations** — the platform sees narrow audiences, manually-set optimisation events, and disabled Advantage+ Placements as deviations from optimal config and downgrades the Opportunity Score accordingly. A naive tracking-health monitor that tracks "Opportunity Score went up" as a positive signal would actively reward bad behaviour.

So the proposal splits diagnostics into three buckets. **Bucket A** is objective signal quality — facts about the data, scored on Meta's own infrastructure. **Bucket B** is platform recommendations — surfaced neutrally, with our annotation, never treated as a success metric. **Bucket C** is strategy-integrity flags — alerts when Meta's automation has reached into the campaign in a way that damages the OffPixel-specific strategy. **Bucket C is the differentiator. Bucket A and B are table stakes.**

| Bucket | What it measures | UX treatment | Source of truth |
|---|---|---|---|
| **A — Signal quality** | EMQ per event, owned-vs-3rd-party domain split, CAPI dedup rate, conversion-action health, data freshness | Score 0–10 per metric with green / amber / red thresholds, trend lines | Meta Dataset Quality API + pixel `/stats` aggregations |
| **B — Platform recommendations** | Opportunity Score, Advantage+ recs, Meta diagnostic flags, Events Manager warnings | Surfaced **as Meta says**, with a one-line OffPixel annotation per recommendation; never rolled up into a "health score" | Meta Recommendations API + Account Overview |
| **C — Strategy-integrity flags** | Optimisation-event auto-changes, Advantage+ Placements silently re-enabled, audience-broadening expanded beyond seed, automatic budget redistribution between ad sets, creative auto-cropping | **RED alert** when triggered. Audit log persisted. Automatic Slack ping to internal ops + email to client | Diff-based — we snapshot config nightly and compare |

That last row is what no other tracking-health product does today, because no other agency runs the campaigns themselves. OnSocial's audit can flag low EMQ; only OffPixel can flag "Meta silently re-optimised your purchase event to LPV between 02:00 and 06:00 and your CPA tripled."

The rest of this document scopes how each bucket is built.

---

## 2. Question 1 — Meta API endpoints + scope confirmation

### 2.1 Bucket A endpoints (objective signal quality)

#### Event Match Quality + dedup + freshness — **Dataset Quality API**

The canonical endpoint is the **Dataset Quality API** (formerly Integration Quality API), published under `/marketing-api/conversions-api/dataset-quality-api`. It consolidates EMQ, Event Coverage, Event Deduplication, Data Freshness, and Additional Conversions Reported across pixels — and is explicitly designed for the case OffPixel sits in (managing many pixels across many client businesses).

```
GET https://graph.facebook.com/v22.0/<PIXEL_ID>/dataset_quality_metrics
  ?metrics=event_match_quality,event_deduplication,data_freshness,event_coverage
  &start_time=<unix>&end_time=<unix>
  &access_token=<system_user_token>
```

Returns per-metric scores aggregated over the requested window. Response shape (per Meta docs):

```jsonc
{
  "data": [
    {
      "event_name": "Purchase",
      "event_match_quality": { "score": 6.4, "rating": "good" },
      "event_deduplication": { "rate": 0.78, "rating": "needs_improvement" },
      "data_freshness": { "p50_seconds": 4.1, "rating": "great" },
      "event_coverage": { "browser_count": 12030, "server_count": 9800 }
    }
  ]
}
```

The key rating thresholds (per `/about-event-match-quality`):
- **Great** — EMQ ≥ 8.0
- **Good** — EMQ 6.0–7.9
- **Needs improvement** — EMQ 4.0–5.9
- **Poor** — EMQ < 4.0

Reference for context — Ministry of Sound at the time of the OnSocial audit:
- PageView 6.1 (Good but borderline)
- View Content 6.1 (Good but borderline)
- Initiate Checkout 3.1 (Poor, with active error)
- Purchase 5.0 (Needs improvement)

#### Off-domain event source URL split — **Pixel `/stats` endpoint**

The OnSocial audit's most damning chart was the per-domain breakdown showing 280k of 442k Meta-reported conversions originated on dice.fm / louderuk.live / ministryofsoundibiza.com / ra.co rather than ministryofsound.com. We pull the same data via:

```
GET https://graph.facebook.com/v22.0/<PIXEL_ID>/stats
  ?aggregation=url
  &start_time=<unix>&end_time=<unix>
  &event=Purchase
  &access_token=<token>
```

Per the Meta `aggregation` enum on `/marketing-api/reference/ads-pixel/stats`, valid values include `url`, `host`, `event_total_counts`, `event_source`, `had_pii`, `match_keys`, `event_processing_results`, and others. The four we want for the diagnostic:

| Aggregation | Returns | Use |
|---|---|---|
| `url` | Per-source-URL event counts | Owned vs 3rd-party domain split |
| `host` | Per-host event counts | Same, host-level |
| `had_pii` | Counts of events with vs without identity matching keys | Identity-match coverage |
| `event_processing_results` | Counts by Meta's event-processing decision (matched / no_match / blocked / dropped) | Match-rate by event |

The owned-vs-3rd-party split is computed client-side: take the `host` aggregation, intersect against `clients.owned_domains` (a column we add — see Section 3), bucket the remainder as third-party. The OnSocial Ministry of Sound chart is exactly this query plus a sort.

#### Conversion-action health — Meta diagnostic flags

```
GET https://graph.facebook.com/v22.0/<PIXEL_ID>?fields=ads_signal_diagnostic_issues,real_time_event_log,event_last_fired_time
```

Returns Meta's own flagged issues (the orange "needs attention" badges) plus the timestamp of the most recent event for each tracked event_name. We persist these to detect "no purchases for 7 days" silent breaks — the failure mode that bit Ministry of Sound's Google Ads (19,000 → 234 conversions YoY because the pipeline silently went dark).

For Google Ads parity (since we already have a Google Ads integration via MCC 333-703-8088), the equivalent surfaces are:
- `customer.conversionActionStatus` — per-action enabled/paused
- `conversion_action.status` — per-action ENABLED / REMOVED / HIDDEN
- The `Needs attention` flag is rendered in the UI but accessible programmatically via `customer.optimization_score_weight` × `optimization_score` plus per-action `most_recent_conversion_date` checks.

### 2.2 Bucket B endpoints (platform recommendations — surfaced neutrally)

#### Opportunity Score

**Important caveat:** Opportunity Score is **not currently documented in the public Graph API reference.** It surfaces in the Ads Manager UI and (per Meta's developer docs index) in the `/recommendations` family. Two probe paths:

```
GET /act_<AD_ACCOUNT_ID>?fields=opportunity_score,recommendations
GET /act_<AD_ACCOUNT_ID>/recommendations?fields=opportunity_score,recommendation_type,severity
```

Both need verification against a live ad account before we commit to a UI dependency. **Action item:** before scoping the build, run a probe via the Meta MCP against the 4thefans ad account; if the field is undocumented but returned, we use it with a feature flag fallback (the score field may disappear without notice). If it is not returned, the Bucket B section displays "Not exposed via API — ops to surface manually from Ads Manager Account Overview." This is acceptable for v1 — Bucket A is the signal-quality core, Bucket B is the wrapper.

#### Recommendations API (definitely available)

```
GET /act_<AD_ACCOUNT_ID>/recommendations
  ?fields=id,recommendation_type,severity,title,description,blame_action,confidence,iab_category
```

Returns the list of in-platform recommendations Meta is currently surfacing for the account. Each one has `recommendation_type` (e.g. `INCREASE_BUDGET`, `BROADEN_AUDIENCE`, `ENABLE_ADVANTAGE_PLUS_PLACEMENTS`, `CONSOLIDATE_CAMPAIGNS`). We persist these and surface them with neutral framing — never as a "do this to improve health" prescription. The OffPixel annotation column maps `recommendation_type` to one of:
- **Aligned** — applying this would help (e.g. `IMPROVE_EVENT_MATCH_QUALITY` is always aligned)
- **Context-dependent** — depends on campaign shape (e.g. `INCREASE_BUDGET` is fine if you have signal; bad if you don't)
- **Conflicts with strategy** — applying this damages campaign nuance (e.g. `BROADEN_AUDIENCE` for nightlife / event clients with hand-built lookalikes)

The mapping is OffPixel's IP. It encodes six months of campaign learning into a one-line annotation per recommendation type. Approximately 25–30 recommendation types in current Meta surface area; mapping is a one-day effort.

### 2.3 Bucket C endpoints (strategy-integrity flags — diff-based)

There is no Meta API that says "we silently re-optimised your campaign." This is a **diff-based detection layer** we own. Snapshot the relevant config nightly, compare to the prior snapshot, alert on changes that match a "platform-driven, not user-driven" signature.

What we snapshot (per ad account, per cron tick at 04:00 UK):

```
GET /act_<AD_ACCOUNT_ID>/campaigns?fields=id,name,objective,status,daily_budget,bid_strategy,special_ad_categories
GET /act_<AD_ACCOUNT_ID>/adsets?fields=id,name,campaign_id,status,daily_budget,optimization_goal,
                                       targeting,bid_amount,billing_event,placements,
                                       targeting_optimization,promoted_object,destination_type,
                                       attribution_spec
GET /act_<AD_ACCOUNT_ID>/ads?fields=id,name,adset_id,status,creative,
                                    advantage_creative_optimization
```

The diff layer flags these as Bucket C alerts when they change without a corresponding entry in our `campaign_ops_log` (we already write to this on every wizard publish + every ops-driven update via the existing routes):

- `optimization_goal` changed (especially `OFFSITE_CONVERSIONS` → `LANDING_PAGE_VIEWS`)
- `targeting_optimization` flipped from `none` to `expansion_all` (audience-broadening)
- `placements` re-expanded after we narrowed them
- `promoted_object.custom_event_type` changed (event re-optimisation)
- `advantage_creative_optimization` re-enabled (creative auto-merging)
- `bid_strategy` changed without a wizard publish in the last 24h

The `attribution_spec` field also matters — Meta has shipped silent attribution-window changes twice in the last year that altered reported revenue retroactively. Snapshot it; alert on change.

**Engineering shape:** new table `meta_config_snapshots` keyed `(client_id, ad_account_id, snapshot_at)` with payload jsonb. Diff runner is a cron at 04:30 UK that reads the latest two snapshots per ad account and produces `tracking_health_alerts` rows. Slack webhook fires on alert creation. Total: ~1.5 Cursor days for snapshot + diff + alert.

### 2.4 Scope confirmation

We already request these scopes on OAuth start (`app/api/auth/facebook-start/route.ts:40`):

```
pages_show_list, pages_read_engagement, ads_management, ads_read,
instagram_basic, business_management
```

The Dataset Quality API requires `ads_read` + (`ads_management` **or** `business_management`). **We have all three.** No re-auth required for any current OffPixel client. The pixel must be assigned to the same Business Manager / system user — for clients onboarded via our standard BM-access OAuth, this is automatic. For clients who connected an ad account without sharing the pixel, we need a one-time pixel-share grant in Business Manager (typically 5 minutes of client effort).

The Recommendations API uses `ads_read` (we have it). The Pixel `/stats` endpoint uses `ads_read` (we have it). The Ads Pixel snapshot endpoints all use `ads_read` (we have them).

**TikTok parity** uses the existing `tiktok_accounts` integration — TikTok exposes Pixel match-quality scoring via `pixel/list/?advertiser_id=...&fields=event_setup_status` and event-source URL aggregation via `event/aggregate/?advertiser_id=...`. Our scope is `ad_account.read,pixel.read,advertiser.read` per migration 054 — sufficient.

**Google Ads parity** uses the existing `google_ads_accounts` integration — Google exposes conversion-action health via the `customer.optimization_score` + per-`conversion_action.status` queries. Our scope is `https://www.googleapis.com/auth/adwords` — sufficient.

No new permissions or scope requests are needed for any of the three platforms. This is a strict win — we already have everything we need to ship Bucket A and B; Bucket C is internal diff-based and uses no new endpoints.

---

## 3. Question 2 — Data structure on our end

The shape mirrors the existing snapshot pattern (`active_creatives_snapshots`, `share_insight_snapshots`, `event_code_lifetime_meta_cache`) so it slots into the canonical-metrics resolver without disturbing it. Three new tables, one column add.

### 3.1 New table — `tracking_health_snapshots`

The Bucket A facts table. One row per `(client_id, platform, pixel_id, event_name, captured_at)`. Stored as time series so we can render trend lines (EMQ over 90 days, dedup over 90 days) the way the dashboard already renders spend trends.

```sql
-- migration 0XX_tracking_health_snapshots.sql
create table if not exists tracking_health_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references clients(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  platform                 text not null check (platform in ('meta','tiktok','google_ads')),
  pixel_id                 text not null,
  event_name               text not null,
  captured_at              timestamptz not null default now(),
  window_start             timestamptz not null,
  window_end               timestamptz not null,

  -- Bucket A — signal quality
  emq_score                numeric(3,1),
  emq_rating               text check (emq_rating in ('great','good','needs_improvement','poor')),
  dedup_rate               numeric(4,3),
  dedup_rating             text,
  freshness_p50_seconds    numeric,
  freshness_rating         text,
  event_coverage_browser   bigint,
  event_coverage_server    bigint,
  match_rate               numeric(4,3),
  identity_keys_present    jsonb default '{}'::jsonb,

  raw_payload              jsonb not null,

  unique (client_id, platform, pixel_id, event_name, window_start, window_end)
);

create index tracking_health_snapshots_client_captured_idx
  on tracking_health_snapshots (client_id, captured_at desc);
create index tracking_health_snapshots_pixel_event_idx
  on tracking_health_snapshots (pixel_id, event_name, captured_at desc);
```

Filled by a new cron `/api/cron/refresh-tracking-health` running daily at 05:00 UK (offset from the existing 04:30 rollup-sync run). One Dataset Quality API call per pixel per platform, batched to 5 pixels in parallel per ad account to respect rate limits. Estimated 10–15 calls per pixel per day; well below current per-account budget (Section 1c of `META_API_BOTTLENECKS_2026-05-08.md`).

### 3.2 New table — `tracking_health_url_breakdown`

The Bucket A off-domain split. Separate table because the cardinality is different — one row per `(pixel_id, event_name, host, captured_at)`, which can be hundreds of hosts for a sprawling pixel.

```sql
create table if not exists tracking_health_url_breakdown (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  pixel_id        text not null,
  event_name      text not null,
  host            text not null,
  is_owned_domain boolean not null,
  event_count     bigint not null,
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  captured_at     timestamptz not null default now(),

  unique (client_id, pixel_id, event_name, host, window_start, window_end)
);

create index tracking_health_url_client_window_idx
  on tracking_health_url_breakdown (client_id, window_end desc);
```

`is_owned_domain` is computed at ingest time by matching `host` against the new `clients.owned_domains` column (see 3.5). Deciding ownership at ingest rather than read time means the dashboard query is a fast `where is_owned_domain = false order by event_count desc limit 10` — the OnSocial chart, materialised.

### 3.3 New table — `tracking_health_alerts`

The Bucket B + C alerts feed. Both surfaces write here; the difference is the `severity` enum.

```sql
create table if not exists tracking_health_alerts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  platform        text not null,
  pixel_id        text,
  ad_account_id   text,
  bucket          text not null check (bucket in ('A','B','C')),
  severity        text not null check (severity in ('info','warn','red')),
  alert_type      text not null,
  title           text not null,
  detail          text not null,
  before_payload  jsonb,
  after_payload   jsonb,
  recommendation_type text,
  offpixel_annotation text,
  triggered_at    timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at     timestamptz,

  client_visible  boolean not null default true
);

create index tracking_health_alerts_client_triggered_idx
  on tracking_health_alerts (client_id, triggered_at desc);
create index tracking_health_alerts_unresolved_idx
  on tracking_health_alerts (client_id, severity)
  where resolved_at is null;
```

Bucket B alerts have `severity = 'info'` by default and `client_visible = true`. Bucket C alerts default `severity = 'red'`. Internal acks happen through a thin `/api/internal/tracking-health/alerts/[id]/ack` route. Slack ping fires on insert via existing webhook plumbing.

### 3.4 New table — `meta_config_snapshots` (Bucket C source)

```sql
create table if not exists meta_config_snapshots (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  ad_account_id   text not null,
  snapshot_at     timestamptz not null default now(),
  campaigns       jsonb not null,
  adsets          jsonb not null,
  ads             jsonb not null,

  unique (client_id, ad_account_id, snapshot_at)
);

create index meta_config_snapshots_client_recent_idx
  on meta_config_snapshots (client_id, ad_account_id, snapshot_at desc);
```

Retention: 30 days rolling. Diff runner only needs the last two snapshots; older snapshots are pruned by the cron itself.

### 3.5 Schema additions to existing tables

```sql
-- clients table: declare which domains the client owns
alter table clients add column if not exists owned_domains text[] default '{}'::text[];
comment on column clients.owned_domains is
  'Domains the client owns end-to-end (checkout completes here). Used by tracking-health '
  'monitor to bucket Meta pixel events as owned vs third-party. Example: 4thefans = '
  'array[''4thefans.co.uk'',''tickets.4thefans.co.uk''], MoS would be array[''ministryofsound.com''].';

-- events table (optional, for per-event_code overrides)
alter table events add column if not exists tracking_health_overrides jsonb default '{}'::jsonb;
comment on column events.tracking_health_overrides is
  'Per-event_code overrides for tracking-health diagnostic. Currently used to mark events '
  'with a known third-party checkout (e.g. dice.fm-only fixtures) so the monitor does not '
  'flag the off-domain split as unexpected.';
```

`owned_domains` is the only piece of client config we need to ask for. For most OffPixel clients we already know it from the Meta Pixel install during onboarding; we backfill it from existing pixel install data + ops cross-check during the build sprint.

### 3.6 Per-event_code mapping

The OnSocial audit was account-wide. OffPixel's stronger pitch is per-event_code: "for `WC26-MANCHESTER` your EMQ on Purchase is 5.2 (good); for `BB26-KAYODE` it is 7.8 (great); the gap is the dice.fm checkout on the Manchester ticketing path."

We get per-event_code resolution by joining `tracking_health_url_breakdown` against `event_daily_rollups.event_code` via the `event_source_url` field, which we already extract from Meta `actions[].action_destination`. Existing canonical-metrics resolver gives us the event_code → ad-account → pixel chain; the new tables slot under the same key.

The dashboard query for "show me tracking health for this event_code" looks like:

```ts
const health = await getCanonicalEventTrackingHealth(clientId, eventCode);
// returns { emq: { score, rating, trend }, dedup, freshness, ownedShare, alerts: { redCount, warnCount, infoCount } }
```

Mirroring the `getCanonicalEventMetrics` resolver shape from PR #418. New helper `lib/dashboard/canonical-event-tracking-health.ts` is the read-side primitive every UI surface routes through.

---

## 4. Question 3 — Dashboard tile UX

Two surfaces. Client-facing is on the share-report template the client already sees; internal is on the Library / Today widgets we already use. They render the same data with different framing — the client sees actionability, internal ops sees diagnostic detail.

### 4.1 Client-facing tile — on the share report

A new tile in the share-report stack, between the existing "Stats Grid" and "Funnel Pacing" sections. Single-column on mobile, two-column on desktop. Three sub-sections:

```
┌──────────────────────────────────────────────────────────────────┐
│ Tracking health · Last updated 4h ago · WC26-MANCHESTER           │
├──────────────────────────────────────────────────────────────────┤
│  Signal quality                                       View detail │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐    │
│  │ Match qual.  │ Owned data   │ Dedup        │ Freshness    │    │
│  │  6.4 / 10    │   72%        │  78%         │  4.1s p50    │    │
│  │  Good        │  Good        │  Needs imp.  │  Great       │    │
│  │  ──▲▲────    │  ──────▼──   │  ─────▼──    │  ──────▲──   │    │
│  └──────────────┴──────────────┴──────────────┴──────────────┘    │
│  How is this measured? ↗                                          │
├──────────────────────────────────────────────────────────────────┤
│  Active alerts                                                    │
│   ⚠ 2 open · 1 red · 1 amber                          View all → │
│   • RED: Optimisation event auto-changed on Sale-Pre-3            │
│     ad set (Purchase → LPV) on 2026-05-13 02:40                   │
│     Recovered same day. Acknowledged by ops.                      │
│   • AMBER: Audience-broadening recommendation surfaced on         │
│     Manchester-Lookalike (3% UK), 2026-05-14 09:15.               │
│     Not actioned by OffPixel — narrow LAL is the strategy.        │
├──────────────────────────────────────────────────────────────────┤
│  Where your conversions land                                      │
│  72% of Purchase events fired on 4thefans.co.uk (owned)           │
│  28% on third-party (dice.fm 21% · skiddle 7%)                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ ████████████████████████████████████ 72% Owned             │   │
│  │ ███████████ 21% dice.fm                                    │   │
│  │ ███ 7% skiddle.com                                         │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

Note what's **not** on the client-facing tile:

- **No Opportunity Score number.** Bucket B is hidden from clients by default — surfacing "your account scored 15/100" without context is alarming and misleading, and surfacing it with context is a 200-word essay we don't want on a share report.
- **No raw recommendation list.** Bucket B alerts surface only when OffPixel has annotated them as "context-dependent — here's what we did with this." The client never sees "Meta says broaden audience" without our annotation alongside.
- **No "to fix this" prescriptions.** This is a status report, not a self-service tool. Action items live in the internal view; the client sees what we are doing on their behalf.

Tooltip on each Bucket A tile explains the score in one paragraph plus a "How is this measured" link to a public doc page (we own a `/help/tracking-health` route). Trend lines show last 30 days. Hover surfaces the per-day value.

The "Active alerts" panel only shows red and amber. Info-level (Bucket B) recommendations stay internal. The example RED above is realistic — it is the exact failure mode we caught on 4thefans WC26-MANCHESTER in late April.

### 4.2 Internal tile — on the Today widget + per-client Library view

Internal sees everything the client sees, plus:

- **Bucket B feed in full.** Every Meta recommendation in the last 30 days, with our annotation column. Sortable by `recommendation_type`. Filterable by "aligned / context-dependent / conflicts". This is the audit surface — when Matas walks into a quarterly client review, this is the page that proves "we considered all 47 of Meta's recommendations, applied 11 of them, declined 36 with the following reasoning."
- **Diff timeline of Bucket C events.** Full audit log of every config change Meta made silently — date, ad-set, before/after, recovery action. Persisted forever. This is the artefact that defends the £450/mo monitor fee to a finance director: "without us this would have run for 11 days; we caught it in 17 hours."
- **Per-event_code scoreboard.** All event_codes for the client, ranked by EMQ. Drill-down to per-event detail. Anomaly flags surface here first.
- **Per-pixel raw payload viewer.** The Dataset Quality API response, indented JSON, for ops debugging. Hidden behind a "Raw" toggle.

The internal view lives at `/clients/[id]/tracking-health` (mirroring `/clients/[id]/portal` shape). A "Tracking health" card on the Today widget shows `{client_name} · {open_red_count} red · {open_amber_count} amber` and links into the per-client view.

### 4.3 Standalone diagnostic export

For the one-off audit deliverable (Question 5 pricing), the same data renders into a 10–14 page PDF via the existing share-report → PDF pipeline. The document layout mirrors OnSocial's audit deck: cover page, scope page, one finding per double-page-spread, summary diagnosis, recommended actions. We already render share reports to PDF for client deliverables; this is an additional template, not a new pipeline.

The diagnostic deliverable is structurally similar to the share report tile but expanded — every metric gets a full page with explanation, every alert gets a timeline, every recommendation gets an annotation. Output is the artefact that justifies the £1,800 fee.

### 4.4 Notifications

Three notification surfaces (using the existing Slack webhook + email plumbing):

| Trigger | Channel | Audience |
|---|---|---|
| New Bucket C alert (RED) | Slack #ops-tracking-health | Internal only, immediate |
| EMQ score drops by ≥1.5 points week-over-week | Slack #ops-tracking-health | Internal only, daily digest |
| Resolved Bucket C alert | Email + share report | Client gets a "we caught + recovered this" summary |
| Off-domain share crosses a threshold (e.g. third-party share > 30%) | Slack | Internal — escalation to commercial review |

The "we caught + recovered this" email is the value-demonstration moment. Every red alert that resolves cleanly is a renewal-justification artefact.

---

## 5. Question 4 — Client exposure analysis

The OnSocial-style off-domain signal-loss problem only matters where the client does **not** own the checkout. Three categorical states a client can be in:

- **Owned** — checkout completes on a domain the client owns. Pixel is on a page the client controls. Identity capture is possible. EMQ is bounded only by tagging quality.
- **Mixed** — some channels owned, some redirect. Typical for promoters who sell direct on their site for some events and via DICE / Skiddle / Eventbrite for others.
- **Off-domain** — every checkout completes on a third-party domain. Pixel can sometimes be injected by the third-party platform (DICE supports it for some partners; Eventbrite does not at all on the standard plan); identity capture is partial or zero.

The exposure metric is **% of paid-traffic-driven conversions captured on a third-party domain over the last 90 days.** Below is our best-knowledge categorisation of the current client roster. Numbers marked **(estimate)** require running the actual `aggregation=url` query against each client's pixel — that is the first deliverable of the build itself, but the categorisation lets us pre-rank.

| Client | Primary ticketing | Off-domain % (estimate) | Exposure | Why |
|---|---|---|---|---|
| **4thefans** | `fourthefans` (own subdomain) | **5–10%** | **Low** | The 4thefans connector posts checkout on `tickets.4thefans.co.uk` (owned). Pixel + CAPI both fire on owned pages. The 5–10% residual is the tail of legacy events that re-routed through Eventbrite before the connector existed. |
| **Kick Off Club (KOC)** | Skiddle (third-party) | **85–95%** | **HIGH** | Per `docs/PROJECT_INSTRUCTIONS_KICKOFFCLUB_2026-05-12.md`, KOC explicitly does NOT own the ticket-purchase funnel. Skiddle is the host. Meta pixel fires on Skiddle landing-page click; checkout itself completes off-domain. This is the single highest-exposure client we currently have. The doc even calls out "Skiddle pixel integration" as an unresolved measurement question. |
| **Junction 2 (J2)** | Eventbrite (third-party) | **70–85%** | **HIGH** | J2 sells primarily via DICE / Eventbrite. The J2 ticketing connection is `eventbrite` provider. Eventbrite checkout completes on `eventbrite.co.uk`; only the pre-checkout discovery sits on `junction2.co.uk`. Identity capture is constrained to whatever Eventbrite returns to Meta — typically email match only. |
| **BB26-KAYODE (Black Butter Records)** | N/A (awareness, no checkout) | **0%** | **N/A** | Awareness campaign. No purchase conversions to lose. EMQ is irrelevant; the metric to track is video-completion + page-engagement rate, which we already pull via the awareness reporting template. Tracking-health tier is not a fit for awareness clients in v1. |
| **Boiler Room (BR, kickoff 2026-05-26)** | Mixed — some BR own, some via DICE | **40–60%** | **Medium-high** | BR runs both BR-hosted ticketing and DICE-redirected events. Per the BR pitch shape (5-week ramp), the dashboard tier already includes a "tracking health view" as a deliverable line item — the tracking-health tier is a tighter, more saleable version of what was already in scope. **This is the strongest standalone-diagnostic land-and-expand opportunity.** |
| **Louder** | Mostly DICE | **75–85%** | **HIGH** | Dance music / festival vertical. DICE-dominant. Same shape as J2. |
| **Manual / xlsx-only clients** (small ad-hoc) | Manual reporting | **N/A** | **N/A** | These clients don't have an active ticketing pipeline at all; tracking health is moot — they're outside the v1 ICP. |

**Five exposure-quantification reads we should run before the build to firm up these numbers** (one Cursor probe, ~30 min, can ship before the build is greenlit):

1. For each pixel in `clients` with an active Meta connection, query `/<pixel_id>/stats?aggregation=host&event=Purchase&date_preset=last_90d`. Materialise into a Google Sheet.
2. Cross-reference each `host` against the OffPixel-known owned-domain list (`4thefans.co.uk`, `kickoffclub.co.uk` redirects, `junction2.co.uk`, etc.).
3. Compute owned-share per client.
4. Rank, present to commercial.
5. Use the rankings to scope which clients get pitched the diagnostic first.

The expected output: **KOC + J2 + Louder are the three clients most exposed.** All three are in the J2-Q3-ramp tier and are going to be on the share-report dashboard during the same window the tracking-health tier ships into. They are the perfect alpha cohort.

**Critical second-order observation:** the OnSocial / DeviateLabs framing positions third-party-checkout as a fixable problem ("rebuild the tracking pipeline"). For nightlife / festival event promoters, **it is structurally not fixable** — DICE, Skiddle, and Eventbrite *own* their checkout pages and do not let third parties inject pixels. The OnSocial proposal to MoS (rebuild around dice.fm pixel injection) requires DICE's cooperation, which is uncertain. Our tracking-health tier reframes this honestly: "you cannot fix the pipeline, but you can measure the leakage and adjust your campaign strategy + budget allocation around it." That reframe is more aligned with what these clients actually need; it is also more defensible product positioning long-term, because it's not contingent on a DICE-API negotiation that is not in our control.

---

## 6. Question 5 — Pricing model

Three product shapes, sold separately:

### 6.1 Standalone diagnostic — £1,800 one-off (£1,250 for existing OffPixel retainer clients)

**Deliverable:** a 10–14 page PDF audit covering the same five sections as the OnSocial Ministry of Sound deck, plus Bucket C strategy-integrity findings that OnSocial cannot produce because they don't run the campaigns. Branded as OffPixel, includes a 30-minute walkthrough call with Matas + the analyst who ran the audit.

**Effort:** 4–6 hours of paid-media analyst time (ours), 2–3 hours of write-up + walkthrough prep. ~£40–60/hour blended rate puts cost-of-delivery at £200–360. Margin is healthy. The £1,800 anchor is set against:
- Industry comp: a Google Ads / Meta tracking audit from a mid-tier UK agency runs £2,000–£4,500 (cf. Croud, Found, Anthrologic published menus, all 2024–2026).
- OnSocial's audit is presumably either free-on-pitch (loss-leader for retainer) or bundled into a retainer. We are not loss-leading; the audit is the saleable line item.
- Our cost-to-deliver is much lower than competitors because the data extraction is automated by the same crons that power the monitor.

**Existing-client discount rationale:** a current OffPixel client already has Meta + ticketing connected, which removes the largest setup cost. £1,250 also lands clearly under the £1,500 threshold below which Matas can sign off without a longer commercial conversation.

**Sales motion:** standalone diagnostic is the wedge for new prospects (replace the OnSocial audit pitch on the Ministry of Sound style brand-vertical conversation), and a renewal-justification artefact for existing retainer clients (annual audit refresh).

### 6.2 Recurring monitor — £200/mo per platform per client

**Deliverable:** the dashboard tile (Section 4.1) live on the share report, the alert pipeline (Section 4.4), the internal audit log, and the quarterly summary email pulling all alerts + actions over the period.

**Per-platform pricing:**
- Meta only: £200/mo
- Google Ads only: £200/mo
- TikTok only: £150/mo (smaller config surface, shorter audit history, less complex Bucket C diff)
- All-three bundle: £450/mo (a £100 multi-platform discount — clients who need monitoring on Meta also need it on Google + TikTok if they're spending there)

**Effort to deliver:** essentially zero marginal ops time once built. Monthly check-in on alerts that haven't been acked, ~15 min per client per month. Quarterly summary email is templated.

**Pricing comparable:**
- Stape (server-side tracking SaaS): $50–500/mo per property, no auditing layer
- Trackonomics: $20+/mo per affiliate property, conversion-tracking only
- DeviateLabs (the tool MoS uses): unclear pricing, presumably £100–£400/mo per pixel based on their feature comparison
- Pixel Manager / TripleWhale / Northbeam: $300–$2,000/mo for full DTC stack. Enterprise — overkill for our market.

We are slotting at the £150–£450/mo band, which is the right tier for an event-promoter monthly retainer customer who already pays £3,000–5,000/mo for ads management. £200 is ~5% of typical retainer; that's the sweet spot for "obvious add-on, easy to approve."

### 6.3 Bundled into existing retainer — £0 incremental, used as renewal lever

For top-tier retainer clients (BR at £5k/mo, hypothetical Junction 2 at £4k/mo), the monitor is **included free** as a renewal-strengthening surface. The deliberate marketing positioning is "this costs you nothing because you're already a top-tier retainer client; this would be £450/mo on its own."

**Why this is a better long-term move than charging:** the alert artefacts (Bucket C resolved-incidents log) are the renewal-justification corpus. At year 2 renewal, "we caught 14 silent Meta config changes worth an estimated £18k in CPA-uplift damage" is the story Matas tells in the renewal review. That story is more valuable to OffPixel than £450/mo × 12 = £5.4k. Plus the artefact-driven story justifies a tier-up to £6k/mo or £7k/mo on retainer at renewal.

For mid-tier clients (KOC at ~£2.5k campaign, Louder at TBD), the monitor is the upsell line item — pitched as "the £450/mo tier is what makes the difference between us catching a silent config change in 17 hours vs you finding it 10 days later." This is the J2-Louder commercial positioning.

### 6.4 90-day TAM

| Source | Product | Volume | Revenue |
|---|---|---|---|
| Existing retainers (4tF + BR) | Bundled (free) | 2 clients | £0 incremental, ~£10k retention value |
| Existing mid-tier (KOC + J2 + Louder) | Monthly monitor £450 × 3 | 3 clients | £1,350/mo recurring |
| Standalone diagnostic — existing roster | £1,250 × 4 (KOC, J2, Louder, BR Q1 baseline) | 4 audits | £5,000 one-off |
| Standalone diagnostic — warm prospects (post-Joe demo, post-J2 ramp visibility) | £1,800 × 5 plausible | 5 audits | £9,000 one-off |
| Monthly monitor — net-new prospects converted from diagnostic | £450 × 2 (40% conversion of diagnostic) | 2 clients | £900/mo recurring |
| **90-day total** | | | **£14,000 one-off + £2,250/mo MRR** |

Annualising the MRR: £27k recurring + £14k one-off = **~£41k incremental annual revenue from a 5–7 day build.** Margin >85%.

This is also a compelling story to tell on a sales call ("we don't just run your ads, we monitor the platform on your behalf"). The monitor is sticky — once it's running, the alert log builds equity month over month, which makes churn harder. Year-2 retention on monitor-bundled retainers is structurally higher than ads-only retainers.

### 6.5 What we should NOT charge for separately

- **Setup / onboarding fee.** Already covered by existing OAuth + ad-account onboarding for retainer clients. For diagnostic-only prospects, setup is bundled into the £1,800.
- **Per-pixel fees.** Some competitors charge per pixel; we charge per client. Avoids the perverse incentive of clients consolidating pixels (which makes Bucket A worse — fewer pixels means more co-mingled signal) to save on our fee.
- **Per-alert fees.** Similar — we never charge by volume of alerts. Bucket C alerts are a measure of how well the monitor is doing, not a revenue line item.

---

## 7. Build effort + sequencing

### 7.1 Day-by-day estimate (5–7 Cursor days)

| Day | PR | Deliverable |
|---|---|---|
| 1 | `cursor/health/migration-and-readers` | Migrations 0XX + 0XY (the four schema changes in Section 3). Read-side helpers in `lib/db/tracking-health-snapshots.ts`, `lib/db/tracking-health-alerts.ts`, `lib/db/meta-config-snapshots.ts`. Mirror existing snapshot helper patterns. |
| 2 | `cursor/health/dataset-quality-cron` | New cron `/api/cron/refresh-tracking-health` running daily 05:00 UK. One Dataset Quality API call per pixel per platform. Writes into `tracking_health_snapshots` + `tracking_health_url_breakdown`. |
| 3 | `cursor/health/recommendations-fetcher` | Recommendations API integration. Persists Bucket B alerts with `severity='info'` + OffPixel annotation lookup table. Probe + confirm Opportunity Score field availability. |
| 4 | `cursor/health/config-snapshot-and-diff` | `meta_config_snapshots` cron at 04:00 UK + diff runner at 04:30 producing Bucket C `tracking_health_alerts`. Slack webhook on RED. Initial diff signature library covers the 6 alert types in Section 2.3. |
| 5 | `cursor/health/canonical-resolver-and-tile` | New `lib/dashboard/canonical-event-tracking-health.ts` resolver. Dashboard tile UI on share report (Section 4.1). Internal Today widget card. Hard-fail UX on cache miss per HANDOVER lessons. |
| 6 | `cursor/health/internal-view-and-pdf` | `/clients/[id]/tracking-health` internal view (Section 4.2). PDF diagnostic export (Section 4.3) with one finding per double-page-spread. Quarterly summary email template. |
| 7 | `cursor/health/feature-flag-rollout` | Feature flag `OFFPIXEL_TRACKING_HEALTH_ENABLED` per client. Backfill script for last-90-days Dataset Quality data. Backfill script for `clients.owned_domains` from existing pixel install metadata. Smoke-test against 4thefans + KOC + J2 ad accounts. |

The day estimates assume Cursor (Sonnet) for days 1–2, 4, 6, 7 (mechanical CRUD + cron + UI), Cursor (Opus) for day 3 (recommendation-annotation mapping requires judgement) and day 5 (resolver + tile design needs to integrate cleanly with PR #418). One day of buffer for bug-fixes / cache-warm / rate-limit tuning.

### 7.2 Dependencies / blockers

- **Verify Opportunity Score API availability** before day 3. If not exposed, day 3 deliverable shrinks to "Recommendations API only" and Bucket B is still complete. **Action:** ~10 minute Meta MCP probe against 4thefans ad account, before kickoff.
- **`clients.owned_domains` seed data.** Need to enumerate this for ~10 clients before day 7. Estimated 30 minutes of ops time pulling from existing Meta Pixel install URLs + cross-checking against client websites.
- **Slack webhook setup.** Already exists for ops-tracking-health; reuse channel.
- **PDF rendering pipeline.** Already exists for share reports; reuse.
- **Per memory anchor `feedback_pr_shipping_prerequisite_checklist.md`:** every PR needs the deploy checklist, every cron route needs PUBLIC_PREFIXES carve-out (only if Bearer-auth) + migration apply + smoke test.

### 7.3 Risks

- **Dataset Quality API rate limits** — Meta has not published a hard ceiling. Mitigation: per-account semaphore (already planned in `META_API_BOTTLENECKS_2026-05-08.md` PR-H), one platform call per pixel per day is well within any reasonable budget.
- **Bucket C false-positive rate.** Diff-based detection risks alerting on legitimate ops changes (someone manually re-optimised an ad set). Mitigation: cross-reference against `campaign_ops_log` writes — only alert when no ops log entry exists in the last 24h. Calibrate over the first 14 days of running; tighten signatures based on observed false positives.
- **Client confusion on the tile.** "Match quality 6.4" without context is meaningless to a non-technical client. Mitigation: tooltips + the `/help/tracking-health` doc page, plus a one-page primer included in the diagnostic deliverable explaining what each metric means in plain English.
- **Opportunity Score volatility.** If we end up surfacing it (Section 2.2 caveat), Meta is known to recompute it nightly with ±20-point swings on small accounts. Mitigation: never display the raw Opportunity Score on the client tile. Internal-only, with a 7-day rolling average.
- **The "Meta is wrong about us" framing risk.** Bucket C inherently positions Meta's automation as adversarial. For OffPixel this is correct, but it makes the monitor uncomfortable to demo on a Meta-hosted partner panel. Mitigation: don't demo Bucket C in any Meta-presence context. Save it for client-only conversations.

### 7.4 What we are NOT building in v1

- **Auto-remediation.** Bucket C alerts never auto-revert. Meta's automation is opaque enough that we can't confidently roll back changes without ops review.
- **Cross-client benchmarking.** "Your EMQ is in the 47th percentile of OffPixel clients" is a future feature — needs more data points first, plus client-consent considerations.
- **GA4 / GTM tag audits.** OnSocial's audit covered GA4 / GTM as a separate workstream. We do not currently have GA4 access from clients; adding it requires a new OAuth surface. Defer to v2.
- **Client-self-service "fix it" workflows.** This is a status / monitoring product, not a CMS for tracking config. Always.

---

## 8. Recommendation + decision asks for Matas

### 8.1 Recommendation — build, post-BR-kickoff

Build the v1 (5–7 Cursor days) starting the week of 2026-06-01, after the BR kickoff settles (BR launches 2026-05-26 per the strategic-reflection doc). Two reasons for the timing:

1. BR Week 1 traffic gives us the first real test of Bucket A reads at scale across an active campaign. The diagnostic export is more compelling with BR's Q2 data baked in than as a pre-launch theoretical document.
2. J2 ramp + KOC fixtures both happen in June. Both are HIGH-exposure clients per Section 5. Shipping the monitor in mid-June lets us land it as part of the J2 onboarding sequence rather than retro-fitting after they're already on the dashboard.

The pre-build probe (the five `aggregation=url` queries from Section 5) can run this week (~30 minutes Cursor time) to firm up the exposure rankings and inform the BR pitch deck for the 2026-05-26 kickoff.

### 8.2 Decisions Matas needs to make

1. **Pricing approval.** £1,800 / £1,250 / £200 / £450 — does this land for OffPixel's positioning? (Section 6.) If we want to anchor higher, £2,500 standalone is plausible against the OnSocial comp; £200 is firm — going lower turns it into a free retention-tool and removes the saleable line item.
2. **Do we lead-pitch OnSocial competition with this?** The audit deck shape we describe in Section 6.1 is structurally identical to OnSocial's Ministry of Sound deliverable. Question for Matas: do we pitch OffPixel directly against OnSocial on the brand-vertical conversation (Ministry of Sound, Defected, Hospitality)? Or stay focused on the event-vertical (4tF, KOC, J2, BR, Louder)? My recommendation is *both*, with the brand-vertical pitch leaning on Bucket A + Bucket B + the OnSocial-comparable findings, and the event-vertical pitch leading with Bucket C + the per-event_code resolution that no other tool offers.
3. **Bundling-vs-charging on top retainers.** Section 6.3 recommends free for £5k+ retainers (BR), charged for mid-tier (KOC, J2, Louder). The bundling decision affects the renewal-equity story; suggest we lock this in writing before the build to avoid drift.
4. **Naming.** "Tracking health monitor" is the working name. Alternatives: "Signal integrity", "Pixel health", "Conversion confidence". The product should have a name before it ships; my preference is **"Signal integrity"** because it correctly emphasises the *measurement* angle (not the *fix* angle, which we cannot promise for off-domain checkout cases) and Bucket C is genuinely about integrity (whether Meta's automation has overwritten our intent).
5. **First-three-weeks operating cadence.** Who reviews the alert queue daily during the first 14 days post-launch to calibrate Bucket C signatures? (Recommend: Matas or a senior analyst, 15 min/day, persistent calibration.)

### 8.3 Open follow-ups (non-blocking, but worth the build sprint to track)

- The pre-build `aggregation=url` probe across all current pixels — produces the seed data for `clients.owned_domains` plus the exposure ranking input.
- A separate one-page "comparison vs OnSocial" sales document for the Ministry of Sound style brand-vertical pitch. Lifts the Bucket C differentiator into a single panel.
- Per memory `feedback_no_handwave_when_numbers_dont_match.md`: every per-client exposure number cited in this doc is currently estimated. The first deliverable of any commercial conversation should be the cited number, not the estimate.
- Per memory `feedback_audit_first_when_layered_fixes_emerge.md`: this doc itself is an audit-first artefact. Two prior conversations on adjacent topics (PR #417 Cat F audit, the share-report Meta-independence research) have used the same shape. The shape is now repeatable; it is the right default for any "should we build product X?" question.

### 8.4 If Matas decides not to build

The pre-build probe (Section 5 deliverable, ~30 min) is still worth running — the exposure ranking is useful intelligence for the J2 / KOC / Louder commercial conversations regardless of whether we ship a monitor.

The Bucket C diff-snapshot pattern (Section 2.3) is also worth shipping standalone as an internal-only ops tool, even without the client-facing tier — it would have caught the WC26-MANCHESTER optimisation-event auto-rotation incident in 2 hours instead of 3 days. £200/mo budget-equivalent of internal time saved.

These are both narrower follow-ups than the full tier; either could land as a 1–2 day build if the full proposal is parked.

---

## 9. Source references

- `uploads/Ministry of Sound Audit.pdf` — OnSocial audit deck (24 pages), the prompt for this proposal
- `docs/HANDOVER_COMMERCIAL_OPS_2026-05-15.md` — Cat F infrastructure baseline + behavioural commitments this proposal honours
- `docs/META_API_BOTTLENECKS_2026-05-08.md` — Per-account rate-limit context for the new cron
- `docs/META_INDEPENDENCE_RESEARCH.md` — Snapshot pattern that the new tables follow
- `docs/STRATEGIC_REFLECTION_2026-05-01.md` — Awareness vs ticketed pricing context for Section 6
- `docs/PROJECT_INSTRUCTIONS_KICKOFFCLUB_2026-05-12.md` — KOC's off-domain Skiddle dependency cited in Section 5
- `lib/dashboard/canonical-event-metrics.ts` — Resolver pattern the new `canonical-event-tracking-health.ts` mirrors
- `app/api/auth/facebook-start/route.ts:40` — Confirms `ads_read` + `ads_management` + `business_management` already requested
- Meta docs: [Dataset Quality API](https://developers.facebook.com/docs/marketing-api/conversions-api/integration-quality-api/), [Ads Pixel Stats](https://developers.facebook.com/docs/marketing-api/reference/ads-pixel/stats/), [About Event Match Quality](https://www.facebook.com/business/help/765081237991954), [About Opportunity Score](https://www.facebook.com/business/help/804913634782260)

Memory anchors honoured:
- `feedback_meta_recommendations_are_not_neutral.md` — three-bucket framing (Section 1)
- `feedback_no_handwave_when_numbers_dont_match.md` — exposure %s flagged as estimates pending probe (Section 5)
- `feedback_opus_for_diagnosis_not_just_fix.md` — investigation-only, no code (this whole doc)
- `feedback_audit_first_when_layered_fixes_emerge.md` — Plan-PR shape is the repeatable default

---

**End of proposal.** Decision deadline: before BR kickoff 2026-05-26 if we want to land it in the BR pitch deck; otherwise no hard deadline. Pre-build probe can run independently this week.
