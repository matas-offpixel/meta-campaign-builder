# Plan spine unattended run — 2026-08-25

Phase D of the engine roadmap (plus E.3-lite and C.1). Stacked PRs; nothing merged to main.

Purpose: one set of inputs launches Meta + TikTok + Google at once with a shared goal and budget, reporting into one dashboard that recommends across all three.

## Merge order (morning)

1. [#845](https://github.com/matas-offpixel/meta-campaign-builder/pull/845) `cursor/plan-d0` → `main`
2. [#846](https://github.com/matas-offpixel/meta-campaign-builder/pull/846) `cursor/plan-d1` → `cursor/plan-d0`
3. [#847](https://github.com/matas-offpixel/meta-campaign-builder/pull/847) `cursor/plan-d2` → `cursor/plan-d1`
4. [#848](https://github.com/matas-offpixel/meta-campaign-builder/pull/848) `cursor/plan-d3` → `cursor/plan-d2`
5. [#849](https://github.com/matas-offpixel/meta-campaign-builder/pull/849) `cursor/plan-d4` → `cursor/plan-d3`
6. [#850](https://github.com/matas-offpixel/meta-campaign-builder/pull/850) `cursor/plan-e3` → `cursor/plan-d4`
7. [#851](https://github.com/matas-offpixel/meta-campaign-builder/pull/851) `cursor/plan-c1` → `cursor/plan-e3`

Do not merge out of order. Do not merge to main until 845 is reviewed.

## Per PR

### [#845](https://github.com/matas-offpixel/meta-campaign-builder/pull/845) — D.0 · `cursor/plan-d0`

- **Shipped:** Paused-everywhere audit; Meta `createPaused` (wizard stays ACTIVE); `meta_write_idempotency` migration 156 + additive runtime wrap.
- **Inventory:** Meta created ACTIVE (now optional PAUSED). TikTok `operation_status: DISABLE`. Google campaign/ad group/RSA PAUSED; keywords ENABLED. Real Google launcher is `POST /api/google-search/[id]/push`. Meta has no rollback; `clearMetaWriteIdempotency` exists unused.
- **Suite:** 4427 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent `d012c7f` — ACTIVE !== PAUSED; route lacked `createPaused`.

### [#846](https://github.com/matas-offpixel/meta-campaign-builder/pull/846) — D.1 · `cursor/plan-d1`

- **Shipped:** `campaign_plans` + three 1:1 launch tables (no platform enum). Types in `lib/plan/types.ts`. Status includes `live_partial`. RLS `auth.uid() = user_id`.
- **Inventory:** No `audience_clusters` / `creative_sets` tables — refs are text. Google child FK is `google_search_plans` (096), not `google_ad_plans` (017).
- **Suite:** 4436 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent lacked `lib/plan/types.ts` (exit 128).

### [#847](https://github.com/matas-offpixel/meta-campaign-builder/pull/847) — D.2 · `cursor/plan-d2`

- **Shipped:** `lib/plan/adapters/{meta,tiktok,google}.ts` + combined preflight. No launch.
- **Inventory:** TikTok `CONVERSIONS` retired → `LEAD_GENERATION`. Google adapter does not invent keywords. Meta has no extracted collect-preflight — reused payload validators.
- **Suite:** 4440 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent lacked `lib/plan/adapters/meta.ts` (exit 128).

### [#848](https://github.com/matas-offpixel/meta-campaign-builder/pull/848) — D.3 · `cursor/plan-d3`

- **Shipped:** Orchestrator + `GET`/`POST /api/plan/launch` behind `ENABLE_PLAN_FANOUT === "1"` else `skippedReason: "killswitch"`. Sequential; sibling failure → `live_partial`, no rollback. Meta via existing launch POST with `createPaused: true`. TikTok via `handleTikTokLaunch`. Google is a named failure until account id + persisted search-plan tree exist.
- **Inventory:** No cron imports `lib/plan`. Full outgoing payload logged via `console.error`.
- **Suite:** 4447 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent `c42be02` lacked `lib/plan/orchestrator.ts`.

### [#849](https://github.com/matas-offpixel/meta-campaign-builder/pull/849) — D.4 · `cursor/plan-d4`

- **Shipped:** `/plans` + `/plan/[id]` workspace, adapter previews, **Launch all (paused)** disabled with named gate reason, Ads Manager links, honest empty states. Plans nav item.
- **Inventory:** `campaign_plans` unapplied — list degrades to the 157 empty state. TikTok Ads Manager has no campaign-selection param. Advertiser id used only when the user has exactly one `tiktok_accounts` row. Fan-out still does not persist launch child rows.
- **Suite:** 4451 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent `8899dad` lacked `lib/plan/ads-manager-links.ts` / plan pages.

### [#850](https://github.com/matas-offpixel/meta-campaign-builder/pull/850) — E.3-lite · `cursor/plan-e3`

- **Shipped:** 7-day per-platform CPM/CPC/cost-per-reach on the event report, reused from A.2 helpers. Recommend-only diagnostic rows (text + evidence + `created_at` + provenance). Single-platform events: honest empty.
- **Inventory:** `event_daily_rollups` already has the columns. No table 158 for diagnostics — computed at read time so they stay current.
- **Suite:** 4456 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent `c52141e` lacked `buildCrossPlatformComparison`.

### [#851](https://github.com/matas-offpixel/meta-campaign-builder/pull/851) — C.1 · `cursor/plan-c1`

- **Shipped:** migration 158 `client_funnel_benchmarks` + `GET /api/clients/[id]/funnel-benchmarks`. Empty/absent table → seed 15/50/5, provenance `seed`. No learning job.
- **Inventory:** `event_funnel_overrides` (060) is a different stage model (TOFU/MOFU/BOFU). New table, not an alter.
- **Suite:** 4460 pass, 0 fail, 3 skipped. Build clean.
- **Falsification:** parent `d264fc3` lacked `lib/dashboard/client-funnel-benchmarks.ts`.

## Migrations awaiting application (in order)

1. `156_meta_write_idempotency.sql`
2. `157_campaign_plans.sql` (needs 096 if the Google child FK is enforced)
3. `158_client_funnel_benchmarks.sql`

None were applied to any database in this run.

## Env vars awaiting creation

- `ENABLE_PLAN_FANOUT` — must be exactly `"1"` to fan out. Default **unset** (`skippedReason: "killswitch"`). Do not set in this run.

No other env vars were added.

## Blocked items

None. Google fan-out is a **named failure**, not a blocked work item: `"google_search_push_not_wired_without_account — persist a google_search_plans tree and pass google_ads_account_id before fan-out can call pushGoogleSearchPlan"`. Do not invent credentials.

## Roadmap contradictions / limitations

- Live Google prior art is `google_search_plans` (096), not `google_ad_plans` (017) — the audit was right.
- Audience/creative set refs are opaque text; those tables do not exist.
- Meta has no rollback path, so the new ledger clear helper is unused.
- Plan UI cannot persist until 157 is applied (workspace is in-page).
- Fan-out does not write `campaign_plan_*_launch` rows yet (in-memory plan returned to the UI).
- TikTok Ads Manager has no confirmed campaign-selection query param — do not invent one.
- E.3 diagnostics are computed, not stored (no empty persist table).
- C.1 is not yet wired into the funnel card seed labels (A.4 still uses `EVENT_FUNNEL_SEEDS` constants). Same numbers; provenance will diverge once C.2 learns.
- EventPageDestination and the four wizard destination fields were not touched.
