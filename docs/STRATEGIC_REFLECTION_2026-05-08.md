# Strategic Reflection — Friday 2026-05-08

**One-line summary:** Reporting accuracy is solved. Speed is now the gating constraint — both for Joe's review on Monday and for any future client we onboard onto the dashboard stack.

---

## 1. State of the union (where we are vs 2 weeks ago)

**What's solved:**
- Reporting reconciled to Meta source-of-truth (within ~£100 across 21 events post-PR #295, mig 070).
- Multi-platform read (Meta + Google Ads + TikTok) live on awareness and ticketed templates.
- 4thefans dashboard: end-to-end venue grouping, allocator, trend chart, funnel pacing, audience builder, benchmark alerts.
- Channel-aware ticket history (manual / xlsx / Eventbrite / fourthefans) with priority resolution.
- 41/42 4thefans events backfilled with full sale-launch ticket history (PR #347).
- Audience Builder v1.0 — 26 PRs, 6 subtypes, bulk creator across events.

**What's broken in the daily-driver feel:**
- **Dashboard load times.** Joe flagged it; I feel it. The internal `/clients/[id]/dashboard` page does 10+ sequential service-role round-trips inside a single `force-dynamic` server component. No edge cache, no parallel batching, no streaming.
- **Patterns + venue pages re-fetch the whole client portal payload then filter in memory.** Opening one venue page drags every event's rollups, snapshots, tier data, channel allocations across the wire.
- Sub-tab navigation (Performance / Insights / Pacing) has no route-level prefetch. Each click is a fresh server render that re-runs the full loader.

**What's still unstable (background):**
- Sync routes still have the silent ok:true class of failure (queued for Monday `feat/sync-route-write-invariants`).
- Branch protection on `main` not enforced (queued for Monday).
- Daily Spend Tracker intermittent 500 (queued).

---

## 2. Why speed is the right north star this week

Three reinforcing reasons:

**Client signal.** Joe has explicitly flagged it. He's the BR-readiness reference — if the dashboard feels sluggish to a daily user, it doesn't matter how accurate the data is, the trust signal degrades. The Monday walkthrough is at risk of being judged on responsiveness, not insight.

**Sales leverage.** The dashboard stack is now the £500–800/mo value driver for BR (kickoff 26 May) and any future client-portal pitch. Demo perf = pitch perf. A 4-second load when clicking into a venue card kills the "operational advisor" story we're telling.

**Compounding cost.** Every minute of dashboard wait time = our own time burned (cf. `feedback_time_compression_north_star.md`). We use the dashboard daily for ad reviews, presales, post-event reports. A 60% load-time reduction across all daily-driver pages saves both of us hours per week.

The original time-compression note from PR #87 (10–30s share-report → <1s) is the template. The internal dashboard never got the same treatment.

---

## 3. Diagnosis — where the latency lives

I read `lib/db/client-portal-server.ts` (`loadPortalForClientId`). It's a textbook waterfall:

1. `clients` lookup (1 RT)
2. `events` (1 RT)
3. `client_report_weekly_snapshots` (1 RT, blocks on #2)
4. `daily_tracking_entries` (paginated, 1–2 RT, blocks on #2)
5. `event_daily_rollups` (paginated, 1–4 RT, blocks on #2)
6. `event_ticketing_links` (1 RT, blocks on #2)
7. `event_ticket_tiers` (1 RT, blocks on #2)
8. `additional_tickets` (1 RT, blocks on #2)
9. `tier_channels` (1 RT, blocks on #2)
10. `tier_channel_allocations` (1 RT, blocks on #2)
11. `tier_channel_sales` (1 RT, blocks on #2)
12. `ticket_sales_snapshots` (paginated, 1–4 RT, blocks on #2)

Steps 3 through 12 only need `eventIds`. They're independent of each other. **None** are running concurrently — they're sequential `await`s. On a 42-event client like 4thefans, with PostgREST round-trips at ~80–150ms each, that's 1.5–3.5 seconds of pure DB latency *before* React renders.

**Compounding factors:**

- `force-dynamic` + `revalidate = 0` on every page kills the Next.js full-route cache. There's no cached fragment Joe ever sees first.
- The venue page (`/clients/[id]/venues/[event_code]`) calls the **same** full client loader and then filters in memory. So opening a single venue card pays the same 1.5–3.5s + an extra page navigation cost.
- Patterns page (`/dashboard/clients/[slug]/patterns`) repeats the pattern.
- No `loading.tsx` Suspense boundaries — the user sees a blank page until the entire server render resolves.
- `ClientSyncAllButton` and other client components fetch their own data on mount, none of which are coordinated.

**The single biggest win:** parallelise steps 3-12 with `Promise.all` — that alone should drop the loader from sequential 1.5–3.5s to bottlenecked-on-slowest ~300-500ms. Then layer streaming + per-route narrowed queries on top.

---

## 4. Next push — three concentric rings

Each ring stands on its own. Ship outermost first; cumulative wins compound.

### Ring 1 — Quick wins (Monday + Tuesday, ~6 Cursor hours)

The 80/20 perf push. Targets dashboard loader + venue page + patterns page.

**PR-A: `perf/client-portal-loader-parallelise`**
- Wrap steps 3-12 of `loadPortalForClientId` in `Promise.all` (or split into 3 batched groups for type-narrowing).
- Add a `console.time` / `console.timeEnd` block guarded by `NODE_ENV !== "production"` so we can A/B verify in dev.
- Target: 1500ms → 400ms cold loader on 42-event clients. Verify with Vercel Analytics post-deploy.

**PR-B: `perf/loading-suspense-boundaries`**
- Add `loading.tsx` to `/clients/[id]/dashboard`, `/clients/[id]/venues/[event_code]`, `/dashboard/clients/[slug]/patterns`.
- Skeleton the topline stats grid + sub-tabs so Joe sees structure within 100ms.
- Convert long-running children (Active Creatives, Daily Tracker) to `<Suspense>` islands with their own loaders.

**PR-C: `perf/venue-page-narrow-loader`**
- Replace the venue-page `loadClientPortalByClientId` call with a new `loadVenuePortalByCode(clientId, eventCode)` that filters at the query layer.
- Reuses 80% of the client loader code; cuts payload + round-trip count by ~70% for a single venue.

### Ring 2 — Structural (next 2 weeks)

**Snapshot-pattern for the internal dashboard.** PR #87 did this for share-report (live-fetch → snapshot table → <1s). The internal dashboard never got the same treatment — it still recomputes the whole portal aggregation on every render.

- New table `client_dashboard_snapshots` (mig 080), payload-blob like `active_creatives_snapshots`.
- Cron writes every 15 min for any client whose user touched the dashboard in the last 24h.
- Internal page reads snapshot first, falls back to live loader if stale > 30 min.
- Manual "Sync now" still hits the live loader.

This is the single biggest win available — it would take 4thefans dashboard from 2-3s to <500ms cold, regardless of event count.

**Edge cache the read-only API routes.** `/api/dashboard/benchmark-alerts`, `/api/share/client/[token]` (already snapshotted upstream), the daily-spend lookup, etc. — all add `Cache-Control: s-maxage=60, stale-while-revalidate=300` headers. Vercel CDN handles the rest.

**Route prefetch.** Sub-tabs on the venue page (Performance / Insights / Pacing) should `prefetch={true}` so clicking is instant. Currently they're cold every time.

### Ring 3 — Productisation lever (3-6 weeks)

Speed isn't just a polish layer — it's a sales artefact. Faster dashboards = better demos = higher pricing tier.

- **Public benchmark page**: "Off/Pixel dashboards load in <500ms cold; here's the live demo." Counter-positions us against Supermetrics/Funnel-style 5-15s loads.
- **Client-side caching layer for the share-report URL**. We already snapshot server-side; add Service Worker offline-first so a client revisiting the same dashboard URL gets sub-100ms second load.
- **TanStack Query** at the page level (currently we hand-roll). Centralised cache + automatic background refetch + dedupe across components. Cuts per-component request count by ~30-50%.

---

## 5. Growth + commercial reflection (parallel to perf push)

**Pricing posture is shifting.** The reconciliation arc + dashboard stack means we can credibly raise the ceiling. Current £4-4.5k cap on event campaigns is anchored to the old "set up + manage" framing. With the dashboard, we're now selling visibility + decisioning, not just execution.

Three concrete pricing experiments to try this month:

1. **Dashboard-as-line-item** on BR proposal — £500-800/mo separate from campaign management. Frames it as data infrastructure, not bundled service.
2. **Tiered campaign fee** — base + variable component pegged to ticket-revenue uplift (small upside cap, but signals confidence).
3. **Dashboard-only retainer** for clients who run their own campaigns but want the reporting layer (Junction 2, Louder are candidates once their connectors land).

**Sarah-as-product.** The dashboard stack is genuinely productisable, and Sarah's data-engineering background fits the build. If we package the dashboard as its own sub-product (separate from event marketing), Sarah can carry the demo + onboard. That's the path to Sarah moving from supporting to owning revenue.

**MRR trajectory.** Current £13k → £20k target. Reconciliation arc + dashboard stack should let us:
- Hold 4thefans at £5-7k/mo (currently undercharged given dashboard scope).
- BR at £5k/mo from 26 May.
- Pull in 1 more dashboard-only retainer (J2 or Louder) at £750-1500/mo.

That's a credible £15-17k by July without hiring. The bottleneck is still execution time per client — which loops back to perf, automation, and the brief→template→draft pipeline.

---

## 6. What gets paused / decided

**Decided:**
- Speed push runs in parallel with the Monday queue items the 4tF dashboard thread already has (event-code trim, sync-write invariants, branch protection). No conflict — different files.
- The London 3-way split + Joe walkthrough prep are **not** blocked on perf. Run those Sunday/Monday morning regardless.
- Cancel Motion today. It was due May 8.

**Paused / on-deck (not next week):**
- Per-creative pacing overlay on funnel pacing — defer.
- LPV column widening — defer.
- Phase 5 dedupe migration for WC26 duplicate event rows — defer (still safe to leave).
- Plugin marketplace for Cowork / Chrome — interesting but not a near-term revenue lever.

**Open questions for Sarah this weekend:**
- Does the snapshot-pattern (Ring 2) make sense as a generalised data-product offering, or is it always client-specific?
- Should the dashboard reporting layer move to BigQuery + Looker Studio for clients above some scale threshold, or do we double down on the Supabase + Next.js stack?

---

## 7. Action queue (Friday close → Monday)

**Tonight:**
- Cancel Motion.
- Capture this reflection to memory.

**Saturday:**
- Draft Cursor prompt for `perf/client-portal-loader-parallelise` (Ring 1 PR-A).
- Optional: smoke-test current load times across `/clients/[id]/dashboard`, `/venues/[event_code]`, `/dashboard/clients/[slug]/patterns` with browser DevTools so we have a baseline.

**Sunday:**
- Joe walkthrough talking points (Glasgow SWG3 sellout lead, reconciled drift trust signal, Lock Warehouse 4-way CL Final example).
- BR proposal audit — fold dashboard stack as £500-800/mo line item.

**Monday:**
- Run admin backfill + verify £10k drift cleared (`POST /api/admin/event-rollup-backfill?force=true`).
- Drop Ring 1 PRs (A, B, C) into Cursor in dependency order.
- Hand off Monday queue items (whitespace trim, sync invariants, branch protection, TOCA, Daily Spend Tracker) to creator/reporting thread per memory namespacing rule.
- Joe walkthrough.

**Tuesday:**
- BR audit + send proposal v2.
- Verify Ring 1 deploys; measure load-time deltas.
- Junction 2 + Louder ticketing roadmap scoped.

---

## 8. Speed-push delivery log (Friday 2026-05-08, evening)

All six perf PRs landed in a single bundle off `main`, in the
deploy order specified in the Cursor prompt:

| PR | # | Title | Merged |
|---|---|---|---|
| PR-A | [#360](https://github.com/matas-offpixel/meta-campaign-builder/pull/360) | `perf(client-portal): parallelise loadPortalForClientId fetches` | yes |
| PR-C | [#361](https://github.com/matas-offpixel/meta-campaign-builder/pull/361) | `perf(venue-page): narrow loader filters event_code at the SQL layer` | yes |
| PR-B | [#362](https://github.com/matas-offpixel/meta-campaign-builder/pull/362) | `perf(dashboard): loading.tsx skeletons + per-tab Suspense islands` | yes |
| PR-D | [#363](https://github.com/matas-offpixel/meta-campaign-builder/pull/363) | `perf(audience-builder): DB-backed source cache + maxDuration=60 + prewarm` | yes |
| PR-E | [#364](https://github.com/matas-offpixel/meta-campaign-builder/pull/364) | `perf(cron): drop Meta crons to 3x/day + show-week-burst at 5-6x` | yes |
| PR-F | [#365](https://github.com/matas-offpixel/meta-campaign-builder/pull/365) | `perf(cron): stretch Meta cron stagger to 90-min window` | yes |

**Load-bearing assumptions held:**

- Two Meta retry policies in `lib/meta/client.ts` untouched.
- `CREATIVE_BATCH_SIZE` and `AD_INSIGHT_CHUNK_CONCURRENCY`
  unchanged.
- Snapshot write contract (`writeActiveCreativesSnapshot` /
  `writeShareSnapshot` refusing on `kind: "skip" | "error"`)
  unchanged.
- `proxy.ts` not renamed.
- All 6 PRs opened from fresh `main` and squash-merged.
- Service-role client used for all snapshot reads + the new
  `audience_source_cache` reads/writes.
- Migration 087 ships a `build_version` column on the new cache
  table; reader treats mismatched/NULL as stale (same shape as
  `active_creatives_snapshots` mig 067).

**Migration application:** `supabase/migrations/087_audience_source_cache.sql`
(renumbered from the `080` slot in the prompt because `080–086`
are taken). The DB cache helper soft-fails if the table doesn't
exist yet — Audience Builder keeps working without persistence
gain — so PR-D was safe to merge ahead of the migration apply.
**Migration still needs to be applied via Supabase MCP / dashboard
SQL editor before the cache benefit kicks in.** The local agent
shell does not have a Supabase CLI / DB connection string, so
this is the one manual step.

**Cron schedule (final):**

```
sync-ticketing            00 6,10,14,18,22  (5×, unchanged)
refresh-creative-insights 30 6,12,18        (3×)
rollup-sync-events        00 7,13,19        (3×, +30 from insights)
refresh-active-creatives  30 7,13,19        (3×, +30 from rollup)
show-week-burst           00 9,15,21        (3×, only events <7d out)
```

Per-account Meta call density per hour drops by ~3× (90-min
stagger inside the base cycle) and steady-state Meta calls/day
drop by ~30–40% (cron cadence reduction). Show-week events keep
5–6×/day refresh via the burst leg.

**Pending verification (post-deploy):**

- Capture before/after Vercel Analytics timing for client
  dashboard, venue page, patterns page, audience builder open,
  audience video-views fetch.
- Confirm Vercel Cron settings page reflects the new schedule.
- Sanity-check 24h post-deploy: cron logs continue to show
  `all_ok=true`, no clusters of Meta retries within a single
  60-min window.
- Apply migration 087 via Supabase MCP to unlock the audience
  source DB cache.
