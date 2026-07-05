# Session log — client admin dashboard Phase 1: auth + scaffold (OP909)

## PR

- **Number:** 675
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/675
- **Branch:** `cursor/admin-p1-auth-scaffold`

## Summary

Phase 1 of the overnight client-admin-dashboard arc (OP909). A client can
now log in at `/admin/login` (magic link, invite-only), land on
`/admin/{their-slug}` and see their landing pages + fan counts. The
authorisation pivot is the new `client_users` table (migration 137 — the
arc's ONE migration, also carrying the Phase 2/3/5 schema so later phases
are code-only): session + membership + slug match enforced BOTH in the
proxy and via `requireClientContext()` at the top of every admin server
surface. Cross-tenant probes get an explicit 403, never a redirect.

## Scope / files

- `supabase/migrations/137_client_admin_dashboard.sql` — `client_users`
  (+ self-read RLS + GMC seed), 5 additive client-member SELECT policies,
  `client_landing_pages.brand_*_url_default`, `event_signups.deleted_at`,
  `landing-page-assets` storage bucket, verification block.
- `lib/auth/admin-routes.ts` — /admin path classification (public /
  operator / client-scoped) for the proxy.
- `lib/auth/client-context.ts` — pure membership-resolution core (DI,
  node:test-able) + `ClientScopeError`.
- `lib/auth/get-client-context.ts` — `requireClientContext()` server
  entrypoint (session → membership → slug assert).
- `lib/supabase/proxy.ts` — /admin branch: public paths, operator
  carve-outs, membership lookup, bare-/admin redirect, 403 on mismatch.
- `app/admin/login/page.tsx` — magic-link login (no Turnstile; Supabase
  OTP limits cover it).
- `app/admin/auth/callback/route.ts` — code exchange mirroring
  /auth/callback, failures → /admin/login?error=auth.
- `app/admin/[clientSlug]/layout.tsx` — shell layout (deviation from the
  brief's `app/admin/layout.tsx`: the [clientSlug] level keeps
  /admin/login + operator pages chrome-free).
- `app/admin/[clientSlug]/page.tsx` — dashboard home (metric cards +
  pages table with signup counts).
- `app/admin/[clientSlug]/{pages,fans,insights,integrations,settings}/page.tsx`
  — auth-gated placeholders (Phases 2–8 replace them).
- `components/admin/admin-shell.tsx` — sidebar + top bar chrome
  (functional aesthetic, NOT Supreme).
- `components/admin/coming-soon.tsx` — placeholder body.
- `lib/db/client-admin.ts` — session-client read helpers (pages list +
  signup counts; RLS-scoped, no service-role).
- Tests: `lib/auth/__tests__/admin-routes.test.ts` (path classification),
  `lib/auth/__tests__/client-context.test.ts` (membership happy path,
  no-membership, invariant break, embed normalisation, slug mismatch).
- Docs: new `docs/ADMIN_DASHBOARD_ARCHITECTURE.md`; CLAUDE.md routes +
  migration ledger; LANDING_PAGE_ARCHITECTURE.md cross-link.

## Validation

- [x] node:test — 33/33 in lib/auth (17 new); full suite 2665/2680 pass
      (14 failures pre-existing on main, same count both sides)
- [x] tsc --noEmit — zero errors in touched files (pre-existing repo-wide
      errors unchanged)
- [x] eslint on touched paths — 0 errors, 0 new warnings
- [x] npm run build — clean, all /admin routes compiled
- [x] Migration 137 applied to prod via the Supabase Management API
      (MCP connection timed out; same endpoint used directly). Ledger
      entry `client_admin_dashboard`. Seed: the migration warned+skipped
      (matt.liebus@gmail.com didn't exist in auth.users) — created the
      auth user via the admin API and inserted the seed row manually,
      exactly the fallback the migration documents.
- [x] RLS smoke (SQL, set_config sub): member sees exactly their own
      client's rows (1 client / 2 events / 1 page_event / 2 signups);
      a non-member authed user sees ZERO client_users rows.
- [x] Browser (dev server, GMC seed): /admin/login renders; magic-link
      callback lands on /admin/gmc-worldwide-productions; dashboard
      shows 1 page / 1 live / 2 signups + Jackies row with View live
      link; Pages placeholder loads; /admin/some-other-client returns
      403 Forbidden (not a redirect); bare /admin redirects to the
      member's slug. (A hydration warning during automation was traced
      to the browser tool's injected data-cursor-ref attributes — not
      app code.)

## Notes

- Migration 137 deliberately covers ALL admin-arc schema (Phases 1–5) per
  the brief's one-migration constraint; later phases are code-only.
- Client-member RLS is SELECT-only by design — admin writes go through
  service-role server actions gated by requireClientContext(), so no
  write surface exists on PostgREST for client sessions.
