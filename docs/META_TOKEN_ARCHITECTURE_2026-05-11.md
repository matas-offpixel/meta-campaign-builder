# Meta Token Architecture — 2026-05-11

## TL;DR

The tool resolves Meta tokens through exactly one shared codepath (`resolveServerMetaToken` in `lib/meta/server-token.ts:119`, plus its read-only twin `getOwnerFacebookToken` in `lib/db/report-shares.ts:674`), and both return Matas's personal OAuth user token from `user_facebook_tokens` for every Meta call — UI reads, audience writes, cron sweeps, campaign launches, all of it. That's why WC26's 61-event bulk audience build collides with `refresh-active-creatives` / `rollup-sync-events` / `refresh-creative-insights` against a single per-user (#17) rolling budget. **Phase 1 fix: introduce a per-client *System User* token, store it encrypted on `clients`, and route the two highest-volume non-interactive paths (the rollup-sync Meta leg and the audience-builder bulk write) to it as a canary.** Personal-token paths stay live as the fallback. System User tokens hit a different rate-limit family (Business Use Case, per-ad-account) so reporting cron and audience builder stop sharing the #17 user-bucket.

---

## 1. Current state — every code path that resolves a Meta token

There are **two** resolvers and they both return the same personal-OAuth row.

### A. `resolveServerMetaToken(supabase, userId)` — `lib/meta/server-token.ts:119`

DB-first read of `user_facebook_tokens.provider_token`, env-var (`META_ACCESS_TOKEN`) as last-resort fallback. Used by **interactive UI surfaces, wizard writes, and all crons** that run in the user's session context. Concrete callers (verified by grep):

| Caller | Scope | Edge | Token used |
|---|---|---|---|
| `app/api/meta/ad-accounts/route.ts:20` | UI | `/me/adaccounts` | personal |
| `app/api/meta/pages/route.ts:96` | UI | `/me/accounts` | personal |
| `app/api/meta/pixels/route.ts:28` | UI | `/{act}/adspixels` | personal |
| `app/api/meta/campaigns/route.ts:136` | UI | `/{act}/campaigns` | personal |
| `app/api/meta/saved-audiences/route.ts:77` | UI | `/{act}/saved_audiences` | personal |
| `app/api/meta/custom-audiences/route.ts:94` | UI | `/{act}/customaudiences` | personal |
| `app/api/meta/upload-asset/route.ts:26` | wizard write | `/{act}/advideos` POST | personal |
| `app/api/meta/launch-campaign/route.ts` | wizard write | `/{act}/campaigns` POST + ad sets + creatives + ads | personal |
| `app/api/meta/adsets/route.ts:162` | wizard read | `/{act}/adsets` | personal |
| `app/api/audiences/sources/{pages,pixels,campaigns,campaign-videos,multi-campaign-videos,prewarm}/route.ts` | audience-builder UI | various `/{act}/*` reads | personal |
| `app/api/audiences/bulk/preview/route.ts:67` | audience-builder bulk read | dry-run video walk | personal |
| `app/api/audiences/bulk/create/route.ts:74` | **audience-builder bulk write** | `/{act}/customaudiences` POST × N | personal |
| `app/api/insights/event/[eventId]/route.ts:139` + sibling `creatives`/`spend-by-day` | dashboard live reads | `/{act}/insights` | personal |
| `app/api/reporting/event-campaigns/route.ts:164` | dashboard | campaign-level insights | personal |
| `app/api/overview/stats/route.ts:125` | library dashboard | aggregate insights | personal |
| `app/api/intelligence/creatives/route.ts:164` | creative intelligence | `/{act}/ads` + creative hydration | personal |
| `app/api/clients/[id]/venues/[event_code]/daily-budget/route.ts:113` | venue daily-budget UI | `/{campaign_id}/insights` | personal |
| `app/api/insights/venue/[clientId]/[event_code]/route.ts:112` | venue insights | `/{act}/insights` | personal |
| `app/api/admin/event-rollup-backfill/route.ts:309,442` | one-shot backfill | full rollup walk | personal |
| `app/api/internal/scan-enhancement-flags/route.ts:159` | enhancement-flags cron (per-client) | `/{ad_id}?fields=creative` | personal (resolved via `client.user_id`) |
| `app/api/cron/refresh-creative-insights/route.ts:278` | cron | creative-insights heatmap | personal |
| `app/api/admin/meta-enhancement-probe/route.ts:233` | admin probe | enhancement keys | personal |
| `lib/reporting/rollup-server.ts:226` (`rollup-sync-events` cron) | **cron** | event daily metrics | personal |
| `lib/dashboard/rollup-sync-runner.ts:468,708` | cron + admin backfill | Meta + Google Ads legs | personal |
| `lib/meta/audience-write.ts:77,167` | wizard + bulk audience write | `/{act}/customaudiences` POST + PATCH | personal |

