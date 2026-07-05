# Landing Page Architecture

**Status:** PR 2 (theming + signup form) — themed renderer, on-page signup
with encrypted PII storage, write-path defence layers. PR 1 (scaffold,
#660) shipped schema + route skeleton. This document is the reference for
PRs 3–8; anything ambiguous here becomes rework downstream, so treat it as
the contract.

**Context:** Extends the D2C automation to auto-spawn client-branded event
landing pages, replacing Evntr.ee. Trial client: GMC Worldwide Productions
(Jackies + Throwback + Petardeo umbrella). Evntr.ee stays live as redundancy
until GMC's first 2 events pass live validation on the internal renderer.

**Client self-service:** the CLIENT-facing admin dashboard over this
product (login, page CRUD, fan table, integrations — the OP909 arc,
July 2026) is documented separately in
`docs/ADMIN_DASHBOARD_ARCHITECTURE.md`. That surface reads/writes the
same tables described here via `client_users`-scoped RLS + service-role
server actions; the fan-facing renderer contract in this document is
unchanged by it.

---

## 1. Data model

Three tables (migration `132_landing_pages_scaffold.sql`). The split follows
one rule: **the client owns identity and brand; the event owns one page.**

### `client_landing_pages` — one row per client (unique `client_id`)

Client-level concerns only:

| Column | What it owns |
|---|---|
| `theme` jsonb | Brand theme. Schema defined in PR 2 (see §8): `primary_color`, `secondary_color`, `accent_color`, `bg_color`, `text_color`, `font_family`, `logo_url`, `thank_you_message`. Missing/invalid keys fall back per-key to bright defaults (`lib/landing-pages/theme.ts`). |
| `meta_pixel_id` | **The client's own Pixel** (see §2). Nullable until the client hands theirs over. |
| `meta_capi_token_encrypted` bytea | pgcrypto blob for the client's CAPI token. Reserved now, read by PR 4 accessors only. |
| `default_provider` | Stamped onto NEW `page_events` rows for this client. `'evntree'` default = safe rollout posture. |
| `created_by` | Operator (auth.users) who provisioned the row. |

### `page_events` — one row per event (unique `event_id`)

Event-level concerns only:

| Column | What it owns |
|---|---|
| `provider` | The rollback lever: `'internal'` \| `'evntree'` (§4). |
| `evntree_url` | Redirect target when `provider='evntree'`. DB CHECK `page_events_evntree_url_required` makes `evntree` + null URL unpersistable. |
| `theme_overrides` jsonb | Per-event deltas over the client theme. Merge semantics (PR 2, `resolveTheme`): event overrides client, client overrides defaults; an INVALID override falls back to the client value, then the default — never to another tenant. |
| `content` jsonb | Page content blocks. PR 2 renders: `headline`, `subtitle`, `artwork_url`, `venue_name`, `venue_city`, `event_date`, `presale_info` (all optional; event-row fields are the fallback where one exists). `events` has **no artwork column** — `content.artwork_url` is the only artwork source; missing → styled gradient placeholder. |
| `template_key` | **Promoted to a real column in migration 134** (`text NOT NULL default 'mvp_v1' references page_templates(key)`, backfilled from the jsonb). Readers prefer the column; `content.template_key` is legacy. |
| `status` | `draft` → `live` → `archived`. The route still renders drafts (Matas' pre-launch preview path); the signup API accepts them too — gate on `live` only if drafts ever leak publicly. |

> ~~Judgment call (PR 2 must resolve): template binding lives at
> `content.template_key`…~~ **Resolved in PR 2:** migration 134 added the
> real `template_key` column with FK + backfill, exactly as prescribed.

### `event_signups` — fan signups (migration 134, PR 2)

One row per signup ATTEMPT; per-fan-per-event uniqueness is enforced on
canonical rows only (see §8 dedupe). PII columns `email_encrypted` /
`phone_encrypted` are pgcrypto blobs; `email_hash` / `phone_hash` are
salted sha256 for dedupe-without-decryption; `ip_hash` only (raw IP never
stored). `client_id` is denormalised for RLS/isolation and a BEFORE trigger
(`event_signups_client_match`) enforces it equals `events.client_id` —
a tenant mismatch is unpersistable. RLS: owner SELECT via the events chain;
**no write policies** — the only write path is the API route's
service-role client.

### `page_templates` — workspace-global registry

`key` (unique, e.g. `mvp_v1`), `name`, `block_types_supported` jsonb array,
`default_config` jsonb, `version` int. Seeded with `mvp_v1` supporting
`["hero","event_card","signup_form","footer"]`.

> **Deviation from the PR-1 spec, deliberate:** spec said "No RLS
> (workspace-global)". A no-RLS table in `public` is readable **and
> writable** by the anon PostgREST role under Supabase default grants. RLS is
> therefore ENABLED with an authenticated-read policy and **no write
> policies** (writes = service-role only). Same workspace-global semantics,
> no anon write hole.

### Ownership chain

```
auth.users ── user_id ──> clients ── client_id ──> events
                             │                        │
                             └── client_landing_pages └── page_events
```

`clients.slug` and `events.slug` are unique per **(user_id, slug)** — NOT
globally, NOT per client. Public URLs are only unambiguous because the
workspace is single-operator today. The lookup loud-fails (throws) on a
multi-match rather than guessing a tenant. If a second operator user ever
gets clients, `/l` needs a global-uniqueness story (reserved-slug table or
per-workspace prefix) — that is a schema decision, stop and design it, don't
patch the lookup.

---

## 2. Multi-tenant isolation contract (Pixel + CAPI)

**The rule: every client owns their Pixel ID and CAPI token. Landing-page
events — client-side pixel fires and server-side CAPI pushes (both PR 3) —
go to THAT client's Pixel with THAT client's token. Never Off/Pixel's own
pixel. Never another client's.**

Why it's a privacy bug and not just a data-quality bug: a signup on Client
A's page firing into Client B's (or Off/Pixel's) pixel enrolls A's fans into
B's custom audiences. That is PII-derived audience data crossing legal
entities without consent — a GDPR problem, not a metrics problem.

How the schema enforces it:

- Pixel + token live on `client_landing_pages`, keyed `unique(client_id)`.
  There is **no global fallback column anywhere** — if a client has no pixel
  configured, nothing fires. Missing pixel ≠ "use ours".
- The public lookup (`lib/landing-pages/context.ts`) resolves
  `client_landing_pages` strictly through the `client_id` obtained from the
  `clientSlug` — step 4 of the chain cannot see any other client's row.
- `lib/landing-pages/__tests__/isolation.test.ts` is the hard test: two
  seeded tenants, resolve A, assert B's pixel/ids appear **nowhere** in the
  serialized context (and vice versa), and that
  `meta_capi_token_encrypted` is never selected on the public path. Any
  future "optimise into one join" or caching change that can cross tenants
  fails this test.
- PR 2 extends the contract to THEMES with the same shape:
  `__tests__/theme-isolation.test.ts` builds the view model for two
  maximally distinguishable tenants and asserts zero cross-tenant tokens
  (colors, logo, thank-you copy, names) in either serialized view. Theme
  scoping mechanism: resolved `--lp-*` CSS custom properties applied
  inline on the LP root (inheritance is strictly downward) + hashed
  CSS-module class names; the shared stylesheet contains only `var()`
  references, never tenant literals — true in dev and prod builds alike.
- PR 3 extends it to PIXEL + CAPI: `__tests__/capi-isolation.test.ts`
  runs two tenants' signups sequentially through the SAME module
  instances / db handle / `fireCompleteRegistrationCapi` import (so module-level caches,
  memoised tokens or singleton HTTP state would surface as a leak) and
  **byte-diffs** everything that leaves the system — pixel command
  tuples, serialized view models, and the full CAPI fetch call (URL +
  body) — against every secret of the other tenant (pixel id, decrypted
  token, test_event_code). Zero occurrences allowed, both orderings
  tested. See §12 for the event contract.
- RLS on both tables resolves ownership through the parent
  (`clients.user_id` / `events.user_id`) EXISTS chain — the migration-123
  pattern, no denormalised `user_id`.

**⚠ Naming landmine:** `clients.meta_pixel_id` already exists — it is the
pixel Off/Pixel runs **ad campaigns** against for that client (wizard
tooling). `client_landing_pages.meta_pixel_id` is the landing-page tenant
pixel. They may coincide for some clients but are separate concerns. **Never
fall back from one to the other in code.** If a PR needs "the client's pixel"
it must decide which one it means and say so.

CAPI token access (shipped in PR 3, migration 135): the raw
`meta_capi_token_encrypted` blob is never selected into app code. The
signup route decrypts at send time via `get_landing_page_capi_token(
client_id, key)` — SECURITY DEFINER, `search_path = public, extensions`
(§6 landmine 1), EXECUTE granted to `service_role` only. Ops set tokens
via `set_landing_page_capi_token(client_id, token, key)`. Key =
`LANDING_PAGES_TOKEN_KEY`.

---

## 3. Public route model

`/l/{clientSlug}/{eventSlug}` (`app/l/[clientSlug]/[eventSlug]/page.tsx`),
server component, listed in `PUBLIC_PREFIXES` as `"/l/"` (trailing slash —
bare `/l` would also match `/login`).

**Why service-role for reads:** there is no fan session, so RLS has nothing
to key on. Authorisation *is* the resolution chain: clientSlug → client →
event (slug **and** client_id must match) → page_events → landing page
(client_id from step 1 only). Every step keys off the previous step's id.
Consequences:

- Unknown client slug, unknown event slug, event under a different client,
  or no `page_events` row → `null` → `notFound()` (generic 404, no oracle
  for which part missed).
- Only public-safe display fields are ever selected. The CAPI token is
  **never** selected on this path in any PR.
- Ambiguous slug (cross-user collision) → throw, 500. A public URL that
  could resolve to two tenants must fail loudly, not pick one.

**Provider semantics:**

- `provider='internal'` → render (placeholder in PR 1).
- `provider='evntree'` → redirect to `evntree_url`. Next.js page redirects
  emit **307** (a page can't set a bare 302); both are non-cacheable
  temporary redirects, which is the contract dual-run needs — never a 301/308
  (would let browsers cache the Evntr.ee hop and defeat the cutover).
- `provider='evntree'` + null/blank URL → **throw (500)**. The DB CHECK makes
  this unreachable via normal writes; if it appears (manual SQL), we refuse
  to redirect a fan to a blank target.

**Rate limiting:** in-process per-IP fixed window, 60 req/60s
(`lib/landing-pages/rate-limit.ts`), adapted from the share-surface limiter
(`lib/share/force-refresh-rate-limit.ts`) — in-memory, per-worker, no Redis,
spoofable IP; the goal is stopping looped URLs from becoming DB load, not
hard security. The signup WRITE path has its own separate, tighter limiter
plus captcha — see §9.

**Signup endpoint (PR 2):** `POST /api/l/{clientSlug}/{eventSlug}/signup`
(`"/api/l/"` in PUBLIC_PREFIXES — trailing slash, same /login-adjacency
rule). GET returns 405. Pipeline (cheapest-first):
rate limit → shared-schema validation → Turnstile → slug-chain tenant
resolution (404 unknown; **409 when `provider='evntree'`** — the rollback
gate covers the API surface, not just the render) → hash + encrypt +
store. Same authorisation-by-resolution model as the page; the handler
core is DI-shaped (`lib/landing-pages/signup-handler.ts`) with the full
accept/reject matrix under node:test.

---

## 4. Rollback design (C+O non-negotiable D)

The rollback lever is **per-event**: `page_events.provider`.

- Flip a live event back to Evntr.ee at any time with one UPDATE:
  `provider='evntree', evntree_url='<the live evntree page>'` (the CHECK
  forces you to supply the URL — you cannot roll back into a blank).
- `client_landing_pages.default_provider` controls what NEW page rows get.
  It stays `'evntree'` for every client except explicit trials.
- **GMC migration path:** GMC's first 2 events run `provider='internal'`
  with Evntr.ee kept live (unpublicised) as redundancy — the rollback flip
  is instant because the evntree page already exists. Only after both events
  pass live validation does Evntr.ee deprecation start, and only for GMC.
- No data migration is ever needed to roll back: the provider toggle changes
  routing, not data. Signup data captured on the internal renderer (PR 2+)
  stays in our tables regardless of a later flip.

## 5. Follow-up PR sequence

What each PR owns (and must NOT do). Numbers are the arc's working plan, not
gospel — but the boundaries are.

| PR | Owns | Must not |
|---|---|---|
| **2 — theming + signup form ✅ DONE** | Theme jsonb schema + merge semantics; block renderer (`hero`/`event_card`/`signup_form`/`footer`); `template_key` promotion (migration 134); `event_signups` + encrypted PII storage; write-path rate limit + Turnstile; UTM/attribution capture | No pixel firing, no CAPI, no CRM push (scope pulled the signup form forward from PR 3 per the PR-2 prompt) |
| **3 — Meta Pixel + CAPI ✅ DONE** | Per-client pixel loader (`meta_pixel_id` through the view-model seam); PageView + CompleteRegistration with shared `event_id` dedup (switched from Lead post-merge, see landmine 16); server-side CAPI CompleteRegistration post-DB-write (migration 135: `meta_test_event_code`, `meta_pixel_id_verified_at`, token accessor RPCs); retry ×3 + 2s/6s timeouts + fail-open-loudly; cross-tenant byte-diff isolation tests. See §12 | No CRM push, no admin UI, no TikTok/Google pixels (scope pulled CAPI forward from PR 4 per the PR-3 prompt) |
| **4 — CRM push (Bird + Mailchimp on signup)** | Push stored signups to the client's CRM/community stack; same per-client credential silo + idempotency on repeated `signup_id`s | Never batch across clients; never log credentials |
| **5 — admin dashboard** | View/edit pixel_id, capi token (write-only — see §12 breadcrumbs), test_event_code, verification status; surface signup counts | Never display decrypted CAPI tokens; warn loudly when `meta_test_event_code` is set |
| **6 — Supreme UX rewrite ✅ DONE** | Full visual rewrite (Supreme-inspired mono/zero-radius system); minimal form fields (names/city DROPPED, social-handle mutex); hero carousel, countdown, YouTube lite-embed + image grid; server-side artwork palette extraction (sharp) + accent resolution; server-derived geo capture → hashed `country`/`st` in CAPI user_data (migration 136). See §15 | Landed OUT of the arc's original order (before 4/5 — C+O prioritised the fan-facing surface). No CRM push, no admin UI. Presentation columns on `page_events`, never `events` |
| **6b — Supreme polish pass ✅ DONE** | 7 post-review UI/copy tweaks: countdown de-emphasised (white/bordered); header meta row swapped from "current LDN time" to on-sale timestamp (`events.presale_at`/`general_sale_at`, read-only); `@` prefix baked into the social input; post-signup confirmation card (Share + "sign up another" reset) replaces the old always-visible Share button. See §16 | No schema changes at all (pure UI/copy PR — this is why it's "6b", not "7": the arc's numbered PR 7 below is unrelated and still pending) |
| **6c — Layout tidy ✅ DONE** | 6 more post-review UI/copy tweaks: killed the redundant auto-rendered venue+date line; header meta row swapped AGAIN, this time to `events.event_start_at` + `content.venue_short` (superseding 6b's on-sale header — on-sale info now lives ONLY in the countdown's static line); countdown header text swapped for a static "Presale: …" line (icon dropped); new Instagram/TikTok brand-socials row; footer reduced to one mono attribution line. See §17 | No schema changes (same "letter suffix" rule as 6b — this is why it's "6c", not "8": the arc's numbered PR 8 below is unrelated and still pending) |
| **6d — Countdown reorder + compact ticker ✅ DONE** | 3 more post-review tweaks: moved the countdown block down the render tree (below the event block, above the signup form — was above the title); shrunk the ticker to a compact ~85px inline strip (smaller cells, 17px numbers, 8px labels — an explicit, brief-authorised exception to the repo's ≥10px label floor); presale line's weekday goes 'short'→'long' ("Wed"→"Wednesday"). See §18 | No schema changes, no header-meta-row change (that stays short-form, deliberately un-touched) — same "letter suffix" rule as 6b/6c |
| **6e — Presale line left-align ✅ DONE** | One-line alignment fix: the static "Presale: …" text above the countdown ticker goes `text-align: center` → `left`, matching the event title / form-label baseline (container already shared the 14px horizontal padding). The 4-cell ticker row is unchanged. See §19 | No schema changes — same "letter suffix" rule as 6b/6c/6d |
| **7 — brief-parser extension** | D2C brief ingest also provisions `page_events` (+ `client_landing_pages` if missing) honouring `default_provider` | Do not touch d2c_* schemas beyond reading |
| **8 — analytics** | Page-view/section tracking, internal reporting | |
| **9+ — per-client add-ons** | TikTok pixel, Google Ads tag columns (per-client, same isolation contract), vanity slugs, multi-city layout | |

Design references for PR 2 (pattern, not visual system): Co:brand compact
multi-signup pattern (music.cobrand.com) — single-viewport event card with
inline signup, minimal fields, per-artist/per-event theming; and the
4tF/Ironworks landing precedent — bright, UGC-friendly, per-client themed.
No internal page components exist for either (audited 2026-07-01; Ironworks
signups ran on external pages — see `docs/IRONWORKS_PROJECT_BRIEF.md` for
the funnel: signup phase feeds the retargeting pool that payday-stretch
conversion spends against — which is exactly the job these pages take over).

**MVP admin posture:** no admin UI. Matas edits `client_landing_pages` /
`page_events` via the Supabase dashboard. The seed script
(`scripts/seed-gmc-landing-page.mjs`) provisions the GMC trial rows.

## 6. Landmines

1. **pgcrypto schema ambiguity (BIT US TWICE, updated 2026-07-04).** The
   history in one breath: migration 042 wrote crypto functions assuming
   `public`; prod migration 131 (2026-07-01 morning) installed pgcrypto in
   `extensions`, breaking them; the D2C direct-fire ops fix (2026-07-01
   night) moved pgcrypto **back to `public`** — where it sits today
   (live-verified 2026-07-04: `pg_extension → nspname = 'public'`). It has
   occupied BOTH schemas within one week, and nothing stops it moving
   again. **The rule, superseding PR 1's "qualify as extensions." advice:
   never single-schema-qualify pgp_sym_\* — declare
   `set search_path = public, extensions` on the function and call
   UNQUALIFIED.** That is what migration 134's `landing_page_encrypt` /
   `landing_page_decrypt` do; PR 4's CAPI accessors MUST copy that exact
   pattern. Enforcement: migration 134's verification block probes BOTH
   qualified names live at apply time (at least one must work) and
   round-trips through the helpers;
   `lib/landing-pages/__tests__/pgcrypto-ambiguity.test.ts` asserts the
   migration source keeps the dual search_path and unqualified calls, and
   exercises the resolution semantics for both placements.
2. **Service-role vs RLS.** Service-role bypasses RLS *entirely*. On `/l`
   that is safe only because the resolution chain is the authorisation. Any
   new query added to the public path must key off an id already resolved in
   the chain — never off request input directly (a `.eq("client_id",
   somethingFromTheURL)` that isn't the chain-resolved id reopens the
   cross-tenant hole). The isolation test is the tripwire; extend it when
   the context grows.
3. **Two `meta_pixel_id` columns.** `clients.meta_pixel_id` (Off/Pixel's
   campaign tooling) vs `client_landing_pages.meta_pixel_id` (the tenant
   pixel fans' browsers fire into). Confusing them re-creates the
   cross-contamination bug at the config level. No fallbacks between them.
4. **Per-client credential silos.** One row per client, tokens encrypted
   per-row, no shared/global token, missing config = feature off (never
   "borrow" another row). This is the same 3-of-3-gates philosophy as D2C
   live sends: absence of config must fail safe.
5. **Slug uniqueness is per-user.** See §1. Multi-operator workspaces break
   the public URL space; the lookup throws on ambiguity as the tripwire.
6. **`page_templates` without write policies.** Template writes go through
   the service role (migrations / seed scripts) only. If PR 2 wants an admin
   editor, add explicit owner policies then — don't grant broadly now.
7. **Known cross-client leakage precedent to NOT repeat:** none found in the
   codebase (audited the share surfaces + portal snapshot readers — all key
   off a chain-resolved id or an unguessable token). The nearest historical
   incident class is the PUBLIC_PREFIXES one: routes silently 307-ing to
   /login because the prefix was missing (`/api/cron` lesson) — guarded here
   by `lib/landing-pages/__tests__/public-prefix.test.ts` (now also covers
   `/api/l/`).
8. **LANDING_PAGES_HASH_SALT is effectively immutable** (PR 2). Rotating it
   silently breaks dedupe — every old hash stops matching, and repeat fans
   become new canonical rows. Rotation requires a decrypt-and-rehash
   backfill (see §8). Do not "rotate for hygiene" like a secret; it is a
   namespace, not a credential.
9. **The renderer consumes the VIEW MODEL, not the context** (PR 2,
   extended PR 3). `buildLandingPageView` (`lib/landing-pages/view.ts`) is
   the isolation seam and the theme-bleed test serialises the whole view.
   PR 3 added `metaPixelId` through the seam as planned — it is the ONLY
   pixel-shaped value the component tree can see, sourced exclusively
   from `context.landingPage.meta_pixel_id`. Anything else the renderer
   ever needs must come through the seam the same way, never by passing
   the raw context into components.
10. **Repeat-signup rows carry NO PII** (PR 2 dedupe model, §8). Anything
   analytics-side that joins signups must treat
   `deduplicated_signup_id IS NULL` as "the person" and other rows as
   "signup events". Counting rows = signup attempts; counting canonical
   rows = unique fans. Do not "fix" the NULL PII columns on repeat rows —
   they are intentional (the contactable CHECK exempts them by design).
11. **What PRs 4/5/6 must NOT assume from this doc alone:**
   - The Turnstile env vars are LANDING-PAGE-SPECIFIC
     (`LANDING_PAGES_TURNSTILE_*`) — do not reuse for other surfaces, and
     the site key reaches the client as a server-component PROP, not a
     `NEXT_PUBLIC_` var. The PR-3 pixel id follows the same pattern (it
     comes from the tenant context, NOT an env var).
   - `LANDING_PAGES_TOKEN_KEY ≠ D2C_TOKEN_KEY` (§8). The PR-3 CAPI token
     accessors use the LANDING-PAGE key. Passing the D2C key "because it's
     already set" will decrypt nothing and corrupt nothing — it will just
     fail — but writing with it would silently fork the key domain.
   - The signup POST returns the CANONICAL id on dedupe, not the new
     repeat row's id — CRM push (PR 4/5) keyed on `signup_id` must expect
     repeated ids and stay idempotent. Note the CAPI leg already skips
     deduplicated signups (`capi.skipped="deduplicated"`) — CRM push must
     make its own equivalent decision, not inherit this one implicitly.
   - CRM push (PR 4) has the SAME per-client silo requirement as
     pixel/CAPI: per-client credentials, no org-level fallback, missing
     config = feature off, and a two-tenant byte-diff isolation test
     before merge. Copy the `capi-isolation.test.ts` harness shape.
   - `events` has no artwork column; artwork comes from
     `page_events.content.artwork_url` only. Do not "helpfully" fall back
     to `clients.d2c_fallback_artwork_url` — that column is D2C-owned and
     WhatsApp-shaped, not LP-shaped.
   - node:test runs with `--conditions react-server`: `react-dom/server`
     is NOT importable in tests. Isolation/render tests must target the
     view-model seam (or pure helpers), not renderToString.
12. **Pixel + CAPI credentials are per-client, FOREVER** (PR 3). Future
   PRs must never introduce an org-level default pixel or token, however
   convenient for onboarding. `client_landing_pages.meta_pixel_id` null →
   nothing loads; token null → CAPI leg off (`skipped:"not_configured"`).
   Absence of config fails SAFE, never sideways into another identity.
13. **`meta_test_event_code` is dev-only** (PR 3). While set, that
   client's CAPI Leads route to Meta's Test Events surface instead of live
   reporting — QA gold, prod poison. Clear it after testing; the PR-5
   admin dashboard must warn loudly whenever it is non-null (a client
   whose events "disappeared" probably has a stale test code).
14. **Two SHA256 families that must never be swapped** (PR 3).
   `lib/landing-pages/hash.ts` = salted + namespaced
   (`lp-email:{salt}:{value}`) for stored dedupe hashes;
   `hashForCapi` in `lib/landing-pages/meta-capi.ts` = Meta's UNSALTED
   `sha256(lower(trim(value)))` computed at send time and discarded.
   Feeding a salted hash to Meta silently breaks match quality (no error,
   just zero matches); storing the unsalted hash weakens the PR-2 privacy
   design. `meta-capi.test.ts` pins that the families differ for the same
   input.
15. **`fbq` is a window-global — `trackSingle` only** (PR 3). After a
   soft navigation between two tenants' pages, BOTH pixels stay
   initialised in the same `fbq` instance; a plain `fbq('track', …)`
   fires the event to EVERY initialised pixel — the exact cross-tenant
   leak this arc bans. All pixel commands are built in
   `lib/landing-pages/pixel-events.ts` using `trackSingle`, and
   `pixel-events.test.ts` has a source-level guard that fails on any
   quoted `'track'` literal in the pixel modules.
16. **CAPI retries reuse the SAME `event_id`** (PR 3). Meta dedups on
   `(event_name, event_id)` for 48h — a stable id makes retries and
   accidental double-POSTs idempotent. Generating a fresh id per attempt
   would convert every retry into a duplicate CompleteRegistration. The
   browser CompleteRegistration and server CAPI event share one id
   (sessionStorage-persisted base) for the same reason.
17. **The signup event is `CompleteRegistration`, not `Lead`** (switched
   shortly after PR 3 merged). It is Meta's standard event for
   account/newsletter signups and pairs with `Purchase` in the
   event-marketing funnel (signup → presale link → ticket buy) — see
   §12. Every future conversion event this arc adds (`Purchase` for the
   ticket buy, `AddToCart` for a basket, etc.) MUST use its own exact
   Meta standard name and MUST NOT drift back to `Lead` for signups or
   reuse `CompleteRegistration` for a different step. MVP fires exactly
   ONE signup event — do not add a second simultaneous event (some
   integrations fire `Lead` AND `CompleteRegistration`; that is an
   explicit non-goal here) without a deliberate decision recorded here.

## 8. PII encryption + storage (PR 2)

**Why encrypt at all:** `event_signups` is the first table holding FAN PII
(emails, phones) rather than operator/client credentials. A DB dump, a
misconfigured read, or an over-broad SELECT must yield blobs, not
addresses. Names/city/handles stay plaintext — they are low-sensitivity
and needed for display/analytics; contactable identifiers are the asset
worth stealing.

**Key strategy — new `LANDING_PAGES_TOKEN_KEY`, NOT `D2C_TOKEN_KEY`
(judgment call, decided in PR 2):**

- *Blast radius:* a leaked/rotated D2C key must not force re-encrypting
  fan PII, and vice versa. D2C credentials are ~a handful of rows
  (re-encryption is a 5-minute ops task); `event_signups` will grow to
  tens of thousands of rows with a decrypt→re-encrypt backfill cost.
  Coupling their key lifecycles couples their worst days.
- *Cross-arc coupling:* D2C dispatch and landing pages are separate arcs
  with separate threat models (operator credentials vs fan PII). The
  D2C key already had one incident-driven fire drill (2026-07-01); LP PII
  should not inherit the next one.
- *Cost:* one more Vercel env var. Trade accepted.
- PR 4's CAPI tokens (client credentials in the LP arc) also use
  `LANDING_PAGES_TOKEN_KEY` — one key per arc, not per table.
- *Rotation path:* add `LANDING_PAGES_TOKEN_KEY_V2`, backfill-decrypt with
  v1 + re-encrypt with v2 in batches (service-role script), then retire
  v1. A `key_version` column is deliberately NOT added yet — YAGNI until a
  rotation is actually scheduled.

**Hash-for-dedupe pattern:** `email_hash` / `phone_hash` =
`sha256("lp-email:"|"lp-phone:" + LANDING_PAGES_HASH_SALT + normalised value)`
(`lib/landing-pages/hash.ts`). Namespaced (email/phone/ip can never
collide), salted (useless against external rainbow/cross-reference
attacks), and irreversible — dedupe needs equality, never the value.
Partial unique indexes `(event_id, email_hash)` / `(event_id, phone_hash)`
apply to canonical rows only. **The salt is immutable** (landmine 8).

**Dedupe semantics (repeat signups):** a repeat submission inserts an
attribution-only row (`deduplicated_signup_id` → canonical row, no PII, no
hashes, fresh utm/source/consent timestamps) and the API returns the
CANONICAL id with `deduplicated: true`. Rationale: repeat-signup behaviour
is an analytics signal (which ad re-converted an existing fan) that a
"just return the existing row" model throws away, and re-storing PII per
attempt multiplies the encrypted surface for zero gain. This resolves a
real conflict in the original spec — a repeat row carrying the same email
would violate the unique index; exempting marked repeat rows keeps both
properties. Concurrency: the unique index is the arbiter; on 23505 the
store re-reads the canonical row and records the repeat
(`lib/landing-pages/signup-store.ts`).

**ip_hash never raw:** GDPR data minimisation. Abuse analysis needs
"same submitter" grouping, not the address itself.

## 9. Rate limit + Turnstile layered defence (PR 2)

A public POST that triggers crypto RPCs and encrypted-PII writes is the
arc's most attackable surface. Layers, cheapest first — each exists
because the previous one has a hole:

1. **Per-(IP, page) fixed window** — 5 signups / 10 min
   (`checkSignupRateLimit`, env-tunable via `LANDING_PAGES_SIGNUP_RATE_MAX`
   / `LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES`). In-process, per-worker:
   total exposure ≈ warm workers × 5 per window per IP. Hole: spoofable
   XFF, many-IP botnets.
2. **Shared-schema validation before any IO** — malformed floods cost only
   CPU. Hole: valid-shaped garbage.
3. **Cloudflare Turnstile (`appearance: interaction-only` — invisible
   unless a challenge is needed)** — server-verified against
   `https://challenges.cloudflare.com/turnstile/v0/siteverify`
   (form-encoded `secret` + `response`; success is binary, no v3-style
   score; rejection reasons carry Cloudflare's `error-codes`). Tokens are
   single-use with ~300s TTL — the widget resets after any failed submit.
   Keys unset → warn + skip (dev); `LANDING_PAGES_TURNSTILE_REQUIRED=1`
   makes unset keys a hard failure (set it in prod). Cloudflare
   unreachable → **fail open, loudly** (a fan's signup beats bot paranoia;
   sustained failures are visible in logs). Hole: captcha farms.
4. **Tenant resolution + provider gate** — unknown pages 404 before any
   write; evntree-rolled-back pages 409.
5. **DB-level backstops** — partial unique indexes cap per-fan row growth;
   the contactable CHECK + hash-pair CHECKs reject malformed writes that
   somehow bypass the handler; no anon write policies exist at all.
6. **Vercel edge WAF** — the cross-worker/cross-IP backstop we deliberately
   do not rebuild in-process (same posture as the meta-click endpoint).

Not implemented (documented trade-offs): honeypot field and
min-time-to-submit (PR-1 doc floated them; Turnstile's challenge model
subsumes both and the form stays friction-free), Upstash/Postgres shared
counter (revisit only if logs show real cross-worker abuse — the PR-1
"required" wording is downgraded to "when evidenced").

**Provider history:** PR 2 initially shipped reCAPTCHA v3 per the prompt's
env contract; C+O approved the flagged Turnstile preference pre-merge and
the flip landed on the same PR (#667) — free, no Google dependency,
confined to the `verifyCaptcha` DI seam (`signup-handler.ts`) + the widget
in `signup-form-block.tsx`, exactly as the seam was designed for.

## 10. Env vars (PR 2)

| Var | Purpose |
|---|---|
| `LANDING_PAGES_TOKEN_KEY` | pgcrypto key for `event_signups` PII (and PR-4 CAPI tokens). ≥8 chars. Never log. |
| `LANDING_PAGES_HASH_SALT` | Dedupe-hash salt. ≥8 chars. **Immutable** (landmine 8). |
| `LANDING_PAGES_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key — server-read, passed to the form as a prop. |
| `LANDING_PAGES_TURNSTILE_SECRET_KEY` | Turnstile secret for Cloudflare's siteverify. |
| `LANDING_PAGES_TURNSTILE_REQUIRED` | `"1"` = unset keys are a hard failure (set in prod once keys exist). |
| `LANDING_PAGES_SIGNUP_RATE_MAX` / `LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES` | Signup limiter tuning (defaults 5 / 10). |
| `LANDING_PAGES_META_API_VERSION` | Graph API version for the CAPI endpoint (PR 3). Defaults to `v21.0` — same default as the ad-side client but a deliberately independent env var (the LP arc must never couple to `lib/meta/` config). |

## 11. Design reference appendix (PR 2, C+O non-negotiable B)

Visual precedent is the 4tF/Ironworks landing pages — bright,
UGC-friendly, per-client themed — and no prior code exists for them in
this repo (re-audited 2026-07-04; Ironworks signups ran on external
pages). Repo components that fit the *vibe* but were cited-not-copied per
the non-negotiable: the share-surface card patterns
(`components/share/`) for the rounded-card + accent-tint language, and
the login form's stacked-field rhythm (`app/login/`). The LP tree is
new-built in `components/landing-pages/` with its own CSS module —
deliberately zero imports from `components/ui/**` (shared/ask-first per
thread boundaries) and zero Tailwind utility coupling, so the fan-facing
surface cannot drift when the app shell restyles.

## 12. Meta Pixel + CAPI contract (PR 3)

### What fires, where, with what data

| Event | Side | When | Data |
|---|---|---|---|
| `PageView` | Browser (`fbq trackSingle`) | LP mount, when `metaPixelId` is set | Whatever Meta Pixel auto-captures; `eventID = {base}-pv` |
| `CompleteRegistration` | Browser (`fbq trackSingle`) | Successful NON-deduplicated signup | No manual PII — Meta's auto-capture only; `eventID = {base}-cr` |
| `CompleteRegistration` | Server (CAPI `POST /{pixel_id}/events`) | After the DB write succeeds, inline before the signup response | `em`/`ph` = unsalted SHA256 of the just-decrypted email / digits-only E.164 phone (computed at send time, discarded); `client_ip_address` from x-forwarded-for; `client_user_agent`; `event_source_url` = the public LP URL; `custom_data.source` = the PR-2 attribution bucket; same `event_id` as the browser CompleteRegistration event |

**Why `CompleteRegistration` and not `Lead`:** Meta's standard event for
account/newsletter-style signups; it pairs naturally with `Purchase` in
the event-marketing conversion funnel (fan signs up → gets the presale
link → buys a ticket) — `Purchase` is the natural next event a future PR
adds for the ticket-buy step, and Meta's optimisation/attribution tooling
expects that pairing rather than `Lead` → `Purchase`. This was switched
from `Lead` shortly after PR 3 shipped (see landmine 16) — MVP fires
exactly one signup event, never both.

**eventID dedup pattern:** one base uuid per browser session, persisted in
`sessionStorage` (`lp_pixel_event_base_v1`) so it survives the submit
transition and reloads. The form sends `{base}-cr` in the POST body
(`capi_event_id`, validated `[A-Za-z0-9._:-]{8,64}`); the server uses it
verbatim, falling back to the deterministic `{signup_id}-cr` when
absent/invalid. Meta collapses the browser + server pair — and any CAPI
retries — on `(event_name, event_id)` within 48h (landmine 16).

**test_event_code:** read per call from
`client_landing_pages.meta_test_event_code`. Per-client column rather than
an env var, deliberately — Matas toggles it per client via SQL
(`set_landing_page_capi_token` sibling workflow, no redeploy), and an
env-level code would route EVERY tenant's events to one client's Test
Events view. Dev-only: landmine 13.

### The client A ≠ client B invariant, worked

A signup on Client A's page must produce: fbevents init'd with A's pixel
only; `trackSingle(A_pixel, …)` fires only; a CAPI POST to
`graph.facebook.com/vXX.X/{A_pixel}/events?access_token={A_token}`
carrying A's test code if set. If ANY of B's material appears — B's pixel
in the fbq init (fan lands in B's PageView audience), B's token on the
POST (event writes into B's dataset), B's test code (A's events vanish
into B's test view) — that is A's fans enrolled in B's custom audiences:
PII-derived audience data crossing legal entities without consent. GDPR
violation + Meta ToS violation + both clients' retargeting pools poisoned
(B pays to retarget people who never engaged with B). This is why
`capi-isolation.test.ts` byte-diffs the full outgoing surface for both
orderings rather than spot-checking fields.

### Failure posture (retry / timeout / fail-open-loudly)

Signup success must NEVER depend on Meta being up: the fan's data is
already committed before the CAPI leg starts, and a fan-facing error over
a tracking hiccup would cost real signups. So: 3 attempts max, backoff
200ms → 500ms → 1200ms, 2s hard abort per attempt, 6s total deadline
(worst-case added latency on a Meta outage ≈ 6s, still inside serverless
budgets). 4xx = permanent (bad token/pixel), fail immediately — retrying
cannot heal it. Every outcome logs `console.error` prefixed
`[landing-pages capi]` (success with fbtrace_id included — Vercel filters
lower log levels) and the signup response carries a debug field:
`{ ok, signup_id, deduplicated, capi: { ok, fbtrace_id?, error?, skipped? } }`
so Matas can diagnose via curl. `skipped` values: `not_configured`
(no pixel or no token), `deduplicated` (repeat signup — no
CompleteRegistration fired).

### PR-5 admin dashboard breadcrumbs

- Surface per client: `meta_pixel_id`, `meta_pixel_id_verified_at`
  (stale/null ⇒ "unverified" badge), `meta_test_event_code`
  (non-null ⇒ loud warning banner, landmine 13), and whether a CAPI token
  is set (existence only).
- CAPI tokens are WRITE-ONLY in the UI: set via
  `set_landing_page_capi_token`, display as "configured/not configured",
  never render decrypted — not even to Matas. Decrypt happens exclusively
  at send time via `get_landing_page_capi_token` (service-role).
- Token freshness: Meta system-user tokens can be long-lived but do get
  revoked; the `capi.error=http_4xx` log line is the detection signal.
  A dashboard "last successful CAPI fire" timestamp would need a new
  column or log query — decide in PR 5, do not bolt onto 135's columns.
- `meta_pixel_id_verified_at` is set manually (SQL) in this PR; PR 5 can
  add a "verify now" button that fires a CAPI test event and stamps it.

### PR-3 verification runbook (Matas)

1. Apply `supabase/migrations/135_landing_page_meta_capi.sql` via Supabase
   MCP `apply_migration` — must print
   `migration 135 verification: all assertions passed`.
2. Seed the GMC row:
   `update client_landing_pages set meta_pixel_id='<pixel>' where client_id='<gmc>';`
   then `select set_landing_page_capi_token('<gmc>', '<capi token>', '<LANDING_PAGES_TOKEN_KEY>');`
3. QA path: `update client_landing_pages set meta_test_event_code='<code from Events Manager Test Events>' …`,
   open the LP, submit a signup → Test Events shows PageView (browser) +
   CompleteRegistration (browser + server, deduped to one). The signup
   response's `capi` field shows `{ok: true, fbtrace_id: …}`.
4. Clear the test code → repeat with a fresh email → events appear on the
   live pixel in Events Manager, correct pixel id.
5. Rollback check: flip `provider='evntree'` → page 307s before any pixel
   renders; flip back.
6. Repeat-signup check: same email again → response has
   `capi: {ok:false, skipped:"deduplicated"}` and no new CompleteRegistration
   in Meta.

## 13. PR-2 verification runbook (Matas, pre-merge)

1. Apply `supabase/migrations/134_event_signups.sql` via Supabase MCP
   `apply_migration` — must print
   `migration 134 verification: all assertions passed` (plus a notice
   naming which schema pgcrypto was found in).
2. Set env vars locally: `LANDING_PAGES_TOKEN_KEY`,
   `LANDING_PAGES_HASH_SALT` (any ≥8-char strings for the trial); leave
   Turnstile unset (dev-mode skip).
3. `npm run dev` → open
   `/l/gmc-worldwide-productions/jackies-open-air-house-music-festival-mallorca-wlf8br`
   → themed page renders (defaults; seed a `theme` on the GMC
   `client_landing_pages` row to see branding).
4. Submit a test signup with your email → success card with thank-you
   message → `select id, email_hash, deduplicated_signup_id from
   event_signups` shows one canonical row, `email_encrypted` is a blob.
   Decrypt check: `select landing_page_decrypt(email_encrypted, '<key>')`.
5. Submit the SAME email again → success card notes you're already on the
   list; table shows a second row with `deduplicated_signup_id` set and
   NULL PII.
6. Flip the page row to `provider='evntree'` → page 307s to Evntr.ee (PR-1
   behaviour intact) AND a curl POST to the signup API returns 409. Flip
   back.
7. 6 rapid signups from one IP → 6th returns 429.

## 14. PR-1 verification runbook (historical — completed 2026-07-02)

1. Apply `supabase/migrations/132_landing_pages_scaffold.sql` via Supabase
   MCP `apply_migration` — the in-migration verification block must print
   `migration 132 verification: all assertions passed`.
2. `set -a && source .env.local && set +a && node scripts/seed-gmc-landing-page.mjs`
   (dry run), then re-run with `DRY_RUN=0`.
3. `npm run dev` → open `/l/gmc-worldwide-productions/{event slug printed by
   the script}` → placeholder shows client name, event name, `mvp_v1`.
4. Flip the row: `update page_events set provider='evntree',
   evntree_url='https://evntr.ee/<page>' where event_id='160fbb1c-…'` →
   reload → temporary redirect to Evntr.ee. Flip back.
5. Unknown slugs → 404; logged-out visit works (no /login bounce).

## 15. Supreme UX rewrite (PR 6)

The full fan-facing rewrite: Supreme-inspired system (mono type, hard
black borders, zero radius, one accent colour), minimal form, and the
presentation blocks (carousel / countdown / bottom media). Migration:
`136_landing_page_supreme_ux.sql` — the prompt said "128" against a stale
snapshot of the repo; the sequence had already reached 135, so it shipped
as 136. Two other spec deviations, both deliberate:

- **Presentation columns live on `page_events`, NOT `events`.** The
  prompt asked for `events.artwork_palette` etc., but `events` is the
  shared dashboard table (dashboard-boundaries: read-only for this arc)
  and artwork already lives in `page_events.content.artwork_url`. Every
  LP presentation field (`artwork_palette`, `hero_images`,
  `countdown_target_at`, `countdown_label`, `youtube_url`,
  `bottom_images`) sits on the LP-owned row instead.
- **`instagram_handle`/`tiktok_handle` already existed** as
  `ig_handle`/`tt_handle` (PR 2, plaintext by design — public
  identifiers). Kept those names; PR 6 added only the mutex.

### The form contract (breaking, deliberately soft)

`event_signups` dropped `first_name`/`last_name`/`city` (test rows for
GMC truncated in-migration before the drop). The parser IGNORES legacy
keys rather than rejecting them — a cached client bundle mid-deploy must
not 400 a fan. The social toggle sends exactly one of
`ig_handle`/`tt_handle`; BOTH set means a bypassed client → 400
(`errors.social`). Consent copy: single checkbox → client mailing list +
privacy-policy link (`client_landing_pages.privacy_policy_url`); the
always-visible marketing-consent line below is informational, not a
second checkbox.

### Geo capture (server-derived, never from the body)

`x-vercel-ip-country` / `-country-region` / `-city` are read in the route
handler and stored plaintext (`geo_country`/`geo_region`/`geo_city` —
coarse, not contactable, analytics-grade). CAPI `user_data` gained
`country` + `st` (Meta's unsalted-SHA256 normalisation: lowercase ISO-2 /
lowercased region); `fn`/`ln`/`ct` never existed in our CAPI payload, so
"drop" was a no-op. IG/TikTok handles are CRM-only — Meta accepts no such
field, and sending them anywhere near `user_data` is banned.

### Palette pipeline (lazy, render-time, fail-silent)

No application write-path exists for artwork (Matas edits `page_events`
via SQL/seed scripts), so there is no "on upload" hook to wire. Instead
the LP route schedules `maybeExtractAndPersistPalette` via `next/server`
`after()` whenever a page renders with artwork but NULL
`artwork_palette`: fetch → sharp resize (100px) → dominant-bin ranking
(`lib/landing-pages/palette.ts`, pure + unit-tested) → 3 hex codes
persisted. 3s hard deadline, every failure path returns `[]` and leaves
the column NULL (next render retries; an in-process guard stops
stampedes). Accent resolution (`resolveAccent`, `theme.ts`):
`artwork_palette[0]` → `theme.primary_color` → `#E5322D`; every candidate
is `#rrggbb`-validated because the value lands in a style attribute —
hostile palette/theme strings fall through to the default.

### Component tree (all view-model-fed, landmine 9 upheld)

`landing-page.tsx` (server) → `HeroCarousel` (scroll-snap + Intersection
Observer "N of M" counter, arrow-key accessible; 1 image = plain img, no
scroller), `CountdownBlock` (setInterval ticker, cleanup on unmount, self
-hides past target — the view model also gates it server-side so the
block never SSRs for past targets), `SignupForm` (rewrite of
signup-form-block; Turnstile/attribution/pixel plumbing carried over
verbatim), `BottomMedia` (YouTube lite-embed — thumbnail until user
gesture, then autoplay iframe; strict 11-char id charset doubles as
injection defence — + square image grid). Fonts are system stacks (mono
+ Futura-with-fallbacks) — no webfont request, no `next/font`.

### PR-6 landmines

1. **node:test cannot render client components** (react-server
   condition, landmine 11 last bullet). All PR-6 component behaviour is
   tested at the logic seams: `countdown.ts`, `youtube.ts`, `palette.ts`
   pure modules + `view-supreme.test.ts` on the view model. Do not add
   renderToString tests; they will not import.
2. **`palette-extract.ts` is `server-only` and imports sharp (native
   binary) at module top.** Only the `/l` page route (and node tests)
   may import it — never any client-adjacent module, and never re-export
   it through a barrel a client component touches. The 3s deadline
   races sharp's decode too (the AbortSignal only covers the fetch), so
   the budget is genuinely hard.
3. **The countdown gate exists twice on purpose**: view model (SSR skip)
   + component (client ticker reaching zero). Removing either
   reintroduces a bug class (stale SSR shows a dead countdown, or a
   page open across the deadline never hides the block).

### Verification runbook (Matas)

1. Apply `supabase/migrations/136_landing_page_supreme_ux.sql` — must
   print `migration 136 verification: all assertions passed`. Note it
   DELETES GMC test signups then DROPS three columns; there is no undo.
2. Seed presentation on the GMC row, e.g.
   `update page_events set hero_images='["…"]'::jsonb, countdown_target_at='2026-08-01T18:00:00Z' where event_id='160fbb1c-…';`
3. Open the LP → Supreme layout, carousel counter advances on swipe,
   countdown ticks, accent = artwork colour once
   `artwork_palette` populates (reload once — extraction is lazy).
4. Signup with an IG handle → row has `ig_handle` set, `tt_handle`
   NULL, `geo_*` populated (prod; localhost gives NULLs).
5. With `meta_test_event_code` set: Test Events shows CompleteRegistration
   with hashed `country`/`st` in user_data and no fn/ln/ct.
6. Palette check against the live artwork: `select artwork_palette from
   page_events where event_id='160fbb1c-…';` → 3 hex codes.

## 16. Supreme polish pass (PR 6b)

Seven post-review UI/copy tweaks against the live GMC Mallorca page.
Zero schema changes — every field this PR reads already existed. Called
"6b" in the plan table above to avoid colliding with the arc's own
numbered "PR 7" (brief-parser extension, unrelated, still pending).

- **Countdown de-emphasised**: white container/cells, 0.5px black
  borders (same pattern as form inputs), black header text + icon.
  Numbers stay on `var(--accent)` — never a hardcoded colour, that part
  was already correct pre-PR. Label font-size is clamped to 10px (spec
  asked for 9px; repo floor is 10px — same trade-off as the PR-6 footer).
- **Header meta row**: was "current render time in London" (always-on,
  meaningless to Matas). Now `events.presale_at` falling back to
  `events.general_sale_at` (both columns pre-existed on the shared
  dashboard table — read-only for this arc, dashboard-boundaries), title-
  cased ("On sale: 12:00 Fri 10 July" — a DELIBERATE one-line exception
  to the page's lowercase convention). Null when both timestamps are
  null → the row doesn't render at all (`view.onSaleAt`,
  `lib/landing-pages/format-datetime.ts`). This is the one place PR 6b
  extended the resolution chain: `context.event` gained
  `presale_at`/`general_sale_at` (context.ts/types.ts), `view.ts` picks
  the first parseable one.
- **`@` prefix**: baked into the social-handle input chrome
  (non-interactive `<span>@</span>` inside the bordered wrapper) instead
  of a `@handle` placeholder. Submit-time behaviour unchanged — the
  shared schema already strips a leading `@` (`normalizeHandle`), so a
  pasted `@handle` still works.
- **Phone E.164 trunk-zero**: audited, not built. `parsePhoneNumberFromString`
  (already the only phone parser in this codebase) strips a national
  trunk "0" per-country via its own metadata whenever `defaultCountry` is
  supplied — verified directly against the pinned dependency version
  before writing anything. A hand-rolled "strip a leading 0" pass would
  be redundant at best (libphonenumber already does it) and wrong at
  worst (some numbering plans use a leading 0 as part of the subscriber
  number, not a trunk prefix — a blind string strip can't tell the
  difference). Pinned in `signup-schema.test.ts`'s "trunk-zero" describe
  block (GB/FR/DE, with-0 / without-0 / full-E.164-with-0 all converge).
  Only change: a `placeholder="7700 900123"` was added — the field had
  no placeholder at all pre-PR despite the brief assuming one existed.
- **Turnstile invisible**: audited, not built. `appearance:
  "interaction-only"` was already the render option PR 6 shipped — no
  visible-widget bug existed. Confirmed via CDP: `window.turnstile.render()`
  produces zero DOM footprint (no iframe at all) until a challenge is
  actually required.
- **Bottom media 4-col grid**: `repeat(4, 1fr)` at every viewport (mobile
  media-query override removed), `gap: 2px`, explicit white background
  on the wrapping `<section>` so the gap reads as a hairline. A `2px`
  white spacer div sits between the YouTube embed and the grid ONLY when
  both are present. Verified at a 375px CDP-emulated viewport: 4 columns
  of ~92px each, 2px gaps, confirmed via `getComputedStyle`.
- **Share moved to post-signup confirmation**: pre-submit view now shows
  only "sign up" (single-CTA discipline). On success, a confirmation card
  replaces the form — "you're in." (mono 13px) + "we'll notify you when
  presale opens on {onSaleAt formatted as 'd MMM at HH:mm'} uk." (reuses
  the SAME `onSaleAt` as the header, not a presale_at-only lookup — a
  deliberate consistency choice; falls back to `thankYouMessage` when
  `onSaleAt` is null) + the Share button (unchanged styling/behaviour,
  just relocated) + an optional "sign up another" ghost link.

### Landmine 17: Turnstile remount on "sign up another"

"Sign up another" resets `state` back to `"idle"`, which unmounts the
success card and remounts the `<form>` — including the Turnstile
container `<div>`. The PR-6 mount logic was a plain `ref` + a
`useEffect` that runs ONCE (`[turnstileSiteKey]` deps); on remount the
effect does not re-fire, and the old `turnstileWidgetIdRef.current`
guard would silently prevent ever rendering a widget into the NEW
container node — a real fan hitting "sign up another" would get a
permanently-invisible, permanently-unusable Turnstile slot on their
second attempt.

Fixed by making the container a `ref` CALLBACK
(`attachTurnstileContainer`) that calls the (now memoised)
`renderTurnstileWidget` whenever a node attaches — covering both the
original mount (script-load path) and every remount. `resetForNewSignup`
nulls `turnstileWidgetIdRef`/`turnstileTokenRef` but deliberately does
NOT call `window.turnstile.remove()` — by the time it runs, React has
already unmounted the OLD container, and Turnstile self-destructs
widgets whose container leaves the DOM; calling `.remove()` afterward
just logs a harmless "Cannot find Widget" console warning (verified via
manual browser testing with `LANDING_PAGES_TURNSTILE_SECRET_KEY` unset
locally — dev-mode captcha skip lets the confirmation card render
without a real Cloudflare pass). A fresh widget id was confirmed to
mount on the remounted container after this fix.

**Untestable locally, by design**: the real Cloudflare challenge cannot
be solved from `localhost` (the configured sitekey is domain-bound to
the production hostname — confirms as Turnstile error `110200`,
"invalid domain", in the browser console). This is a pre-existing
environment limitation, not a PR 6b regression — it applied identically
to the PR-6 code before this PR touched anything.

## 17. Layout tidy (PR 6c)

Six more post-review UI/copy tweaks against the live GMC Mallorca page —
Matas's second review pass after 6b landed. Zero schema changes; every
new field this PR reads (`content.venue_short`, `content.brand_instagram_url`,
`content.brand_tiktok_url`, `content.venue`, `events.event_start_at`) was
either already authored on the live Jackies `page_events.content` row
(verified live 2026-07-05 — nothing needed seeding) or already a real
column on the shared `events` table. Called "6c" for the same reason 6b
was: avoids colliding with the arc's own numbered "PR 8" (analytics,
unrelated, still pending).

- **Killed the redundant venue+date line**: `EventBlock` no longer
  builds/renders the auto-formatted `[venue, city] · [date] · [presale
  info] · [capacity]` paragraph under the subtitle — it duplicated the
  header meta row and often read badly for real venue names ("es bosq,
  recinto mallorca live, calvià, mallorca · sunday, 16 august 2026").
  `content.subtitle` is now the ONLY sub-title text; the local
  `formatEventDate` helper that built the killed line was removed with
  it. `view.venueName`/`venueCity`/`eventDate`/`presaleInfo`/`capacity`
  are UNCHANGED on the view-model seam (still computed, still tested) —
  only the renderer stopped reading them, per no-unrelated-refactor
  discipline.
- **Header meta row swapped again**: 6b had JUST changed this row to the
  on-sale timestamp; 6c changes it again, this time to
  `"{EEE d MMM} · {venue_short}"` (e.g. "Sun 16 Aug · Costa da Caparica")
  — `events.event_start_at` (Europe/London, a real pre-existing column
  distinct from the date-only `event_date`) + `content.venue_short`
  (falling back to the first comma-segment of `content.venue`, e.g.
  "Costa da Caparica, Portugal" → "Costa da Caparica"). Renders
  whichever of the two parts exists; hides entirely when NEITHER does.
  The on-sale info this row used to show hasn't disappeared — it moved
  into the countdown block's new static line (next bullet), which is
  the ONLY place it appears now (no duplication). `view.onSaleAt` is
  UNCHANGED and still feeds the post-signup confirmation card
  (signup-form.tsx) — this PR only touched what the HEADER reads.
- **Countdown header → static presale line**: the "PRESALE OPENS IN" +
  ticket-icon row is replaced by one static text line, "Presale: HH:mm
  EEE d MMMM" (e.g. "Presale: 11:00 Wed 8 July"), formatted from the
  SAME `targetAt` the 4-cell ticker below counts down to — no icon, no
  separate resolver. `formatOnSaleHeaderLabel` (6b) is fully retired;
  `format-datetime.ts` now exports `formatPresaleHeaderLabel` (shares a
  `fullDateTimeLabel` helper with the old function's logic) and the new
  `formatEventDateShort` for the header row above. `pageEvent.countdown_label`
  (e.g. "presale opens in") still flows through as the section's
  `aria-label` — only the VISIBLE text changed.
- **Brand socials row** (new `components/landing-pages/brand-socials.tsx`):
  a centred Instagram/TikTok row, 20px icons, 20px gap, between the
  bottom-media block and the footer. Sources `content.brand_instagram_url`
  / `content.brand_tiktok_url` — deliberately NOT the same content keys
  as the pre-existing (and now unrendered) footer `instagram_url` /
  `tiktok_url`. Icons are hand-rolled inline SVG paths (Simple Icons'
  public glyph data, pasted directly into the component — NOT a new
  package dependency; lucide-react, the repo's only icon library, ships
  no brand marks).
- **Footer simplified**: the black bar + white social-nav row are gone.
  One mono `#666` line, "Product by **Off/Pixel**" (only the link text
  underlined), no background — flows straight into the white page.
  Still gated on `show_off_pixel_attribution`, unchanged. `view.socialLinks`
  / `buildSocialLinks` (the footer's old instagram/tiktok/**tickets**
  link row) are now computed-but-unrendered dead code on the view-model
  seam — left in place (still exercised by `view-supreme.test.ts`'s
  URL-sanitisation coverage) rather than deleted, per no-unrelated-
  refactor discipline. A consequence worth flagging: `events.ticket_url`
  had NO other surface on this page before this PR (it only ever
  reached the fan via that footer "tickets" text link) — 6c makes it
  fully unreachable from `/l`. Nobody asked for a replacement CTA and
  the page is presale-signup-first by design, so none was added; flag
  to Matas if a direct ticket-buy path turns out to be wanted here.

## 18. Countdown reorder + compact ticker (PR 6d)

Three more post-review tweaks against the live GMC Mallorca page — Matas's
third review pass after 6c landed. Zero schema changes; no new fields
read. Called "6d" for the same reason 6b/6c were: avoids colliding with
the arc's own numbered "PR 9" (unrelated, still pending — see the plan
table above).

- **Countdown moved down the render tree**: `<CountdownBlock>` was
  sandwiched between the hero carousel and `<EventBlock>` (i.e. ABOVE
  the title) since PR 6. It now renders AFTER `<EventBlock>` and BEFORE
  `<SignupForm>` — reads as a lead-in nudge toward the form rather than
  its own mid-page section competing with the hero for attention. Pure
  JSX reorder in `landing-page.tsx`; no prop changes, no new gating
  logic (still `view.countdown ? … : null`).
- **Compact ticker**: the 4-cell grid shrank from a ~140px boxed section
  to a ~85px inline strip — container background dropped (`#fff` →
  `none`, since it no longer needs to visually separate itself from a
  taller layout), padding `14px 12px` → `8px 14px 12px`, grid gap
  `8px` → `6px`, cell padding `12px 6px` → `4px 6px`, number size `26px`
  → `17px`, label size `10px` → **`8px`**. That label size is a
  deliberate, brief-authorised exception to this repo's usual ≥10px
  floor (contrast the 6c footer, which was clamped UP to 10px against a
  9px ask) — the PR 6d brief named the exception explicitly for these
  ancillary DAYS/HOURS/MINS/SECS unit labels, so it's honoured verbatim
  here rather than re-clamped. All 4 cells still fit one row without
  wrap at 375px (verified in-browser) — the grid was already
  `repeat(4, 1fr)` full-width, so shrinking cell padding/font sizes was
  sufficient without a fixed pixel width per cell.
- **Presale line: full weekday**: `formatPresaleHeaderLabel` swaps
  `weekday: 'short'` → `weekday: 'long'` ("Presale: 11:00 Wed 8 July" →
  "Presale: 11:00 Wednesday 8 July"). The shared `fullDateTimeLabel`
  helper this function used to delegate to (introduced in 6c, when it
  also backed the now-retired `formatOnSaleHeaderLabel`) had exactly one
  remaining caller after 6c, so it's inlined directly into
  `formatPresaleHeaderLabel` rather than kept as a single-use
  indirection. **`formatEventDateShort`** (the top-right header meta
  row's formatter) is untouched and still `weekday: 'short'` — the brief
  was explicit that the two contexts (compact glance-info corner vs.
  prominent countdown callout) must NOT be unified onto the same format.

## 19. Presale line left-align (PR 6e)

One-line alignment fix after 6d landed — Matas's fourth review pass.
Zero schema changes; no new fields read. Called "6e" for the same reason
6b/6c/6d were.

- **Presale text line left-aligned**: `.countdownPresale` swaps
  `text-align: center` → `left`. Every other text block on the page
  (event title, subtitle, form labels, description) was already
  left-aligned; the centered presale line was the odd outlier. The
  `.countdown` container already used `padding: 8px 14px 12px` — the
  same `14px` horizontal inset as `.eventBlock` (`16px 14px 12px`) and
  `.form` (`4px 14px 16px`) — so only the text-align property needed
  to change; no padding tweak required for the "P" of "Presale" to line
  up with the "J" of the title and the "e" of "email address".
- **4-cell ticker unchanged**: only the static presale line above the
  grid changed; `.countdownGrid` / `.countdownCell` dimensions and the
  full-width `repeat(4, 1fr)` layout are byte-for-byte the same as 6d.
