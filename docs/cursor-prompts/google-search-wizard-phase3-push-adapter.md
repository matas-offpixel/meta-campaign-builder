# Cursor prompt [Cursor, Opus] — Google Search Wizard Phase 3: push adapter

Copy this entire block into Cursor as a single message. Opus — this is the load-bearing write path; partial-failure handling must be correct.

PREREQUISITE: Phase 1 (data model) + Phase 2 (UI) merged. Migration 096 applied.

---

## GOAL

Build the push adapter that takes a `google_search_plans` tree and creates the campaigns in Google Ads — all PAUSED — via the proven `GoogleAdsClient.mutate()` primitive. Wire it to the Phase 2 wizard's "Push to Google Ads" step (which is currently a stub).

Read first:
- `docs/session-logs/pr-442-creator-google-ads-write-spike.md` — THE canonical reference. Has the exact working mutate request shapes, the v23 EU-political-ads requirement, and the recommended launch contract.
- `lib/google-ads/client.ts` — `mutate()` method, `GoogleAdsMutateOperation`, `GoogleAdsCustomerCredentials`
- `lib/google-ads/credentials.ts` — `getGoogleAdsCredentials` RPC wrapper (decrypt refresh token for an account)
- `lib/meta/` launch route + hooks — the partial-failure contract this app already uses for ad-platform writes. Mirror it.
- `supabase/migrations/062_tiktok_write_idempotency.sql` — idempotency pattern to mirror
- The ACTUAL Phase 1 schema (`lib/google-search/types.ts`) and Phase 2 push route stub — read them on main, build against real shapes.

## CRITICAL FACTS FROM THE SPIKE (PR #442)

Verified working mutate chain ORDER (sequential, GOOGLE_ADS_CHUNK_CONCURRENCY=1):
1. `campaignBudgets:mutate` — `{ amountMicros, deliveryMethod: "STANDARD" }`. Budget in micros (£5 = 5000000).
2. `campaigns:mutate` — `{ name, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: <budget resourceName>, ...bidding..., containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" }`. **The EU political ads field is a v23 HARD REQUIREMENT** — campaigns:mutate fails without it.
3. `adGroups:mutate` — `{ name, campaign: <campaign resourceName>, status: "PAUSED", type: "SEARCH_STANDARD", cpcBidMicros }`
4. `adGroupCriteria:mutate` — keywords `{ adGroup, status, keyword: { text, matchType } }` + negatives `{ adGroup, negative: true, keyword: { text, matchType } }`
5. `adGroupAds:mutate` — `{ adGroup, status: "PAUSED", ad: { responsiveSearchAd: { headlines: [{text}], descriptions: [{text}] }, finalUrls: [url] } }`

Bidding for Maximise Clicks: verify the exact field from the spike log (likely `{ maximizeClicks: {} }` set on the campaign, or a `biddingStrategyType`). Manual CPC: `{ manualCpc: {} }`. Use what the spike confirmed works.

## BUILD — `lib/google-ads/campaign-writer.ts`

```ts
export interface GoogleSearchLaunchSummary {
  ok: boolean;
  planId: string;
  campaignsCreated: { localId: string; resourceName: string }[];
  campaignsFailed: { localId: string; error: string }[];
  adGroupsCreated: ...;
  keywordsCreated: number;
  keywordsFailed: { ... }[];
  negativesCreated: number;
  rsasCreated: ...;
  partialFailure: boolean;
  aborted: boolean;
  abortReason?: string;
}

export async function pushGoogleSearchPlan(input: {
  supabase, planId, credentials  // resolved from plan.google_ads_account_id
}): Promise<GoogleSearchLaunchSummary>
```

### Launch contract (from spike recommendation):

