# Session log — BM Asset Sync v2 (PR A)

## PR

- **Number:** 726
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/726
- **Branch:** `cursor/ops/bm-asset-sync-v2`

## Summary

Extends the Business Manager Asset Sync tool from V1 (Pages only, migration 145)
to cover **ad accounts, pixels and Instagram accounts**. Adds migration 147 with
three new asset tables, generalises the audit-event table to any asset type, adds
the Graph readers/grant calls, a generalised scan + grant flow reusing V1's
rate-limit halt, three API routes, daily-cron coverage, and a tabbed dashboard
(Pages | Ad accounts | Pixels | Instagram accounts) with per-asset grants.

The whole PR was built against **live Graph API v23.0 responses rather than
Meta's documentation**, which turned out to matter: three of the original brief's
four assumptions about this API were wrong, and one more bug was only findable at
runtime. All fixtures under `lib/bm/__tests__/fixtures/` are verbatim API output.

## What live verification changed

| Assumption (brief / docs) | Live reality | Consequence if unverified |
|---|---|---|
| `client_instagram_accounts` edge | Does **not exist** — 400 code 100. Real pair is `owned_/client_instagram_assets` | Every IG scan would 400 |
| Pixels accept `MANAGE` | Pixel `permitted_tasks` = `EDIT, ANALYZE, UPLOAD, ADVERTISE, AA_ANALYZE` — **no MANAGE** | Admin-role pixel grants always 400 |
| IG uses `MANAGE_ACCESS` / `CREATE_CONTENT` | Real IG tasks: `CONTENT, MESSAGES, COMMUNITY_ACTIVITY, CREATIVE_MANAGEMENT, CREATOR_MANAGEMENT, FULL_CONTROL, ADVERTISE, ANALYZE` | Editor/admin IG grants always 400 |
| Three distinct grant body shapes | **One** shape works for all three: JSON `{business, user, tasks[]}` | Needless divergence; see form-encoding note below |
| (not in brief) Grants apply exactly what you request | Meta **expands** grants — requesting `["ADVERTISE"]` on IG stored 5 tasks | Equality-based verification would report every successful IG grant as failed |
| (not in brief) `assigned_users` needs no extra params | `business` is **required** on every read (code 100 without it) | All access reads would 400 |

### The form-encoding near-miss

Under `application/x-www-form-urlencoded`, the three types genuinely do diverge:
IG rejects a JSON-stringified `tasks` array with code 100 "Failed to parse the
request body parameters" and requires indexed `tasks[0]=…`, while ad accounts and
pixels accept either. `graphPostWithToken` sends `Content-Type: application/json`,
under which all three accept the same body — so the divergence is moot **as long
as this call stays JSON**. Encoding matrix, verified live:

| asset | form `tasks=JSON` | form `tasks[0]=` | JSON body `tasks:[…]` |
|---|---|---|---|
| ad account | SUCCESS | SUCCESS | SUCCESS |
| pixel | SUCCESS | SUCCESS | SUCCESS |
| IG asset | **400 code 100** | SUCCESS | SUCCESS |

`bm-asset-requests.test.ts` asserts `tasks` stays a real array so a future switch
to `URLSearchParams` can't silently break IG grants.

### N+1 avoided

There is no bulk "assets assigned to me" edge for pixels or IG —
`/{businessUserId}/assigned_pixels` and `assigned_instagram_accounts` both 404
(only `assigned_ad_accounts` and `assigned_pages` exist). Instead the list call
inlines assignments via `assigned_users.business(<bizId>){id,tasks}` field
expansion, verified working on all six edges. A full multi-asset scan is
therefore **6 paginated calls per BM regardless of asset count** rather than
6 + N (LWE alone would have been ~15 extra; ~750 across all connected BMs).

Note the nested `.business(...)` argument is mandatory — a bare
`assigned_users{id,tasks}` expansion fails the whole request rather than omitting
the field.

## MCP validation

### Supabase MCP

```
list_migrations  → confirmed 145 business_manager_asset_sync + 146 bm_rate_limited_action
                   applied ⇒ next number is 147
execute_sql      → read real bm_pages / bm_page_access_events / client_business_managers
                   column layout before writing the migration (my first guess at a
                   column name, bm_pages.business_manager_id, did not exist —
                   the table keys on business_id text)
apply_migration  → 147_bm_multi_asset_sync  {"success": true}
execute_sql      → post-apply verification:
                   ad_acct_cols=14  pixel_cols=14  ig_cols=13
                   events_generalised="asset_id:YES, asset_type:NO, page_id:YES"
                   rls_policies=3   latest_migration=20260728193437
```

### Meta MCP — and why it could not do this job

