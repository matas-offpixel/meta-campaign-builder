# PR A — Route prefetch coverage on dashboard navigation

**Tag:** `[Cursor, Opus]` *(Opus reasoning needed for the audit; mechanical execution)*
**Branch:** `cursor/perf/route-prefetch-coverage`
**Scope target:** ~5-10 files, single PR
**Prereq:** PR #641 merged (already done)

## Why this PR

Matas's complaint: every navigation in the dashboard takes 2-3s. Examples named:
- Switching between regions on the 4thefans dashboard
- Navigating between Clients → Events → Campaigns → Asset Queue
- Switching tabs within a client console

Root cause: Next.js 16's default `<Link>` prefetch only fires for links **in viewport** in production. Tabs in scrolled regions, programmatic navigation via `router.push`, and dropdown-hidden links all skip prefetch entirely. Audit confirmed: only **one** `prefetch={...}` use exists in the codebase and it's set to `false`. Every other Link relies on Next defaults.

This PR makes the highest-traffic navigation paths prefetch eagerly. Mechanical, low-risk, no architecture change.

## Paste this into Cursor (Opus)

```
GOAL
Add aggressive route prefetching to the highest-traffic dashboard navigation surfaces so tab switching, region switching, and cross-surface navigation feel near-instant. Pure mechanical refactor — no new architecture, no data layer change, no migration. Single PR.

GROUNDING (DO NOT INVENT — VERIFIED 2026-06-30)
- Next.js 16 default <Link> behaviour: prefetches when in viewport in production, NOT in dev. Programmatic navigation (router.push, router.replace) NEVER prefetches without explicit router.prefetch() call.
- Audit confirmed: only ONE prefetch={...} prop exists in app/ + components/ today (components/share/venue-report-header.tsx line 400, set to FALSE). Every other Link uses defaults.
- 68 files in app/ + components/ import "next/link". 19 files use router.push for programmatic navigation.
- Matas's specific complaints: regions on 4thefans dashboard, tabs within /clients/[id], cross-surface (Clients → Events → Campaigns → Asset Queue).
- The "high-traffic" surfaces (focus PR here):
  - components/dashboard/dashboard-nav.tsx (top-level nav)
  - components/dashboard/clients/client-detail.tsx (per-client tabs)
  - components/dashboard/clients/clients-list.tsx (client picker)
  - app/(dashboard)/clients/[id]/page.tsx (tab bar)
  - Any region selector on 4thefans dashboard — grep for "venue-region" or "region-select" inside components/dashboard/

WHAT TO BUILD

1. AUDIT FIRST (do not skip): grep all <Link> usages in app/(dashboard)/ and components/dashboard/. List in PR description which ones land in the "high-traffic dashboard nav" bucket vs "one-off action links" vs "external links". The bucket determines the fix.

2. For HIGH-TRAFFIC NAV LINKS (tab bars, region selectors, primary navigation):
   - Add prefetch={true} explicitly. Even though Next 16 defaults to viewport-prefetch in prod, explicit prefetch on a tab bar that may be partially off-screen or behind a scroll guarantees it.
   - Add onMouseEnter handler that calls router.prefetch(href) — gives sub-100ms feel on hover-then-click. Use the useRouter hook from next/navigation.
   - The onMouseEnter prefetch is the killer feature — Vercel docs call this out as the standard pattern for "feel-instant" navigation.

3. For PROGRAMMATIC NAVIGATION (the 19 files using router.push):
   - In components that have predictable next-route (e.g. wizard-stepper.tsx going step N → N+1, plan-actions.tsx going to /events/[id], client-detail.tsx tab routing), add router.prefetch() at the point the next route becomes known (e.g. on form completion, on data load, on initial render).
   - Skip if the next-route is not predictable until click time.

4. Identify the 4thefans regions selector specifically (grep "venue" + "region" in components/) and ensure region links use both prefetch={true} AND onMouseEnter prefetch. This is the surface Matas specifically named.

5. Do NOT add prefetch to:
   - External links (next/link with absolute URLs)
   - Sign-out buttons (the prefetch is wasted)
   - Action buttons disguised as Links
   - Anything inside the share/* surface (public client reports — different traffic pattern, prefetch could spike Vercel usage)
   - The single existing prefetch={false} in components/share/venue-report-header.tsx — leave it alone, it's intentional.

CONSTRAINTS
- No new dependencies, no new env vars, no migration.
- No changes to data fetching code.
- No changes to server components beyond adding prefetch hints to Links.
- Match existing TypeScript strict mode, ESLint config, import patterns.
- DO NOT touch the Remotion provider (lib/creatives/remotion/*) — separate sprint.
- DO NOT touch crons or cron route handlers — separate sprint.
- DO NOT add a new shared layout — that's PR B of this perf sprint, separate PR.
- DO NOT add a snapshot cache — that's PR C of this perf sprint, separate PR.
- One PR per concern — this is the prefetch PR only.

VALIDATION GATE
- npm run build: exit 0.
- npm run lint: clean on touched files.
- Existing tests pass.
- Manual smoke (must be done before requesting review):
  - Local dev (npm run dev), open /clients/{4thefans-id}.
  - Click between regions. Observe DevTools Network tab. Confirm region routes are PREFETCHED (request status "preflight" or initial RSC fetch should appear on hover, before click).
  - Navigate Clients → Events → Campaigns → Asset Queue. Each navigation should feel instant if prefetch is firing on hover.
  - The PR description must include before/after navigation timings on at least 3 surfaces:
    * Region switch on 4thefans dashboard
    * Tab switch within /clients/[id]
    * Cross-surface: Clients → Events
  - Capture timings via DevTools Performance tab (record interaction, find the "Load" event in the timeline) or via the Vercel Speed Insights API timing if available.

PR DESCRIPTION MUST INCLUDE
- Before/after navigation timings for the 3 surfaces named above.
- List of every <Link> touched, categorised (high-traffic / programmatic / external).
- List of every router.prefetch() call added, with the trigger event (mount / form-complete / hover).
- Confirmation that share/* surfaces were NOT modified (they have a deliberately conservative prefetch policy).
- Note any surface where prefetch couldn't be added (e.g. links generated dynamically in a list — explain why).

ASK BEFORE DOING IF
- A nav surface looks "high-traffic" but uses programmatic navigation in a way that makes prefetch impossible (e.g. dynamic href computed from form state). Surface, don't invent a workaround.
- The 4thefans regions selector is not in components/dashboard/ — surface the actual file path.
- onMouseEnter prefetch on a list of many links (e.g. client list with 50 entries) would mass-prefetch and bloat the user's network. Surface so we can debounce or skip.

OUT OF SCOPE — DO NOT BUILD HERE
- Shared layout / context for client portal data (PR B).
- Snapshot cache for portal payload (PR C).
- TanStack Query or any client-side caching primitive.
- Suspense streaming.
- Asset queue load issue (separate diagnosis).
- Anything Remotion / cron / migration related.
```

## After Cursor opens the PR

1. Verify the before/after timings in the PR description are real (not "felt faster" claims).
2. If region switching dropped from 2-3s to <500ms, ship.
3. If not, the prefetch wasn't the binding constraint — proceed to PR B (shared layout) which is the structural fix.
4. Memory write after merge: `project_perf_prefetch_coverage_shipped_2026-XX-XX.md` documenting which surfaces got prefetch and the measured impact.

## Why this is PR A not PR B

The audit showed only one explicit prefetch prop in the codebase. That means Next.js's default behaviour is doing all the lifting today, and a lot of it is missing prefetch in places the defaults don't cover. **Mechanical fix-first, then assess if the architectural fix (shared layout) is still needed.** Possible PR A alone closes 80% of the perceived-slow gap and PR B/C become deprioritised.

Honest read: if prefetch alone fixes it, you save 7+ hours of Opus credits.
