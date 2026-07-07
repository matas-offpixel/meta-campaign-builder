# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/d2c-event-dashboard-v1`

## Summary

D2C event dashboard v1. Fixes the `/d2c/event/[id]` 404 for cross-operator
events, adds a full per-event operator dashboard (event basics + external
signup stats + all scheduled sends with live email/WhatsApp previews +
approver actions), and a public read-only share URL (`/share/d2c/{token}`).

## Root cause — the 404

The operator page loaded the event through `getEventByIdServer`, which runs
under the **user's RLS-scoped session client**. The `events` RLS policy is
owner-scoped (`user_id = auth.uid()`). The Throwback event
(`8194ab57-…`) is owned by matt@ but was being viewed by matas@ (a D2C
approver, not the owner) → the RLS query returned zero rows → `notFound()`.
It was never the PostgREST JOIN on nullable `meta_*` columns.

**Fix:** load the dashboard through a **service-role client**
(`loadD2CEventDashboard`, bypasses RLS) and enforce authorization explicitly
in the page: `if (!isApprover && event.user_id !== user.id) notFound()`.
Cross-operator visibility for approvers, no data leak to anyone else.

## Scope / files

- `app/(dashboard)/d2c/event/[id]/page.tsx` — rewritten: service-role load +
  owner-or-approver gate, stats, share state, renders `EventDashboard`.
- `app/share/d2c/[token]/page.tsx` — **new** public read-only route; rate
  limited (60/min/IP, mirrors LP page), token shape-guard, `after()` access
  bump. `/share/*` is already in `PUBLIC_PREFIXES`.
- `lib/db/d2c-dashboard.ts` — **new** service-role dashboard loader
  (`event` + copy + sends + preview templates). `D2CPreviewTemplate` fixes the
  `variables_jsonb` object shape (button label/url) that `mapD2CTemplate` drops.
- `lib/d2c/stats.ts` — **new** external signup counts: Mailchimp members by
  tag (segments → member_count), Bird contacts by tag (lists match), LP
  `event_signups` count; aggregated + 60s in-memory cache.
- `lib/d2c/dashboard-view.ts` — **new** pure presentation seams (job labels,
  status/approval pills, channel visuals, timeline bar math, markdown split,
  share-url builder). Unit tested.
- `lib/d2c/share-token.ts` — **new** 32-char URL-safe token gen + shape guard
  (injectable randomness). Unit tested.
- `lib/db/d2c-shares.ts` — **new** service-role CRUD for `d2c_event_shares`.
- `lib/actions/d2c-share.ts` — **new** `createShare` / `revokeShare` server
  actions (owner-or-approver gated).
- `lib/actions/d2c-sends.ts` — **new** approve / reject / cancel / toggle
  dry-run server actions (approver gated).
- `components/dashboard/d2c/` — **new** `event-dashboard.tsx` (shared body,
  read-only aware), `send-preview.tsx` (email + WhatsApp mockups),
  `timeline-strip.tsx`, `send-actions.tsx`, `share-panel.tsx`.
- `supabase/migrations/141_d2c_event_shares.sql` — **new** share table + token
  index + owner RLS.

## Validation

- [x] `npm run build` — passes (exit 0); `/share/d2c/[token]` +
  `/d2c/event/[id]` registered.
- [x] `node --test` — 19 pass (dashboard-view + share-token).
- [x] ESLint clean on all changed files.
- [x] Route probes (dev server): `/login` 200; operator page (unauth) 307 →
  `/login`; `/share/d2c/{unknown|malformed}` → 404 (public, correct guard).
- [x] Live pipeline probe (service role + real APIs, since authenticated
  browser needs operator creds):
  - Goal 1: event loads via service role (owner matt / viewer matas → RLS
    root cause confirmed; fix gate lets approver matas through).
  - Goal 2a Mailchimp: authenticates, enumerates 19 segments; configured tag
    `T26-ALGARVE` not yet created in Mailchimp → correct graceful
    `error: 'Tag not found'`.
  - Goal 2b Bird: matches list `T26-ALGARVE` → count 0.
  - Goal 2c LP: 0 (D2C-only event, no landing page). LP card hidden when 0.

## Notes

- **Migration 141 NOT applied** — Supabase MCP timed out (same outage as the
  admin-dashboard sessions). The migration file is committed; apply it in prod
  before the share feature is usable. Until then the code degrades gracefully:
  share reads catch the missing-table error and return null (share panel shows
  "Generate share link"; generating fails with a friendly message; public
  tokens 404). **No 500s.**
- Authenticated browser render (operator dashboard populated, share
  generate/copy/revoke round-trip, incognito share view) not performed — the
  operator login is magic-link/password and no operator session was available
  locally. Data + external-API pipeline verified directly instead (above);
  markup mirrors shipped admin patterns.
- pgcrypto untouched. Public share exposes only aggregated counts — no
  individual signup PII.
- Per-client CTA theme colour defaults to Throwback pink (`#c81c68`);
  threaded as a `themeColor` prop for later per-client wiring.