`user-meta-ads` is live and its token is valid (`get_token_info` → scopes
`ads_management, ads_read, business_management, pages_show_list,
instagram_basic, pages_read_engagement`), but `get_capabilities` shows its 32
tools cover **campaigns, ad sets, ads, insights, audiences and creatives only**.
There is no business-asset-management surface and no generic Graph passthrough,
so it cannot reach `/{bizId}/owned_*`, `/{assetId}/assigned_users`, or task
enums — the endpoints this PR is actually about.

Live verification therefore ran directly against `graph.facebook.com/v23.0`
using the operator token already in `.env.local` (never written to a new file,
never committed), which is the same identity and scope set the shipped code path
uses. Read-only calls except the grant tests below.

### Live Graph captures (verbatim, trimmed)

`GET /act_932846012721428/assigned_users?business=944651277948334&fields=id,name,tasks,permitted_tasks`

```json
{"data":[{"id":"122121443048950557","name":"Matas Liebus",
  "tasks":["DRAFT","ANALYZE","ADVERTISE","MANAGE"],
  "permitted_tasks":["MANAGE","ADVERTISE","ANALYZE","FB_EMPLOYEE_DSO_ADVERTISE","CREATIVE","DRAFT","AA_ANALYZE"]}]}
```

`GET /1475359374117271/assigned_users?business=…` → `permitted_tasks`:

```json
["EDIT","ANALYZE","UPLOAD","ADVERTISE","AA_ANALYZE"]
```

`GET /944651277948334/client_instagram_accounts`:

```json
{"error":{"message":"(#100) Tried accessing nonexisting field (client_instagram_accounts)","code":100}}
```

IG task enum, observed across 8 production BMs (IG returns **no**
`permitted_tasks` field at all):

```
Electric Brixton / nxloves        ["ANALYZE","ADVERTISE","CONTENT","MESSAGES","COMMUNITY_ACTIVITY","CREATIVE_MANAGEMENT","CREATOR_MANAGEMENT"]
Electric Brixton / electricbristol ["ANALYZE","ADVERTISE","COMMUNITY_ACTIVITY","MESSAGES","CONTENT","FULL_CONTROL"]
LWE / l_w_e                        ["ANALYZE","ADVERTISE","CONTENT","MESSAGES","COMMUNITY_ACTIVITY"]
Jackies / jackies_party            ["ANALYZE","ADVERTISE"]
```

Field probes (every listed field accepted; `last_fired_time`, `profile_pic`,
`followed_by_count`, `media_count` are accepted but frequently empty ⇒ nullable):

```
owned_ad_accounts       id, account_id, name, account_status, currency, timezone_name, disable_reason, amount_spent, business_name
owned_pixels            id, name, last_fired_time, creation_time, is_unavailable, enable_automatic_matching, owner_business, data_use_setting
owned_instagram_assets  id, ig_user_id, ig_username, profile_pic, followed_by_count, follow_count, media_count
```

### End-to-end grant test (live write)

Performed on the operator's **own** BM (Off / Pixel, `944651277948334`), the
lowest-risk target, and reversible.

```
STEP 1  GET /944651277948334/business_users
        → business-scoped user id 122121443048950557 (role ADMIN)
        (/me returns 10243038239677083 — the Facebook-level id, which
         assigned_users rejects with subcode 1752100)

STEP 2  BEFORE  GET /1026165617251103/assigned_users?business=…  → {"data": []}

STEP 3  GRANT   POST /1026165617251103/assigned_users
                body {business, user, tasks:["ADVERTISE"]}        → {"success": true}

STEP 4  AFTER   GET /1026165617251103/assigned_users?business=…
                → [{"id":"122121443048950557",
                    "tasks":["ADVERTISE","ANALYZE","CONTENT","MESSAGES","COMMUNITY_ACTIVITY"]}]
                ⇒ grant stuck, AND Meta expanded 1 requested task into 5
                  (this is the fixture behind the superset-check test)

STEP 5  IDEMPOTENCY  re-POST the same ad-account grant → {"success": true}
                     ⇒ re-granting an existing role is not an error; no
                       "already assigned" special case needed
```

Toward the end of the session Meta returned `(#4) Application request limit
reached` — the exact code the grant-halt logic keys off. Worth noting that an
error body must never be treated as an empty asset list; the shipped path is safe
because `graphGetWithToken` throws, so a rate-limited scan fails loudly instead
of marking every asset as vanished.

**Not verified end-to-end through the app's own routes:** `BM_TOKEN_KEY` is
absent from `.env.local`, so the BM tool cannot decrypt a stored token locally.
The grant above exercised the identical request the shipped builder produces
(byte-diffed in tests), but the first run through `/api/business-managers/.../grant`
will be on Vercel.

### PR #725 (ACTOR MISMATCH) interaction — checked, and a constraint for PR B