### B. `getOwnerFacebookToken(userId, admin?)` — `lib/db/report-shares.ts:674`

Same row, service-role read. Used by **public share-token surfaces** (no logged-in user available). Callers:

| Caller | Scope | Edge |
|---|---|---|
| `app/share/report/[token]/page.tsx:275` | share-report render | snapshot-first (PR #87) but falls back to live |
| `app/api/share/report/[token]/creatives/route.ts:97` | share-report active creatives | account-level `/ads` + `/?ids=` hydration |
| `app/api/share/venue/[token]/insights/route.ts:87` | share-venue insights | `/{act}/insights` |
| `app/api/share/client/[token]/venue-creatives/[event_code]/route.ts:168` | share-venue creatives | account-level `/ads` |
| `app/api/internal/clients/[clientId]/venue-creatives/[event_code]/route.ts:179` | internal venue creatives | same as share variant |
| `lib/reporting/share-active-creatives.ts:145` | share + internal active creatives | account-level `/ads` |
| `lib/meta/creative-thumbnail-get.ts:177`, `creative-thumbnail-warm.ts:24` | thumbnail backfill | `/{creative_id}?fields=thumbnail_url` |

### C. `lib/meta/page-token.ts` — page-scoped tokens

Exchanges the personal user token for a Page token via `/{page_id}?fields=access_token` (`lib/meta/page-token.ts:21-27`). Used for `/{page_id}/published_posts` and IG-linked account reads. **Still derived from Matas's personal token.**

### D. Direct env-var (`META_ACCESS_TOKEN`)

`lib/meta/client.ts:80` (`graphGet`, no-token variant) reads `process.env.META_ACCESS_TOKEN` directly. Today this env var is set in Vercel to Matas's long-lived token; it functions as a "system default" but it's still a personal user token.

**Verdict:** every single path above shares the *same* rolling rate-limit bucket: Meta's per-user `#17` budget for Matas's user-id, plus per-ad-account `#80004` budgets per client. The independence we have between clients (different ad accounts = different #80004 buckets) is wasted because every call also charges the same #17 budget.

---

## 2. Meta's token options (verified May 2026)

| Token type | Lifetime | Rate-limit family | Can create custom audiences? | Can read insights? | Can upload videos? |
|---|---|---|---|---|---|
| **User token** (OAuth) | 60 days, extendable | Platform Rate Limits — per-app-per-user (#17 + #4) | Yes (with `ads_management`) | Yes | Yes |
| **App access token** (`{app_id}|{app_secret}`) | Non-expiring | Platform Rate Limits — per-app aggregate | Yes for some flows; **fails** on most Marketing API write edges because they require a user context | Yes for public data | No |
| **System User token** (Business Manager → Users → System users) | **Non-expiring** | Business Use Case (BUC) — **per-ad-account, per-BUC** | **Yes** (Employee role + `ads_management` + ad-account Full Control) | **Yes** | **Yes** |
| **Page access token** | Derived from above, scoped to page | Inherits parent's family | N/A | N/A | N/A |

The load-bearing facts:

- **Per Meta's own docs:** "requests made with application or user access tokens are subject to Platform Rate Limits, while requests made with system user or page access tokens are subject to Business Use Case Rate Limits." That's the split we exploit.
- **BUC pool is per-ad-account, per-use-case.** Quote: "all endpoints with the Ads Management business use case will share the total quota within the same ad account." So a System User token writing audiences to 4thefans's ad account 1015… does NOT consume budget against Junction 2's ad account 7864…
- **System User tokens are non-expiring.** Solves the Facebook-reconnect-bug pain entirely for the migrated paths.
- **`X-Business-Use-Case-Usage` header** reports `call_count`, `total_cputime`, `total_time`, `estimated_time_to_regain_access` per ad-account-per-BUC, so we can observe the new bucket in real time (we already parse this header in `lib/meta/client.ts` for #80004 detection).
- **Standard tier formula:** ~100,000 points/hour + 40 points/active-ad per ad-account per BUC. At 4thefans's typical 300 ads that's a ~112k point/hour budget per ad account, dedicated to Ads Management. The #17 user-bucket is dwarfed by this — by an order of magnitude — because it's a single rolling pool across every ad account Matas touches.

---

## 3. Rate-limit reality check

Three error families fire in different conditions:

- **#17 "User request limit reached"** — fires on the *user token's* rolling 1-hour bucket. Today this is the binding constraint because **every cron + UI + write call charges this one bucket**. WC26's 61-event audience build trips it because audience-create POSTs (cheap individually) compound across 3 funnel stages × 61 events = 183 sequential calls within minutes, on top of whatever the parallel reporting cron is doing.
- **#80004 "There have been too many calls from this ad-account"** — per-ad-account hourly lockout, ~60-min recovery. Already isolated per client. Not the binding constraint today; this is what we'll see *more* of once we move to System User tokens because BUC accounting is finer-grained. That's fine — it's the right shape because it blocks one client without blocking another.
- **#4 / #2 "Application request limit reached"** — per-app aggregate budget. Only a concern if we run many distinct apps; we don't.

The `lib/audiences/meta-rate-limit.ts:31-65` classifier already distinguishes these three. Migration to System User tokens preserves that classifier — we'll see more #80004 (per-client) and fewer #17 (cross-client cascade). That's the intended shape.

---

## 4. Token-pool design options

**Option A — Per-client System User tokens, stored encrypted on `clients`.** ⭐ Winner.

- Each client onboards their own System User in their Business Manager (we provide a 5-min Loom). They paste the token into Account Setup; we encrypt-at-rest via the existing `pgcrypto` setup (mig 038 pattern) under a new `META_SYSTEM_TOKEN_KEY` env var.
- Resolver becomes: `resolveSystemUserToken(clientId)` first → fall back to `resolveServerMetaToken` (personal) if no system user provisioned.
- Pro: each client's ops live in their own BUC bucket. Reporting cron stops competing with audience builder for #17. Tokens never expire. Onboarding is one-time per client.
- Con: 5-min onboarding ceremony per client. Clients without BM access (rare for our retainer tier) can't provision — they stay on personal-token path.
- Blast radius if compromised: scoped to one client's ad account. Rotate by deleting + re-provisioning the System User.

**Option B — Single Off/Pixel System User token across all clients via Partner BM.** Rejected.

- We add Off/Pixel BM as a partner on each client's BM and create *one* System User in Off/Pixel BM with ad-account access granted to it.
- Pro: zero onboarding ceremony per client; one token.
- Con: every client back in the same BUC-per-ad-account bucket per BUC, but the system user *itself* still has app-level limits when fanning out across many accounts. Worse: if the Off/Pixel BM gets disabled (it has happened to agency BMs over policy reviews), every client breaks at once.
- Blast radius if compromised: every client.

**Option C — Hybrid (UI on personal, cron/bulk on System User).** Folds into A.

- This is the *migration shape*, not a destination. Phase 1 routes cron + bulk writes to System User; Phase 3 routes UI reads too. Already implied by the staged plan in §5.

**Option D — Token-rotation pool of N personal tokens (multiple "fake Matas" users).** Rejected.

- Buys ~N× #17 budget but doesn't fix the cross-client cascade (still one app, still per-user rolling buckets that aggregate poorly).
- Also: each personal token still expires every 60 days. Multiplies the reconnect-bug surface area.
- Only legitimate as a 24-hour stopgap if we needed to ship tonight before tomorrow's WC26 launch. **Not recommended.**

---

## 5. Migration plan

**Phase 1 — Canary on rollup-sync Meta leg + audience bulk write (1 PR, 1 day Sarah-led).**

- New migration `075_clients_meta_system_user_token.sql`: add `clients.meta_system_user_token_encrypted bytea`, `meta_system_user_token_set_at timestamptz`, `meta_system_user_token_last_used_at timestamptz`. Reuse `pgcrypto` SET/GET RPC pattern from mig 038 with a new `META_SYSTEM_TOKEN_KEY` env var.
- New resolver `lib/meta/system-user-token.ts` (`resolveSystemUserToken(clientId, supabase)`) — DB read via service-role RPC, returns `{ token, source: 'system_user' | null }` (null = caller falls back).
- New onboarding UI: Account Setup gains a "Meta System User token" field, behind a feature flag `OFFPIXEL_META_SYSTEM_USER_ENABLED`. Save → encrypt → store. Validate via `/debug_token` round-trip before persisting (reuse `validateMetaToken` at `lib/meta/server-token.ts:51`).
- Route the **two highest-volume non-interactive paths**:
  - `lib/dashboard/rollup-sync-runner.ts:468,708` — Meta leg of `rollup-sync-events` cron. **Reason:** runs 5×/day per event, ~50+ events at scale, biggest current consumer of #17 budget for read-only work. Already passes a `userId` and resolves token there — swap to `resolveSystemUserToken(event.client_id) ?? resolveServerMetaToken(supabase, userId)`.
  - `lib/meta/audience-write.ts:77,167` — both `createMetaCustomAudience` and `updateMetaCustomAudience`. **Reason:** this is the path WC26 trips. Audience POST is `ads_management` BUC, perfectly suited for System User tokens.
- **Provision Matas's System User for 4thefans** as the canary subject. Other clients keep personal-token path until they onboard their own.
- Observability: log `tokenSource=system_user|db|env` on every call and surface in `/api/internal/meta-budget` (introduced in PR-H of META_API_BOTTLENECKS_2026-05-08.md when it lands).

**Phase 2 — Migrate remaining crons + share surfaces (1 PR, ~1 day).**

- `app/api/cron/refresh-creative-insights/route.ts:278` → System User.
- `app/api/internal/scan-enhancement-flags/route.ts:159` → System User.
- `app/api/cron/refresh-active-creatives/route.ts` (the eligibility runner) → System User.
- `lib/reporting/share-active-creatives.ts:145` + all `getOwnerFacebookToken` callers → System User with `getOwnerFacebookToken` as fallback. Share-render path stays alive even if a client never provisions a System User.

**Phase 3 — Migrate UI reads + wizard writes (1 PR, ~1-2 days).**

- All `app/api/meta/*` routes (`/ad-accounts`, `/pages`, `/pixels`, `/campaigns`, `/saved-audiences`, `/custom-audiences`, `/launch-campaign`, `/upload-asset`, etc.) check for a System User token on the active client and prefer it; fall back to personal. Personal stays for clients without System User provisioned and for cross-client surfaces (Library, Overview, the wizard's *initial* ad-account picker before a client is chosen).

**Gotchas:**

- **Video upload** (`/{act}/advideos` POST): works with System User tokens **provided** the System User has Full Control on the ad account AND the app has Ads Management Standard access. We have both. No code change beyond the token swap.
- **Page/IG operations** (`lib/meta/page-token.ts`): Page tokens derived from a System User token only work if the System User has Full Control on the *Page*. Currently we exchange from the user token. For Phase 3 we need a per-client Page-token resolver that prefers System User exchange. Defer to Phase 4 if needed.
- **`/me` edges** (`/me/adaccounts`, `/me/accounts`): a System User token's `/me` is the System User itself, not the human. Use `/{business_id}/owned_ad_accounts` and `/{business_id}/owned_pages` instead. Affects `/api/meta/ad-accounts` and `/api/meta/pages`. Phase 3 work.
- **`ads_management` permission must be granted at the App level with Standard access** (we have this). System User must be assigned the app + ad account with Full Control.

---

## 6. What this unlocks beyond fixing WC26

- **Multi-tenant scaling.** New retainer (Junction 2, Louder, BR) onboards their System User and adds zero load to the shared #17 bucket. The 5-retainer target from META_API_BOTTLENECKS_2026-05-08.md becomes feasible.
- **Reporting/audience isolation.** Bulk audience write at 8am no longer steals budget from the 8:15am `rollup-sync-events` cron, even on the same client (different BUCs).
- **No more 60-day reconnect bug for the migrated paths.** System User tokens are non-expiring; the Facebook reconnect cascade only affects clients still on the personal-token fallback.
- **Stage 4 webhook + queue feasibility** (META_API_BOTTLENECKS_2026-05-08.md §3): webhook-driven jobs need to authenticate as the *client*, not as Matas. System User tokens are the only sensible auth shape for that. Phase 1 unblocks the rest of the scaling roadmap.
- **Productisation path.** When clients self-onboard via OAuth (eventually), we never need to use Matas's personal token for their data. Compliance posture improves materially — the personal token currently has read access to every connected ad account, which is fine for an internal tool but blocks self-serve.

---

## 7. Phase 1 PR — ready-to-paste prompt

```
[Cursor, Opus] Phase 1: Per-client Meta System User tokens (canary on rollup-sync + audience write)

CONTEXT: Read /docs/META_TOKEN_ARCHITECTURE_2026-05-11.md sections 1, 4, and 5 before
starting. The full inventory and design rationale are there. This PR is the Phase 1
canary only — do NOT touch UI routes or share-token paths in this PR.

GOALS (in order):

1. New migration 075_clients_meta_system_user_token.sql:
   - ALTER TABLE clients ADD COLUMN meta_system_user_token_encrypted bytea,
     meta_system_user_token_set_at timestamptz, meta_system_user_token_last_used_at timestamptz.
   - Create set_meta_system_user_token(client_id uuid, token text) and
     get_meta_system_user_token(client_id uuid) RETURNS text — pgcrypto AES-GCM
     using env-var key META_SYSTEM_TOKEN_KEY (mirror the EVENTBRITE_TOKEN_KEY pattern
     from migration 038). Both functions SECURITY DEFINER, REVOKE from anon/authenticated,
     GRANT EXECUTE to service_role only.
   - Verify migration applied in Supabase MCP after merge (memory rule).

2. New module lib/meta/system-user-token.ts:
   - export async function resolveSystemUserToken(clientId, supabase): Promise<{token, source: 'system_user'} | null>.
   - Use service-role client to call get_meta_system_user_token RPC. Return null on missing/null/error
     (don't throw; caller falls back to personal token).
   - Update meta_system_user_token_last_used_at on successful resolve (best-effort, fire-and-forget).
   - Add validation via lib/meta/server-token.ts#validateMetaToken before write (in PR for the
     Account Setup UI patch — see goal 4).
   - Log [resolveSystemUserToken] tokenSource=system_user clientId=... or skip=no_row|no_key|error.

3. Route TWO call sites to the new resolver, with personal fallback:
   - lib/dashboard/rollup-sync-runner.ts:468 and :708 (Meta leg). The runner receives userId today;
     it now also needs clientId (already available via the event row earlier in the function — pass it
     down through processEvent). Prefer system user, fallback resolveServerMetaToken.
   - lib/meta/audience-write.ts:77 (createMetaCustomAudience) and :167 (updateMetaCustomAudience).
     Both receive audience.metaAdAccountId; look up the owning client by ad-account-id (new helper
     lib/db/clients.ts#findClientByMetaAdAccountId(adAccountId): {id, userId} | null) before resolving.

4. Account Setup UI patch (components/wizard/steps/account-setup.tsx — find the existing client
   settings section, do NOT add a new step):
   - New collapsed "Advanced: Meta System User token" section, only rendered when
     OFFPIXEL_META_SYSTEM_USER_ENABLED=true.
   - Single textarea + Save button. On save: POST /api/clients/{id}/meta-system-user-token
     with the raw token. Server validates via validateMetaToken (must return valid:true with
     scopes including ads_management), then calls set_meta_system_user_token RPC.
   - Display masked preview (first 8 + last 4 chars) + meta_system_user_token_set_at timestamp.
   - "Remove" button calls DELETE on same route; nulls the column.

5. Tests:
   - lib/meta/__tests__/system-user-token.test.ts — happy path, no-row returns null, expired
     /debug_token validation rejected on save.
   - lib/meta/__tests__/audience-write.test.ts — assert createMetaCustomAudience prefers system
     user when present, falls back to personal when null. Use a MetaAudiencePost stub.

6. Telemetry:
   - Every call to graphGetWithToken downstream of these two paths logs tokenSource. Add a
     `tokenSource` parameter to runRollupSyncForEvent diagnostics and surface in /api/cron/rollup-sync-events
     summary response.

OUT OF SCOPE (separate PRs):
- All app/api/meta/* UI routes (Phase 3).
- All getOwnerFacebookToken share paths (Phase 2).
- /me/ad-accounts replacement with /{business_id}/owned_ad_accounts (Phase 3 gotcha — see §5).
- A "test connection" button in Account Setup that does a /me/businesses ping (nice-to-have, not gating).

GATING / VERIFICATION:
- Do NOT merge until migration 075 is verified applied in Supabase prod.
- Provision Matas's 4thefans System User manually first; obtain token; save via the new Account Setup
  field; verify /api/cron/rollup-sync-events?clientId=<4tF-id> log line shows tokenSource=system_user.
- One full audience-builder bulk-create against 4thefans (3 funnel stages × 1 test event) must succeed
  with tokenSource=system_user in logs and no #17 surfaced on parallel rollup-sync run.
- Smoke test: with OFFPIXEL_META_SYSTEM_USER_ENABLED=false, the new resolver MUST be skipped (no DB read),
  ensuring full rollback safety via env flag.

BRANCH: cursor/meta-system-user-canary
MERGE: `gh pr merge --auto --squash --delete-branch` once smoke test confirmed.
```

Sources:
- [Rate Limits — Graph API (Meta)](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Rate Limiting — Marketing API (Meta)](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/)
- [Access Token Guide — Facebook Login (Meta)](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [Authorization — Marketing API (Meta)](https://developers.facebook.com/docs/marketing-api/get-started/authorization)
- [Limits & Best Practices — Marketing API (Meta)](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)