**Foundational triad = fatal-on-failure WITH cleanup:**
For each campaign: budget → campaign → ad group(s). If ANY of these fail, the campaign is unusable. Roll back what was created for THAT campaign (mutate `remove` on the created resource names in reverse order) and mark the campaign in `campaignsFailed`. Other campaigns continue (don't abort the whole plan for one campaign's failure — unless it's an auth/credentials failure, which aborts everything).

**Fan-out = partial-failure tolerant:**
Keywords, negatives, RSAs use `mutate(..., { partialFailure: true })`. A bad keyword doesn't kill the ad group. Collect created vs failed into the summary arrays.

**Idempotency:**
Mirror `tiktok_write_idempotency`. Before pushing, check if the plan was already pushed (status='pushed' or campaigns have `pushed_resource_name`). If re-pushing, either skip already-created entities (by stored resource name) or require an explicit `force` flag. Don't create duplicate campaigns on a double-click. Add a `google_search_write_idempotency` table if needed (migration 097) OR use the `pushed_resource_name` columns already on the Phase 1 tables as the idempotency signal — prefer the latter if sufficient (no new migration).

**Everything PAUSED. Never auto-enable.**

### Naming — auto-prefix [event_code]:
At push time, prefix each campaign name with the event code so the reporting layer's `[event_code]` matcher scopes it. E.g. plan campaign "C2 Adam Beyer" + event J2-MELODIC → Google Ads campaign name `[J2-MELODIC] C2 Adam Beyer`. If the plan has no linked event, push the campaign name as-is (with a warning). This is how Phase 4 reporting picks it up automatically.

### Persist results:
After push, write `pushed_resource_name` back to each created entity row, set `google_search_plans.status` to 'pushed' (or 'partially_pushed' if any failures), set `pushed_at`.

## ROUTE — `app/api/google-search/[id]/push/route.ts`

Replace the Phase 2 stub. Session-bound auth. Resolves the plan, decrypts the Google Ads credentials for `plan.google_ads_account_id`, calls `pushGoogleSearchPlan`, returns the `GoogleSearchLaunchSummary`. `maxDuration` high enough for sequential mutates (mirror the rollup routes — 300s).

## WIRE THE WIZARD

Update the Phase 2 push step to call the real route + render the `GoogleSearchLaunchSummary`: created campaigns with "View in Google Ads" deep links (`https://ads.google.com/aw/campaigns?campaignId=<id>&__e=<customer_id>`), failed entities with reasons, the all-PAUSED reminder + "go enable in Google Ads when ready" copy.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-ads/ app/api/google-search/ components/google-search-wizard/
node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'
npm run build
```

Tests (mocked fetcher — NEVER hit live API in tests):
- Full successful push: assert the mutate chain is called in order with correct bodies (especially the EU political ads field on campaigns)
- Triad failure: campaign mutate fails → assert budget is rolled back via remove → campaign in campaignsFailed
- Fan-out partial failure: one bad keyword → assert other keywords created, bad one in keywordsFailed
- Idempotency: re-push of already-pushed plan → no duplicate creates
- [event_code] prefixing: assert campaign name gets the bracket prefix

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-wizard-push-adapter`
- Use `mutate()` — do NOT add a parallel write path
- REST only, sequential (GOOGLE_ADS_CHUNK_CONCURRENCY=1)
- `containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"` on every campaigns:mutate — non-negotiable, it'll fail without it
- Everything PAUSED
- [event_code] auto-prefix so reporting picks it up
- If a new idempotency migration is needed, claim the next integer after Phase 1's 096 (likely 097); prefer reusing pushed_resource_name columns to avoid a migration
- Mirror Meta's partial-failure contract; don't invent a new error model
- Do NOT auto-enable campaigns under any circumstance

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-wizard-push-adapter.md`. PR title: `feat(creator): Google Search wizard push adapter (Phase 3)`. Include the ops checklist if a migration was added.

## IF WRITES FAIL IN A NEW WAY

The spike only tested a minimal campaign. A full plan (multiple campaigns, many keywords, RSAs with 15 headlines) may hit new v23 validation rules (e.g. RSA asset requirements, keyword limits per ad group, budget minimums). The INVALID_ARGUMENT logging will surface them. Handle gracefully — surface the specific field violation in the launch summary, don't crash the whole push. Document any new gotchas in the session log for future reference.
