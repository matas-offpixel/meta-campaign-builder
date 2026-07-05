# Client Admin Dashboard (OP909) — Architecture

The client-facing self-service dashboard over the landing-page product
(fan-facing renderer: see `docs/LANDING_PAGE_ARCHITECTURE.md`). Clients
(GMC, BWL, Junction 2, Louder, 4TheFans, …) log in, manage their landing
pages, see fan data, configure integrations, and tailor per-page copy —
replacing the "Matas + SQL" onboarding flow.

Built as the overnight arc of 2026-07-05. Phases ship as sequential
squash-merged PRs; the phase log at the bottom tracks what landed.

## 1. Route tree

```
/admin/login                      public — magic-link login (client users)
/admin/auth/callback              public — Supabase code exchange
/admin                            → redirect to /admin/{member's slug}
/admin/{clientSlug}               dashboard home (pages + fan counts)
/admin/{clientSlug}/pages         LP list (Phase 3)
/admin/{clientSlug}/pages/new     create page (Phase 3)
/admin/{clientSlug}/pages/{id}/edit  full content editor (Phase 3/4)
/admin/{clientSlug}/fans          fan table + CSV export (Phase 5)
/admin/{clientSlug}/insights      analytics (Phase 6)
/admin/{clientSlug}/integrations  integration hub (Phases 7/8)
/admin/{clientSlug}/settings      org/brand settings (Phase 2)
```

**Pre-existing operator pages** share the /admin namespace and are
UNCHANGED: `/admin/render-test`, `/admin/render-reel`,
`/admin/cron-health`. They are static segments (win Next.js routing
precedence over `[clientSlug]`) and the proxy treats them as
operator-internal: session required, NO client_users membership check
(see `OPERATOR_ADMIN_PREFIXES` in `lib/auth/admin-routes.ts` — keep in
sync if new operator pages are added under /admin).

## 2. Auth model

Two protected surfaces share one proxy (`lib/supabase/proxy.ts`):

| Surface | Session | Extra check | Unauth → | Wrong tenant → |
|---|---|---|---|---|
| Internal operator app | required | none | `/login` | n/a (per-user RLS) |
| Client dashboard `/admin/{slug}/*` | required | `client_users` membership, slug must match | `/admin/login` | **403** (never a redirect) |

- **`client_users`** (migration 137): maps one auth user to exactly ONE
  client (`user_id` UNIQUE). `role` is `'owner'`-only for the MVP; the
  named CHECK makes future roles one ALTER away. Rows are provisioned by
  operator SQL — no self-signup surface exists.
- **Login** is magic-link only (`shouldCreateUser: false` — invite-only,
  same posture as the operator `/login`). No Turnstile: Supabase's OTP
  rate limits cover this; Turnstile is a fan-facing `/l` concern.
- **`requireClientContext(slug?)`** (`lib/auth/get-client-context.ts`) is
  the defence-in-depth layer: called at the top of EVERY
  `/admin/{clientSlug}/*` server component and EVERY admin server action,
  before touching any resource. The proxy alone is never trusted.
  - no session → redirect `/admin/login`
  - session but no membership → redirect `/admin/login?error=no-client`
  - slug mismatch → throws `ClientScopeError` (hard failure)
- Pure core in `lib/auth/client-context.ts` (DI over a structural
  Supabase slice, mirroring `lib/landing-pages/context.ts`) so node:test
  exercises the real chain — including the multi-row invariant-break and
  cross-tenant mismatch paths — without a Supabase connection.
- An authed user on `/admin/login` with a membership is bounced straight
  to their dashboard (unless `?error=` is being displayed).

## 3. RLS map (migration 137)

Client members get **additive, SELECT-only** policies via the
`client_users` chain, alongside the existing operator
(`user_id = auth.uid()`) policies:

| Table | Policy | Chain |
|---|---|---|
| `client_users` | member reads own membership | `user_id = auth.uid()` |
| `clients` | client member reads own client | `client_users.client_id = clients.id` |
| `events` | client member reads client events | `client_users.client_id = events.client_id` |
| `page_events` | client member reads client page events | via `events.client_id` join |
| `client_landing_pages` | client member reads client landing page | `client_users.client_id` |
| `event_signups` | client member reads client signups | `client_users.client_id` |

**Writes from the admin surface are service-role only** — server actions
call `requireClientContext()` first, verify the target row belongs to
that `client_id`, then write via the service-role client. No client-member
write policies exist, so a compromised session token alone can never
mutate rows through PostgREST.

`event_signups` PII stays encrypted at rest; decryption happens only via
the existing `landing_page_decrypt` RPC (service-role execute only) in
Phase-5 server code, never client-side.

## 4. Schema (migration 137 — the arc's ONE migration)

- `client_users` — see §2. Index on `client_id` for reverse lookup.
- `client_landing_pages.brand_instagram_url_default` /
  `brand_tiktok_url_default` — Phase 2 org settings. The admin editor
  prefills per-page `content.brand_*_url` from these; the fan renderer
  keeps reading ONLY `page_events.content` (no renderer change).
- `event_signups.deleted_at` — Phase 5 soft delete. Hidden from admin UI
  + exports + analytics; the row (and dedupe hashes) survive so a
  re-signup still dedupes.
- Storage bucket `landing-page-assets` (public read, service-role write)
  — Phase 3 uploads, path convention
  `{client_id}/{page_event_id}/{purpose}.{ext}` enforced app-side.
- Seed: `matt.liebus@gmail.com` → GMC Worldwide Productions
  (`2f0dbe34-35ce-4df3-a655-32faa6a0f710`), warn+skip if the auth user
  is missing at apply time.

Any follow-up schema need goes in migration 138+ — 137 is never edited
post-apply.

## 5. Design language

FUNCTIONAL, not Supreme. This is a work tool: Tailwind tokens
(`border-border`, `bg-card`, `text-muted-foreground`), rounded corners,
lucide icons, table-heavy — the same system as the internal dashboard
(`components/dashboard/*`). The mono/Futura/zero-radius fan-facing
aesthetic stays exclusively on `/l`.

Shell: `components/admin/admin-shell.tsx` — left sidebar (Dashboard /
Pages / Fans / Insights / Integrations / Settings), client name header,
logout, mobile top bar.

## 6. Phase log

| Phase | Scope | PR | Status |
|---|---|---|---|
| 1 (P0) | Auth + route scaffold + migration 137 | #675 | shipped |
| 2 (P0) | Org/brand settings editor | | pending |
| 3 (P0) | Landing page CRUD | | pending |
| 4 (P1) | Confirmation card editor + renderer | | pending |
| 5 (P1) | Fan data table + CSV export | | pending |
| 6 (P1) | Analytics dashboard | | pending |
| 7 (P2) | Meta Pixel + CAPI self-service | | pending |
| 8 (P2) | Bird + Mailchimp integrations UI | | pending |
| 9 (P2) | Turnstile invisible-mode audit | | pending |
| 10 (P2) | LP editor preview mode | | pending |
