# Session log — Google Ads write API spike (Phase 0)

## PR

- **Number:** 442
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/442
- **Branch:** `creator/google-ads-write-spike`

## Summary

Phase 0 de-risking spike for the Google Search Campaign Creator wizard
(`docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`). Extends
`GoogleAdsClient` with a `mutate()` method and ships a sequential write-API
spike script (`scripts/google-ads-write-spike.ts`) that creates a minimal
PAUSED Search campaign (budget → campaign → ad group → 4 keywords +
3 negatives → 1 RSA), verifies it via four GAQL read-backs, and removes
both the campaign and budget at the end. Live execution on the **Off/Pixel
own account (793-280-0197)** with Basic Access succeeded end-to-end and
the account was left clean (all created resources status=REMOVED).

The verdict for the wizard build: **writes work on Basic Access through the
existing explicit-OAuth2-with-refresh-token REST contract. Phase 1 (data
model) is unblocked.**

## Scope / files

- **`lib/google-ads/client.ts`** — added `mutate()` method, `GoogleAdsMutateOperation`,
  `GoogleAdsMutateResult`, `GoogleAdsMutateResponse` types. Reuses
  `executeWithRetry`, the same private `request()` plumbing as `query()`, and
  the explicit `OAuth2Client` + refresh-token bearer auth path
  (PR #207 lesson — no gRPC, no ADC). Defaults `partialFailure=false` so a
  bad op aborts the call cleanly; the script opts in to `partialFailure=true`
  for the keyword / negative fan-out only.
- **`lib/google-ads/__tests__/client-mutate.test.ts`** — three mocked-fetcher
  tests covering URL/body shape, partialFailure/validateOnly forwarding, and
  the INVALID_ARGUMENT no-retry path.
- **`scripts/google-ads-write-spike.ts`** — destructive-action-guarded spike
  runner. Dry-run by default; live mutates require `--execute` or
  `GOOGLE_ADS_SPIKE_EXECUTE=1`. Everything created PAUSED. Names always
  contain `[SPIKE-TEST]` and `DELETE ME`. Sequential per
  `GOOGLE_ADS_CHUNK_CONCURRENCY=1`. On mid-chain failure, best-effort
  cleanup removes the campaign then the budget. Supports `--validate-only`
  (Google validates without persisting) and `--no-cleanup` (debugging).
- **`docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`** — committed (was
  untracked) because this session log references it as the canonical Phase 1+
  brief.

## Validation

- [x] `npx tsc --noEmit` — pre-existing 46 errors are unchanged; the spike
      script and new test contribute zero new errors (verified by stashing
      this branch and re-running).
- [x] `npx eslint lib/google-ads/ scripts/google-ads-write-spike.ts app/api/google-ads/` — clean.
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'` — 25 / 25 pass (3 new + 22 existing).
- [x] `npm run build` — green.

## Report-back (the deliverable)

### 1. Did writes work?

**Yes.** Two live runs against the Off/Pixel customer (`793-280-0197`,
account_id `34fcf0f8-7d15-4dc2-9f78-f6915cb84286`) executed the full
mutate chain successfully. Per-step durations from the second clean run:

| Step | Endpoint | Duration |
|---|---|---|
| 1 | `campaignBudgets:mutate` (1 op) | 644 ms |
| 2 | `campaigns:mutate` (1 op) | 671 ms |
| 3 | `adGroups:mutate` (1 op) | 350 ms |
| 4 | `adGroupCriteria:mutate` (7 ops, partial-failure ON) | 568 ms |
| 5 | `adGroupAds:mutate` (1 RSA) | 680 ms |
| — | `campaigns:mutate` remove (cleanup) | 629 ms |
| — | `campaignBudgets:mutate` remove (cleanup) | 741 ms |

Read-back via GAQL confirmed the full structure exists exactly as POSTed:

- `campaign.bidding_strategy_type = "TARGET_SPEND"` (= Maximise Clicks)
- `campaign.advertising_channel_type = "SEARCH"`, `campaign.status = "PAUSED"`
- `campaign_budget.amount_micros = 5,000,000` (£5/day), `delivery_method = "STANDARD"`
- 7 `ad_group_criterion` rows (4 keywords, 3 negatives) with the correct
  `keyword.text`, `keyword.match_type` (EXACT / PHRASE / BROAD), and
  `negative` flag.
- 1 `ad_group_ad` row with all 4 headlines + 2 descriptions, each
  `asset_performance_label = "PENDING"` / `review_status = "REVIEW_IN_PROGRESS"`
  (so the RSA persisted intact even though the campaign was PAUSED before
  any approval cycle could run).

End-state verification query for the account is clean — all 3 test
campaigns and 4 test budgets show `status = "REMOVED"`. No active spike
artifacts remain on the live account.

### 2. Exact REST request/response shapes (the Phase 3 adapter contract)

All five mutate endpoints accept the same envelope —
`POST https://googleads.googleapis.com/v23/customers/{cid_digits_only}/{resource}:mutate`
with body `{ operations: [...], partialFailure?: bool, validateOnly?: bool }`
— and return `{ results: [{ resourceName }] }`. Headers (set by
`GoogleAdsClient.request()`):

```
Authorization: Bearer <access_token_minted_from_refresh_token>
developer-token: <GOOGLE_ADS_DEVELOPER_TOKEN>
login-customer-id: 3337038088   # MCC (digits only)
Content-Type: application/json
```

#### a. `campaignBudgets:mutate`

```json
{ "operations": [{ "create": {
  "resourceName": "customers/7932800197/campaignBudgets/-1",
  "name": "[SPIKE-TEST] Google Ads Write Spike — DELETE ME Budget 1779389842586",
  "amountMicros": "5000000",
  "deliveryMethod": "STANDARD",
  "explicitlyShared": false
}}]}
```

Response: `{ "results": [{ "resourceName": "customers/7932800197/campaignBudgets/15599361316" }] }`.

#### b. `campaigns:mutate`

```json
{ "operations": [{ "create": {
  "resourceName": "customers/7932800197/campaigns/-2",
  "name": "[SPIKE-TEST] Google Ads Write Spike — DELETE ME 1779389842586",
  "advertisingChannelType": "SEARCH",
  "status": "PAUSED",
  "campaignBudget": "customers/7932800197/campaignBudgets/-1",
  "targetSpend": {
    "cpcBidCeilingMicros": "500000"
  },
  "networkSettings": {
    "targetGoogleSearch": true,
    "targetSearchNetwork": true,
    "targetContentNetwork": false,
    "targetPartnerSearchNetwork": false
  },
  "containsEuPoliticalAdvertising": "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"
}}]}
```

Response shape identical: `{ "results": [{ "resourceName": "customers/7932800197/campaigns/23874109408" }] }`.

Notes:
- **Maximise Clicks** is `bidding_strategy_type = TARGET_SPEND` with the
  embedded `target_spend.cpc_bid_ceiling_micros` field — there is no
  `MAXIMIZE_CLICKS` enum on the campaign create payload.
- The temp resource names (`-1`, `-2`, `-3` — negative integers used as
  placeholder IDs that Google resolves within a single mutate batch) are not
  strictly required for separate-call sequencing; the script substitutes the
  real resource name into downstream ops before POSTing each call. Kept the
  placeholders in the create payloads for readability and to match what
  Google Ads Editor / multi-resource mutate calls expect.

#### c. `adGroups:mutate`

```json
{ "operations": [{ "create": {
  "resourceName": "customers/7932800197/adGroups/-3",
  "campaign": "customers/7932800197/campaigns/23874109408",
  "name": "[SPIKE-TEST] Google Ads Write Spike — DELETE ME AG",
  "status": "PAUSED",
  "type": "SEARCH_STANDARD",
  "cpcBidMicros": "250000"
}}]}
```

`cpcBidMicros` is required even under Maximise Clicks (it's the default /
manual-CPC fallback signal at the ad-group level). 250,000 micros = £0.25.

#### d. `adGroupCriteria:mutate` (run with `partialFailure: true`)

```json
{ "operations": [
  { "create": {
    "adGroup": "customers/7932800197/adGroups/196401989923",
    "status": "ENABLED",
    "keyword": { "text": "junction 2 festival tickets", "matchType": "EXACT" }
  }},
  ... 3 more positive keywords ...
  { "create": {
    "adGroup": "customers/7932800197/adGroups/196401989923",
    "negative": true,
    "keyword": { "text": "free tickets", "matchType": "PHRASE" }
  }},
  ... 2 more negatives ...
], "partialFailure": true }
```

Response returns one `{ resourceName }` per accepted op in `results`. If
any op fails under partialFailure, the body also includes a top-level
`partialFailureError` with a `google.ads.googleads.v23.errors.GoogleAdsFailure`
detail; the script logs it as a warning and continues. All 7 ops accepted
cleanly in the spike run.

#### e. `adGroupAds:mutate` (RSA)

```json
{ "operations": [{ "create": {
  "adGroup": "customers/7932800197/adGroups/196401989923",
  "status": "PAUSED",
  "ad": {
    "finalUrls": ["https://offpixel.com/?utm_source=spike-test"],
    "responsiveSearchAd": {
      "headlines": [
        { "text": "Junction 2 Festival" },
        { "text": "Melodic Stage Tickets" },
        { "text": "Buy Tickets Now — J2 2026" },
        { "text": "Festival This July" }
      ],
      "descriptions": [
        { "text": "Limited tickets remaining for Junction 2 Melodic Stage. Secure yours today." },
        { "text": "Headline acts, world-class production, and unforgettable nights — book now." }
      ]
    }
  }
}}]}
```

Character limits enforced before POST: headlines ≤30, descriptions ≤90
(matches the J2 plan and the Google Search ad spec). The response RSA echoes
`asset_performance_label = "PENDING"` and `review_status = "REVIEW_IN_PROGRESS"`
on every headline/description — these are normal post-create states and not
errors.

#### f. Cleanup — `campaigns:mutate` and `campaignBudgets:mutate`

```json
{ "operations": [{ "remove": "customers/7932800197/campaigns/23874109408" }] }
{ "operations": [{ "remove": "customers/7932800197/campaignBudgets/15599361316" }] }
```

Both return `{ "results": [{ "resourceName": "<same string>" }] }` on
success. **Order matters**: the campaign must be removed before its budget
(removing the campaign releases the budget's `reference_count` so the
budget can be deleted). The script enforces this order in both happy-path
and mid-chain-failure paths.

### 3. v23-specific field-name gotchas (write side)

Two real surprises hit during the spike — the same flavour as the read-side
ones (`metrics.video_views invalid`, unquoted enums in `IN (...)`):

1. **`containsEuPoliticalAdvertising` is a hard-required field** on
   `campaigns:mutate` create as of v23. Without it, the call fails with
   `INVALID_ARGUMENT` / `errorCode.fieldError = "REQUIRED"` and the field
   path `operations[0].create.contains_eu_political_advertising`. The value
   is the enum `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` (not a bool).
   This is the EU DSA compliance field — every new Search campaign needs it.
2. **GAQL resource compatibility on read-back.** You can't `SELECT
   campaign_budget.amount_micros FROM ad_group` — even though `campaign_budget`
   is logically attached, the read planner refuses it with
   `PROHIBITED_RESOURCE_TYPE_IN_SELECT_CLAUSE`. The fix is one GAQL per
   resource family. (The spike's read-back is now split into 4 queries:
   `FROM ad_group`, `FROM campaign_budget`, `FROM ad_group_criterion`,
   `FROM ad_group_ad`.) Worth bookmarking for Phase 4 of the wizard —
   anything that reads back the launched plan will need the same split.

Other potential gotchas to bookmark for Phase 3 but not encountered in this
spike's minimal scope: location / language criteria use a separate
`campaignCriteria:mutate` endpoint (not `adGroupCriteria`); bid adjustments
attach via `campaignCriterion.bid_modifier`; shared negative lists need
`sharedSets:mutate` + `campaignSharedSets:mutate`. Out of v0 scope, but
flag in the Phase 3 adapter for follow-up.

### 4. What `app/api/google-ads/launch/` already contained

A pure stub. The whole file is a 53-line POST handler that:

1. Authenticates via Supabase.
2. Parses `{ planId }` from the body.
3. Returns `{ ok: false, reason: "not_configured", error: "API credentials required" }` with HTTP 200.

No mutate-adapter scaffolding, no platform calls, no payload building. It's
a placeholder that predates the OAuth + insights work shipped in PR #182.
Phase 3 should rewrite this route entirely against the new
`lib/google-ads/campaign-writer.ts` adapter (to be built) — there's nothing
worth preserving except the auth/parse shell, which can be modelled on
`app/api/meta/launch-campaign/route.ts` directly.

### 5. Meta launch contract → recommendation for Google mutate chain

The Meta launch handler (`app/api/meta/launch-campaign/route.ts`) uses
**partial-state marking, NOT rollback**. The structure:

- **Phase 1 (campaign create) is fatal-on-failure.** If `createMetaCampaign`
  throws, the route returns HTTP 502 immediately with the error embedded
  and no `LaunchSummary` is written.
- **Phase 1.5 / 1.75 / 2 / 3 / 4 (audiences, ad sets, creatives, ads) are
  all best-effort accumulators.** Each phase keeps parallel `*Created` and
  `*Failed` arrays in the `LaunchSummary` (e.g. `adSetsCreated`,
  `adSetsFailed`, `creativesCreated`, `creativesFailed`,
  `engagementAudiencesCreated/Failed/Skipped`, etc.). The chain continues
  through every phase even when individual items fail.
- **No automatic rollback.** Half-launched campaigns survive as PAUSED
  resources on Meta. The wizard surfaces successes and failures side-by-side
  via the persisted `LaunchSummary` so the operator can review in Ads
  Manager and either retry the failed items or delete the partial campaign
  manually.
- **Single source of truth.** The full state is captured in the returned
  `LaunchSummary` and also persisted to
  `campaign_drafts.draft_json.launchSummary` for the library view.

**Recommendation for Google Ads mirror.** Use the same shape, with one
sharper boundary because the Google chain has tighter dependencies than
Meta's:

- **Foundational phase = all-or-nothing.** Budget + campaign + ad group are
  not independently useful and depend on each other. If any of these three
  fails, abort the chain AND fire the cleanup remove operations for any
  resources already created in this run. The spike already implements this
  exact pattern (campaign-then-budget remove). Return HTTP 502 with the
  error and no `GoogleSearchLaunchSummary`. Equivalent to Meta's "Phase 1
  fatal".
- **Item phase = partial-state marking.** Keywords, negatives, and RSAs
  use `partialFailure: true` and accumulate per-item `created` /
  `failed` arrays in a `GoogleSearchLaunchSummary` (mirror the Meta type
  exactly: `keywordsCreated`, `keywordsFailed`, `negativesCreated`,
  `negativesFailed`, `rsasCreated`, `rsasFailed`). Don't rollback the
  campaign just because one keyword was rejected — the campaign is still
  useful and the operator can fix and retry the failures via Ads Manager
  or a retry button in the wizard.
- **Idempotency hook.** The scope doc calls out mirroring the TikTok
  `tiktok_write_idempotency` pattern (migration 062). For the spike I
  punted on this — the operator approves a single run and cleanup
  handles partial state. Phase 3 should add it: per-resource idempotency
  keys keyed off `(plan_id, temp_resource_name)` so a wizard re-push
  doesn't duplicate budgets / campaigns / keywords on the platform.

### 6. Basic Access vs tier upgrade

**Basic Access is sufficient for this scope.** All five mutate calls plus
the cleanup `remove` plus the GAQL read-backs ran without quota or
permission errors on the Off/Pixel customer (793-280-0197), which is a
real, non-test customer linked to MCC 333-703-8088. No "Test Account"
restrictions tripped (we hit `PAUSED` campaigns + RSA review pending, both
of which are normal post-create states regardless of access tier). No
`PERMISSION_DENIED` or `RESOURCE_EXHAUSTED` errors observed.

CLAUDE.md already documents the 15k ops/day Basic Access budget. Per the
GoogleAdsClient default `GOOGLE_ADS_CHUNK_CONCURRENCY = 1` and the
reporting layer's existing usage, the wizard's per-launch cost (5 mutate
calls + ~4 read-back queries + cleanup, all sequential) is well under
budget for the foreseeable J2-scale plans.

**No tier upgrade is required to unblock Phase 1.** If we later hit a
need for Conversions API uploads, RLSA, or Customer Match audiences, that
might shift the answer — but those are explicitly OUT of v1 per the scope
doc.

## Account choice + destructive-action audit trail

- **Available accounts in `google_ads_accounts`** (4 rows, all owned by
  user `b3ee4e5c-44e6-4684-acf6-efefbecd5858`): LWE (324-410-8450),
  Off/Pixel (793-280-0197), Black Butter (288-501-5945), Off/Pixel
  Manager Account (333-703-8088 — the MCC itself).
- **No dedicated test customer exists.** Per the spike prompt, the
  preferred fallback is the Off/Pixel own account (Matas's own).
- **Operator approval** captured in-thread before the live `--execute`
  run on Off/Pixel.
- **Guard rails verified live**: all 3 created campaigns carried
  `[SPIKE-TEST]` + `DELETE ME` in their names; all were created PAUSED;
  cleanup ran successfully on both happy-path and mid-chain-failure paths
  (the first --execute run aborted on the EU political ad field but the
  campaign + budget orphan was cleaned by hand via `mutate(remove)`, and
  the subsequent runs auto-cleaned). Final account verification
  confirms 0 active SPIKE-TEST artifacts.

## How to re-run the spike

```bash
set -a && source .env.local && set +a

# Dry-run (no API mutate calls — prints planned payloads):
node --experimental-strip-types scripts/google-ads-write-spike.ts \
  --account-id 34fcf0f8-7d15-4dc2-9f78-f6915cb84286

# Validate-only (Google validates without persisting; no cleanup needed):
node --experimental-strip-types scripts/google-ads-write-spike.ts \
  --account-id 34fcf0f8-7d15-4dc2-9f78-f6915cb84286 --execute --validate-only

# Live execution (creates real PAUSED entities, then removes them):
node --experimental-strip-types scripts/google-ads-write-spike.ts \
  --account-id 34fcf0f8-7d15-4dc2-9f78-f6915cb84286 --execute

# By customer id instead of UUID:
node --experimental-strip-types scripts/google-ads-write-spike.ts \
  --customer-id 793-280-0197 --execute
```

`--no-cleanup` skips the final remove (debugging only — leaves resources
on the account). `--final-url <url>` overrides the RSA `finalUrl`. The
script refuses to mutate without `--execute` or `GOOGLE_ADS_SPIKE_EXECUTE=1`.

## Notes / follow-ups

- **Phase 1 (data model) is unblocked.** Proceed per the scope doc.
- Phase 3 push adapter should use `client.mutate()` directly (no need for a
  separate `mutateRequest()` sibling — the existing one is generic enough).
  Reuse `executeWithRetry`'s `executeWithRetry` so transient/rate-limit
  classification matches the read path.
- Phase 3 will also need a small extension to `mutate()` for
  `update` ops with `update_mask` (e.g. status transitions). The type
  already supports it — just no script consumer yet.
- Idempotency: capture per-plan write history (mirror
  `tiktok_write_idempotency`) before Phase 3 ships a "re-push" button.
- Awareness of the v23 EU DSA field is now codified in the script — port
  the same `containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"`
  default into the Phase 3 campaign-writer so the wizard never
  forgets it.
- The script's `node --experimental-strip-types` invocation generates the
  usual `MODULE_TYPELESS_PACKAGE_JSON` warnings. These are benign — opting
  out would require adding `"type": "module"` to `package.json` which
  affects every JS consumer in the repo. Out of scope for this spike.

### Shared-file edits surfaced for ops batch

None new. Reuses `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
`GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_TOKEN_KEY`, and the existing
encrypted `credentials_encrypted` column on `google_ads_accounts` (all from
PR #182). The script also depends on `SUPABASE_SERVICE_ROLE_KEY` and
`NEXT_PUBLIC_SUPABASE_URL`, which are already required by other
`scripts/*` utilities.
