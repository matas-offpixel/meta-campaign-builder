# Session log

## PR

- **Number:** 643
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/643
- **Branch:** `cursor/perf/dashboard-prefetch`

## Summary

Perf sprint PR A (prefetch only). Adds aggressive, hover-driven route
prefetching to the highest-traffic dashboard navigation surfaces so tab/region
switching and cross-surface navigation feel near-instant. Pure mechanical
refactor — no data-layer change, no migration, no new deps, no shared layout
(PR B) and no snapshot cache (PR C).

The core mechanic: a small client primitive `HoverPrefetchLink` that sets
`<Link prefetch>` AND calls `router.prefetch(href)` on `onMouseEnter`. The hover
call is what actually warms a `force-dynamic` route's RSC payload (plain
`prefetch` only fetches up to the loading boundary), which is exactly the case
for the 4thefans `/clients/[id]/dashboard` region/tab routes.

## Scope / files

**New primitive**
- `components/dashboard/_shared/hover-prefetch-link.tsx` — `<Link>` wrapper with
  `prefetchOnHover` (default `true`; pass `false` to fall back to Next defaults,
  used for the public share surface). Usable inside server-component nav bars
  that can't call `useRouter` directly.

**High-traffic nav links (prefetch + onMouseEnter)**
- `components/dashboard/dashboard-nav.tsx` — every sidebar link (Today, Overview,
  Calendar, Clients, Events, Campaigns, Reporting, Invoicing, TikTok, Google Ads,
  Audience Builder, Audience Seeds, Creatives, Venues, Artists, Settings): added
  `prefetch` + `onMouseEnter={() => router.prefetch(item.href)}`. Sign-out button
  left untouched (wasted prefetch).
- `components/dashboard/dashboard-tabs.tsx` — the **4thefans region selector**
  `<Link>`s → `HoverPrefetchLink` with `prefetchOnHover={!isShared}`. Sub-tab bar
  gets `prefetchOnHover={!isShared}` threaded through.
- `components/dashboard/clients/sub-tab-bar.tsx` — dashboard sub-tabs
  (Events / Creative Insights / Funnel Pacing) now render via `HoverPrefetchLink`
  with an optional `prefetchOnHover` prop (default `false` → unchanged for share).
- `components/dashboard/clients/client-detail.tsx` — "All clients" breadcrumb and
  "View dashboard" Link → `prefetch` + `onMouseEnter`.

**Programmatic navigation (router.prefetch on hover; onClick unchanged)**
- `components/dashboard/clients/client-detail.tsx` — PageHeader action buttons
  (Dashboard, Rollout, Creative Patterns, Edit) → `onMouseEnter` `router.prefetch`
  of their `router.push` target (hrefs predictable from `client.id` at render).
- `components/dashboard/clients/clients-list.tsx` — "New client" button →
  `onMouseEnter router.prefetch("/clients/new")`.
- `components/dashboard/events/events-list.tsx` — "New event" button →
  `onMouseEnter router.prefetch("/events/new")`.

**Targeted list hover-prefetch (NO mass `prefetch={true}` on list rows)**
- `components/dashboard/clients/clients-list.tsx` — client rows →
  `onMouseEnter router.prefetch(/clients/${c.id})`.
- `components/dashboard/events/events-list.tsx` — event rows →
  `onMouseEnter router.prefetch(/events/${ev.id})`.
- `components/dashboard/overview/overview-table.tsx` — event rows →
  `onMouseEnter router.prefetch(/events/${row.event_id})`.

## Link audit / categorisation

- **High-traffic nav** (prefetch added): sidebar nav (16 links), region selector,
  dashboard sub-tabs, client-detail breadcrumb + "View dashboard".
- **Programmatic nav** (router.prefetch on hover): client-detail header buttons
  (Dashboard/Rollout/Creative Patterns/Edit), New client, New event.
- **List rows** (targeted hover-prefetch, no viewport mass-prefetch): clients-list,
  events-list, overview-table.
- **One-off / action links — NOT touched**: TikTok view/new links, refresh/sync
  action buttons, link-discovery, edit/new form pages.
- **External links**: none in the touched nav surfaces.

## Deliberately NOT touched (with reasons)

- **Per-client tabs** (`client-detail.tsx` Overview/Events/Ticketing/D2C/Campaigns/
  Creatives/Invoicing/Asset Queue) — these are **local React `useState`**
  (`<Tabs onTabChange={setActiveTab}>`), NOT route navigation. They already switch
  with zero network, so prefetch is N/A. (Matas's "tabs feel slow" is the initial
  server load, addressed by PR #641 / PR B/C — not a nav-prefetch problem.)
- **`components/share/*`** — public client reports, conservative prefetch policy.
  The shared `dashboard-tabs` + `sub-tab-bar` guard all new prefetch behind
  `prefetchOnHover={!isShared}`, so `/share/client/[token]` keeps Next defaults.
  The existing `prefetch={false}` in `components/share/venue-report-header.tsx`
  is left intact.
- **Sign-out button** (`dashboard-nav.tsx`) and **destructive nav** (client delete
  → `/clients`) — prefetch wasted / not hover-predictable.
- **`components/wizard/*`** (e.g. wizard-stepper N→N+1) — READ ONLY for the
  dashboard thread per repo boundaries. Deferred; the predictable next-step
  prefetch belongs in a wizard-owned PR.

## Could not add (surfaced, not worked around)

- The region selector lives in a **server component** (`dashboard-tabs.tsx` renders
  async server children), so `onMouseEnter` + `router.prefetch` couldn't be added
  inline. Resolved by the `HoverPrefetchLink` client primitive rather than
  converting the async server component to a client component.

## Validation

- [x] `npm run build` — exit 0.
- [x] `npm run lint` — clean on all 8 touched files.
- [x] `npm test` — 2293 pass / 13 fail, identical to clean tree. The 13 are
      pre-existing `ERR_MODULE_NOT_FOUND: '@/lib'` failures in the bare-node
      test runner (no `@/` alias resolution) — **zero new failures**.
- [ ] **Manual DevTools timings — NEEDS HUMAN.** The dashboard is auth-gated
      (307 → `/login`) and this automated environment has no Supabase session, so
      the before/after Network/Performance capture on the live surfaces could not
      be run here. Repro for a human (authenticated, `npm run dev`):
      1. Open `/clients/{4thefans-id}`. DevTools → Network, filter `RSC`.
      2. **Hover** a region tab on `/clients/{id}/dashboard` — an RSC request for
         `?region=…` should fire on `mouseenter`, before click. Click → near-instant.
      3. **Hover** sidebar Clients → Events → a row → Campaigns tab. Each hovered
         destination prefetches; clicks should feel instant.
      4. Record the "before" (git stash this branch) vs "after" navigation time via
         the Performance panel "Load" event for: region switch, dashboard sub-tab
         switch, and Clients-list row → `/clients/[id]`.

## Notes

- `<Link prefetch>` in Next 16 viewport-prefetches in prod but not dev, and never
  for `router.push`; the `onMouseEnter router.prefetch` is the piece that makes
  dynamic-route nav feel instant and works in dev too.