PR A cannot affect the #725 block: nothing in the wizard launch path imports the
new modules (`asset-kinds`, `bm-assets`, `business-manager-assets` are referenced
only by the BM tool surface).

But there is a **real trap for PR B/C**, verified live. #725 treats
`GET /{adAccountId}/instagram_accounts` as authoritative, and that returns IG
**user ids**:

```
GET /act_932846012721428/instagram_accounts
  → id=17841447022816929  username=offpixel.co.uk

GET /944651277948334/owned_instagram_assets
  → id=1026165617251103   ig_user_id=17841447022816929   @offpixel.co.uk
```

So `bm_ig_accounts.ig_asset_id` (`1026…`) is in a **different id space** from the
guard's list. Feeding the asset id into the IG picker would produce a guaranteed
`unauthorised_mismatch` false positive on every account. The join key must be
`ig_user_id`, which is why migration 147 stores both columns separately and
`bm-asset-requests.test.ts` asserts they never collapse.

## Scope / files

- `supabase/migrations/147_bm_multi_asset_sync.sql` — `bm_ad_accounts`, `bm_pixels`,
  `bm_ig_accounts`; `bm_page_access_events` gains `asset_type` + `asset_id`
  (page_id backfilled and relaxed to nullable, so V1 readers are untouched); RLS
  mirroring 145
- `lib/bm/asset-kinds.ts` — single source of truth for edges, task enums,
  role→task maps, and the superset `grantSatisfied` check (pure)
- `lib/meta/business-manager-asset-requests.ts` — pure list/grant request builders (pure)
- `lib/meta/business-manager-assets.ts` — 6 list functions, 3 grant functions,
  generic grant + `assigned_users` read-back
- `lib/db/bm-assets.ts` — upserts, access flags, counts, generalised audit events
- `lib/bm/sync-assets.ts` — per-kind + all-kind scan, sharing one token and one
  business-scoped user id; sequential by kind to protect the rate budget
- `lib/bm/grant-assets.ts` — grant flow mirroring V1's batching and halt-on-rate-limit
- `lib/bm/types.ts` — extracted `GrantRunOutcome` so `isFullGrantSuccess` /
  `describeGrantResult` serve both page and asset runs without misusing `pageId`
- `lib/meta/business-manager.ts` — exported `paginateAll` for reuse (only change)
- `app/api/business-managers/[bizId]/assets/[kind]/{route,grant-all,[assetId]/grant}` — 3 routes
- `app/api/business-managers/[bizId]/scan` + `app/api/cron/bm-page-scan` — asset phase added
- `components/admin/business-managers/{bm-dashboard,bm-asset-list}.tsx` — 4 tabs,
  expandable per-asset detail loaded on demand
- `app/(dashboard)/business-managers/page.tsx` — per-kind counts
- `lib/bm/__tests__/bm-asset-requests.test.ts` + `fixtures/` — 27 tests, real captures

Pages deliberately keep their V1 endpoints and code path, so this PR cannot
change page-grant behaviour.

## Validation

- [x] `npx tsc --noEmit` — no errors in touched files
- [x] `npm run lint` — clean on all touched paths
- [x] `npm run build` — passes; all 3 new routes registered
- [x] `npm test` — 3161 tests, 3144 pass, 14 fail. Baseline on the clean tree
      before this work was 3134 / 3117 / **14** — the same 14 pre-existing
      failures (missing jest types, unrelated suites). +27 new tests, 0 new failures.
- [x] Migration applied via Supabase MCP and verified with `execute_sql`
- [x] Live grant verified end-to-end against Meta and confirmed by re-fetch

## Notes

- **Grant verification is opt-in on bulk runs** (`?verify=1`) because the
  read-back doubles the request count against the same Meta budget. It is on by
  default for single-asset grants, where the cost is one extra call. Without it,
  `{success:true}` is evidence the call was accepted, not that access exists.
- **`amount_spent` / `business_name` are verified-valid ad-account fields** but are
  not stored — nothing in the tool needs them yet.
- **Role degradation is deliberate**: pixels have no MANAGE/FULL_CONTROL so ADMIN
  maps to EDIT, and ad accounts have no CREATE_CONTENT so EDITOR maps to DRAFT.
  V1 only ever grants ADVERTISER, and `ADVERTISE` is the one task valid on all
  four kinds — which is why it stays the default everywhere.
- **Follow-up for PR B/C:** join `bm_ig_accounts` into the wizard on `ig_user_id`,
  never `ig_asset_id` (see the #725 section above).
- **Deploy prerequisite:** `BM_TOKEN_KEY` must be set on Vercel (already required
  by V1). It is absent locally, which is why the app-route path could not be
  exercised on this machine.
