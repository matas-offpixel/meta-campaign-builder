# Landing Page Architecture

**Status:** PR 1 (scaffold) — schema + public route skeleton. This document is
the reference for PRs 2–8; anything ambiguous here becomes rework downstream,
so treat it as the contract.

**Context:** Extends the D2C automation to auto-spawn client-branded event
landing pages, replacing Evntr.ee. Trial client: GMC Worldwide Productions
(Jackies + Throwback + Petardeo umbrella). Evntr.ee stays live as redundancy
until GMC's first 2 events pass live validation on the internal renderer.

---

## 1. Data model

Three tables (migration `132_landing_pages_scaffold.sql`). The split follows
one rule: **the client owns identity and brand; the event owns one page.**

### `client_landing_pages` — one row per client (unique `client_id`)

Client-level concerns only:

| Column | What it owns |
|---|---|
| `theme` jsonb | Brand theme. Schema TBD in PR 2 — renderers must treat missing keys as "use globals". |
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
| `theme_overrides` jsonb | Per-event deltas over the client theme (PR 2 defines merge semantics: event overrides client, client overrides globals). |
| `content` jsonb | Page content blocks. **Currently also carries `template_key`** — see the judgment call below. |
| `status` | `draft` → `live` → `archived`. The scaffold route renders drafts too; PR 2 decides whether `draft` becomes owner-only. |

> **Judgment call (PR 2 must resolve):** template binding lives at
> `content.template_key` (string, default `'mvp_v1'`) because PR 1's locked
> column list had no `template_id`. PR 2 should promote it to a real
> `template_key text references page_templates(key)` column (additive
> migration + one-line backfill from the jsonb). Do not build more logic on
> top of the jsonb location than the fallback that already exists in
> `lib/landing-pages/context.ts`.

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
events — client-side pixel fires (PR 3) and server-side CAPI pushes (PR 4) —
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
- RLS on both tables resolves ownership through the parent
  (`clients.user_id` / `events.user_id`) EXISTS chain — the migration-123
  pattern, no denormalised `user_id`.

**⚠ Naming landmine:** `clients.meta_pixel_id` already exists — it is the
pixel Off/Pixel runs **ad campaigns** against for that client (wizard
tooling). `client_landing_pages.meta_pixel_id` is the landing-page tenant
pixel. They may coincide for some clients but are separate concerns. **Never
fall back from one to the other in code.** If a PR needs "the client's pixel"
it must decide which one it means and say so.

For PR 4 (CAPI push): read the token via a dedicated SECURITY DEFINER
accessor in the shape of `get_d2c_credentials` (service-role or owner) — but
see §6 pgcrypto landmine before writing it.

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
hard security. **PR 2 follow-up (required):** the signup form is a WRITE
endpoint and needs a stronger shared limiter (Upstash or Postgres-based
counter) plus abuse controls (honeypot field, min-time-to-submit) — do not
reuse this read limiter for it.

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
| **2 — theming + template renderer** | Theme jsonb schema; theme/override merge semantics; block renderer for `hero`/`event_card`/`footer`; promote `template_key` to a real column; write-path rate-limit groundwork; design-reference translation | No pixel firing, no form submission |
| **3 — signup form + Pixel client-side** | `signup_form` block with real submission + storage (new table, event-scoped); loads the CLIENT's pixel from context; consent/cookie posture | No CAPI; no CRM push beyond storage |
| **4 — CAPI server-side** | `set/get` accessor RPCs for `meta_capi_token_encrypted` (schema-qualified pgcrypto! §6); server-side event push to the client's pixel; dedup with client-side fires via event_id | Never log tokens; never batch across clients |
| **5 — brief-parser extension** | D2C brief ingest also provisions `page_events` (+ `client_landing_pages` if missing) honouring `default_provider` | Do not touch d2c_* schemas beyond reading |
| **6 — analytics** | Page-view/section tracking, internal reporting | |
| **7+ — per-client add-ons** | TikTok pixel, Google Ads tag columns (per-client, same isolation contract), vanity slugs, admin UI | |

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

1. **pgcrypto search_path (BIT US 2026-07-01).** pgcrypto lives in the
   `extensions` schema (prod migration `131_enable_pgcrypto_for_d2c_credentials`),
   NOT `public`. A SECURITY DEFINER function with `set search_path = public`
   calling unqualified `pgp_sym_encrypt` throws `undefined_function`. **As of
   2026-07-01 the prod `set/get_d2c_credentials` functions (migration 042)
   still have exactly this bug** — extension enabled, functions not
   repointed; verified via live probe. Any function PR 4 writes must use
   `extensions.pgp_sym_encrypt(...)` (qualify — don't rely on search_path).
   Migration 132's verification block probes `extensions.pgp_sym_encrypt` at
   apply time so a misconfigured environment fails before code ships.
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
   by `lib/landing-pages/__tests__/public-prefix.test.ts`.

## 7. PR-1 verification runbook (Matas, pre-merge)

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
