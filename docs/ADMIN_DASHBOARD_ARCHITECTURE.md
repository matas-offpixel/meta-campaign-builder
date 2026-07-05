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

## 6. Server-action pattern (established in Phase 2)

Every admin write follows the same three-layer shape:

1. **Pure validation + payload builder** in `lib/admin/*-schema.ts` — no
   Next/Supabase imports, exhaustively unit-tested (including hostile
   inputs: CSS injection into theme values, `javascript:` URLs, http
   where https is required).
2. **Server action** in `lib/actions/*` — `"use server"`, calls
   `requireClientContext()` FIRST, targets ONLY the caller's own
   `client_id` (never an id from the form payload), writes via the
   service-role client (member RLS is SELECT-only).
3. **Client form component** in `components/admin/*` — `useActionState`,
   inline per-field errors, pending/saved states.

Phase 2 (`/settings`): `parseBrandingForm` / `buildBrandingUpdate` in
`lib/admin/branding-schema.ts` + `updateClientBranding` action. The
brand color is the ONE theme key the client surface owns —
`buildBrandingUpdate` merges it into the existing `theme` jsonb without
flattening operator-authored keys, and clearing it deletes the key so
the renderer's `DEFAULT_ACCENT` chain applies.

Phase 3 (`/pages`): `lib/admin/page-event-schema.ts` (validation,
London-wall-time ↔ UTC conversion, content-jsonb merge that preserves
keys the form doesn't own, storage path builder) +
`lib/actions/update-page-event.ts` (create both flows / save / archive /
image upload / remove / reorder — every action resolves the target page
through `resolveOwnedPage`, a single join proving `events.client_id`
matches the session's client, so a forged pageId 404s identically to a
missing one). Reads for the list/editor live in `lib/db/client-admin.ts`
(session client + member RLS).

Phase 3 details worth knowing:

- **Status lifecycle** — `draft` / `live` / `archived` (select in the
  editor; Delete in the list = archive). Phase 3 also added the PUBLIC
  gate: `resolveLandingPageOutcome` returns null (404) for non-live
  pages, and `processSignup` 404s before writing, so draft/archived
  pages neither render nor collect PII. Before this, status was
  schema-only and every page rendered regardless.
- **Datetimes** are entered as UK wall time (`datetime-local`) and
  stored UTC — `londonWallTimeToIso` / `isoToLondonWallTime` are
  DST-correct via `Intl` (no date library).
- **Images** upload through the server action to the
  `landing-page-assets` bucket under
  `{client_id}/{page_event_id}/{kind}-{ts}.{ext}`; jpeg/png/webp only,
  8 MB cap. Artwork replace deletes the palette so the fan renderer's
  lazy pipeline (PR #670) re-extracts on next view. Hero/bottom
  reorder is up/down buttons (deliberate cut from the brief's
  drag-and-drop — reliable overnight beats fancy).
- **Autosave** — 800 ms debounce on text inputs, immediate flush on
  select/checkbox changes, sticky saved/error bar. New-event create
  auto-slugs from the name (collision → 6-char suffix retry, one
  attempt, then a form error).

Phase 4 (confirmation card): the ONE sanctioned fan-renderer change.
`lib/landing-pages/confirmation.ts` is the pure resolver —
`getConfirmationCardConfig(content)` reads `confirmation_body` /
`confirmation_cta_label` / `confirmation_cta_url` from the content
jsonb, clamps to 200 / 24 chars, requires http(s) on the URL, and
requires BOTH label+URL for a CTA (half-configured → no button). The
view model (`lib/landing-pages/view.ts`) carries the resolved config to
`SignupForm`, whose success card now branches:

- custom body present → replaces the "you're in." heading + presale
  notify line; `\n` renders as paragraph breaks (mono 12px / 1.6).
- CTA present → palette-accent primary button (casing preserved, opens
  new tab), Share demotes to the secondary outlined slot.
- neither → pre-Phase-4 card, byte-identical behaviour.

Admin side: three fields in the editor's "Confirmation message" section
(between Countdown and Brand socials). `parsePageEventForm` enforces the
same limits server-side and rejects half-CTAs with a per-field error;
blank fields delete the content keys so the renderer falls back to
default. One editor gotcha: because autosave fires per-field, typing a
CTA label then pausing before the URL triggers a validation error state
until the URL lands — harmless (nothing saves), but the inline error is
why both fields should be pasted together.

Phase 5 (`/fans`): the fan data table + CSV export. Pure logic in
`lib/admin/fans-query.ts` — query-string → validated `FanFilters`, a
serialisable QUERY PLAN (`buildFanQueryPlan`) the db layer replays onto
the PostgREST builder (tests byte-diff the plan with no client), and
RFC-4180 CSV generation with a spreadsheet formula-injection guard.
Data layer `lib/db/fan-signups.ts` is the ONE client-admin read module
on the SERVICE-ROLE client, because decryption is service_role-only by
design; compensating contract: clientId comes from
`requireClientContext()` and `.eq("client_id", clientId)` is pinned
before any user-controlled filter.

Phase 5 details worth knowing:

- **Batch decryption** — migration 138 adds
  `landing_page_decrypt_batch(bytea[], text)` (order- and
  null-preserving), so a 50-row page costs 2 RPCs (emails + phones)
  instead of 100. Same posture as 134: SECURITY DEFINER,
  `search_path = public, extensions`, service_role execute only.
- **Search semantics** — PII is encrypted, so no SQL LIKE over
  email/phone. `@`-bearing input → exact match via the salted
  `hashEmail` (same normalisation as the write path); anything else →
  ilike over `ig_handle`/`tt_handle` (plaintext by design). Phone
  search is unsupported and the UI says so.
- **Consent filter targets the WhatsApp opt-in**
  (`consent_wa_opt_in_at`), not the brief's "opted-in/declined" —
  marketing consent (`consent_gdpr_at`) is REQUIRED at signup, so every
  canonical row has it and filtering on it is meaningless.
- **Canonical rows only** — repeat signups
  (`deduplicated_signup_id` not null) are attribution-only rows with no
  PII and are excluded from the table and CSV.
- **Delete is a soft delete** (`deleted_at`, column from migration 137);
  every read filters `deleted_at is null`.
- **CSV export** is a route handler
  (`/admin/{slug}/fans/export?same-filters`) rather than a server
  action — downloads need real response headers. Auth contract is
  identical (proxy + `requireClientContext` + client-pinned query).
  Export cap: 10k rows.

Phase 6 (`/insights`): signup analytics. Pure aggregation in
`lib/admin/insights.ts` (metrics cards, zero-filled 30-day series,
country breakdown with Other bucket, IG/TT split — all bucketed by
EUROPE/LONDON days, `now` injected for tests); non-PII rows fetched on
the session client (`listInsightRows` in `lib/db/client-admin.ts`,
canonical + non-deleted only). Charts are hand-rolled server-component
SVG (`components/admin/insight-charts.tsx`) — recharts is NOT in this
repo's deps (same call as the dashboard's ticket-pacing card) and the
no-new-deps rule holds. `?event={id}` scopes every panel to one page.

Phase 6 details worth knowing:

- **Opt-in rate is the WhatsApp opt-in** (same reasoning as the Phase 5
  consent filter — marketing consent is required at signup, so its
  "rate" is always 100%).
- **Meta Pixel health** shows config state only (pixel id, CAPI token
  presence, test/live mode, `meta_pixel_id_verified_at`): CAPI outcomes
  are not persisted anywhere (fire-and-forget, fbtrace ids only in
  logs), so "last successful event / errors last 24h" from the brief
  has no data source yet. A `capi_event_log` table is the follow-up if
  Matas wants it.
- **No rollup table, no cache** — aggregation is in-memory over a
  single indexed select ((client_id, created_at) index from migration
  134). Revisit if a client crosses ~50k signups.

Phase 7 (`/integrations/meta-pixel`): self-service Pixel + CAPI setup,
replacing the operator SQL flow (`select set_landing_page_capi_token`).
Pure validation in `lib/admin/meta-pixel-schema.ts` (15–16 digit pixel
id, TEST\d+ code, short-token truncation guard, keep/set/clear token
tri-state) + `lib/actions/meta-pixel.ts`.

Phase 7 details worth knowing:

- **Token hygiene** — the raw token exists only in the action scope on
  its way into `set_landing_page_capi_token` (in) or out of
  `get_landing_page_capi_token` into the Graph URL (out). Never logged,
  never in action state, never a defaultValue; the UI shows a
  configured/not-configured badge only. Blank input = keep; explicit
  checkbox = clear.
- **"Send test event"** reuses the REAL signup pipeline
  (`buildCapiEventPayload` + `sendCapiEvent`) with event id
  `test-{uuid}`, `source: admin-test-event`, and the logged-in client
  user's email hashed into user_data. Success stamps
  `meta_pixel_id_verified_at`; failure surfaces Meta's error + fbtrace
  inline and does NOT stamp.
- **Changing/clearing the pixel id nulls `meta_pixel_id_verified_at`**
  — verification belongs to a (pixel, token) pair.
- **Key locality landmine** — `LANDING_PAGES_TOKEN_KEY` in a local
  `.env.local` differs from prod's, so prod-encrypted token blobs fail
  local decryption with "Wrong key or corrupt data". Expected; prod
  encrypt/decrypt both use the prod key.

Phase 8 (`/integrations/bird`, `/integrations/mailchimp`): self-service
CRM credential entry over the EXISTING `d2c_connections` table +
`set_d2c_credentials` / `get_d2c_credentials` RPCs (migrations 030/042)
— no new schema. Pure validation in `lib/admin/crm-schema.ts`, DB access
in `lib/db/crm-connections.ts`, actions in
`lib/actions/crm-connections.ts`.

Phase 8 details worth knowing:

- **Credential blob shapes are provider contracts** — Bird `{ api_key,
  workspace_id, channel_id, template_project_id?, template_version_id? }`,
  Mailchimp `{ api_key, server_prefix, audience_id? }`. These are exactly
  what `lib/d2c/{bird,mailchimp}/provider.ts` read at send time; the
  byte-shape is pinned in `crm-schema.test.ts`. The Mailchimp server
  prefix is derived from the key's `-dc` suffix, never typed by hand.
- **API keys are write-only tri-state** (blank = keep, paste = replace)
  like the Phase 7 CAPI token. `set_d2c_credentials` REPLACES the blob,
  so a keep-save decrypts the existing blob server-side and carries the
  old key into the new blob. Reads return only `toPublicConfig` (key →
  boolean).
- **RLS asymmetry** — `d2c_connections` policies key on the OPERATOR's
  user_id (migration 030), so client-admin sessions can't see the rows.
  All access goes through the service-role client after
  `requireClientContext()`, with the client_id filter applied in
  `lib/db/crm-connections.ts` (same pattern as fan-signups). Existing
  rows keep their operator user_id on update; only brand-new connections
  are owned by the client user.
- **"Test connection" is read-only** — Bird `GET
  /workspaces/{id}/channels`, Mailchimp `GET /3.0/ping` via each
  provider's `validateCredentials`. A real HTTP round trip that proves
  decrypt → auth header → API, without any message send. Outcome is
  recorded on the row (`status`/`last_error`/`last_synced_at`).
- **Clients cannot go live from here.** `live_enabled` +
  `approved_by_matas` (+ `FEATURE_D2C_LIVE`) stay operator-controlled;
  the status panel shows them read-only.

## 7. Phase log

| Phase | Scope | PR | Status |
|---|---|---|---|
| 1 (P0) | Auth + route scaffold + migration 137 | #675 | shipped |
| 2 (P0) | Org/brand settings editor | #676 | shipped |
| 3 (P0) | Landing page CRUD | #677 | shipped |
| 4 (P1) | Confirmation card editor + renderer | #678 | shipped |
| 5 (P1) | Fan data table + CSV export | #679 | shipped |
| 6 (P1) | Analytics dashboard | #680 | shipped |
| 7 (P2) | Meta Pixel + CAPI self-service | #681 | shipped |
| 8 (P2) | Bird + Mailchimp integrations UI | | this PR |
| 9 (P2) | Turnstile invisible-mode audit | | pending |
| 10 (P2) | LP editor preview mode | | pending |
