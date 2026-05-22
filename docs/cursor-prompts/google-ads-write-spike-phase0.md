# Cursor prompt [Cursor, Opus] — Google Ads write-API spike (Phase 0)

Copy this entire block into Cursor as a single message. Use Opus — this is a diagnosis + foundational-primitive task, not a mechanical change.

---

## GOAL

Prove that the Google Ads REST API can CREATE campaigns from this app, on the Off/Pixel MCC, with our current Basic Access developer token. This is a de-risking spike for the Google Search Campaign Creator wizard (full scope in `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`). Until writes are proven, the wizard is speculative.

Success = a real PAUSED search campaign with one ad group, a handful of keywords, negative keywords, and one Responsive Search Ad, created on a TEST sub-account via the API, then verified via a read-back query and finally cleaned up (removed).

This spike is READ THE SCOPE DOC FIRST: `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`.

## CONTEXT — what already exists

`lib/google-ads/client.ts` has a working `GoogleAdsClient` that does REST reads (`listAccessibleCustomers`, `query`). Read it fully. Key facts:

- It uses `OAuth2Client` from `google-auth-library` with an explicit refresh token (NOT gRPC, NOT ADC — this was hard-won in PR #207, do not regress).
- The private `request()` method posts to `https://googleads.googleapis.com/v23{path}` with `Authorization: Bearer`, `developer-token`, and `login-customer-id` headers.
- It has `executeWithRetry` with `classifyGoogleAdsRetry` — reuse this for mutate ops.
- Error shape: throws `{ response: { status, data } }` on non-ok, converted to `GoogleAdsApiError`.
- `customerIdForGoogleAdsApi()` strips dashes from customer IDs.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID = "333-703-8088"` (the MCC).
- `GOOGLE_ADS_CHUNK_CONCURRENCY = 1` — mutate ops MUST be sequential.

Credentials: stored encrypted in `google_ads_accounts` table, decrypted via `getGoogleAdsCredentials` RPC (`lib/google-ads/credentials.ts`). The spike needs a customer ID + refresh token + login_customer_id from a row in that table.

There is also an `app/api/google-ads/launch/` directory — INSPECT IT. It may already contain scaffolding for campaign creation. If it does, build on it rather than duplicating. Report what you find.

## INVESTIGATE FIRST (before writing mutate code)

1. Read `lib/google-ads/client.ts` cover to cover.
2. Read whatever is in `app/api/google-ads/launch/` — report its current state.
3. Read `lib/meta/campaign.ts`, `lib/meta/adset.ts`, `lib/meta/creative.ts` and the Meta launch hooks (`lib/hooks/useCreateCampaign`, `useCreateAdSets`, `useCreateCreativesAndAds`, `useLaunchCampaign`) — these define the error/partial-failure/idempotency CONTRACT this app already uses for ad-platform writes. The Google mutate adapter should mirror this contract, not invent a new one. Specifically note: how does Meta handle a failure mid-chain? Does it roll back, or mark partial state?
4. Pick a TEST sub-account to spike against. Query `google_ads_accounts` for available customer IDs. Per the scope doc + Matas's accounts: LWE (324-410-8450), Off/Pixel (793-280-0197), Black Butter (288-501-5945) are real client accounts — DO NOT spike on a real client account if avoidable. If there's a test account, use it. If not, use the Off/Pixel own account (793-280-0197) since it's Matas's own, and ensure everything is created PAUSED + removed at the end. SURFACE this choice in your report and ask before running against any account that isn't clearly a test account.

## BUILD — extend GoogleAdsClient with mutate capability

Add a `mutate` path to `GoogleAdsClient`. The Google Ads REST mutate endpoints are:

- Campaign budget: `POST /customers/{cid}/campaignBudgets:mutate`
- Campaign: `POST /customers/{cid}/campaigns:mutate`
- Ad group: `POST /customers/{cid}/adGroups:mutate`
- Ad group criteria (keywords + negatives): `POST /customers/{cid}/adGroupCriteria:mutate`
- Ad group ads (RSA): `POST /customers/{cid}/adGroupAds:mutate`

Each takes a body like:
```json
{ "operations": [ { "create": { ...resource... } } ] }
```
and returns `{ "results": [ { "resourceName": "customers/.../campaigns/123" } ] }`.

The private `request()` method is currently read-shaped but generic enough — extend it or add a sibling `mutateRequest()` that takes the operations body. Reuse `executeWithRetry`.

Add a method like:
```ts
async mutate<T>(
  credentials: GoogleAdsCustomerCredentials,
  resource: string, // e.g. "campaigns", "adGroups"
  operations: unknown[],
): Promise<T>
```

## THE SPIKE — create a minimal campaign

Create a one-off internal route OR a standalone script (`scripts/google-ads-write-spike.ts`) that runs the full mutate chain SEQUENTIALLY:

1. **Campaign budget** — daily budget, e.g. £5/day in micros (`5_000_000`). `deliveryMethod: STANDARD`.
2. **Campaign** — `advertisingChannelType: SEARCH`, `status: PAUSED`, link the budget, `biddingStrategyType` / `manualCpc` or `maximizeClicks` (no conversion tracking, so Maximise Clicks — verify the exact field name for the bidding strategy in v23). Name it `[SPIKE-TEST] Google Ads Write Spike — DELETE ME`.
3. **Ad group** — `status: PAUSED`, `type: SEARCH_STANDARD`, default CPC bid.
4. **Keywords** — 3-4 ad group criteria with `keyword: { text, matchType: EXACT/PHRASE }`.
5. **Negative keywords** — 2-3 ad group criteria with `negative: true`.
6. **RSA** — one `adGroupAd` with `responsiveSearchAd: { headlines: [...3+...], descriptions: [...2+...] }`, `status: PAUSED`. Use the char limits from the J2 plan (headlines ≤30, descriptions ≤90).

After creation: run a read-back `query` (using the existing `query` method) to confirm the campaign exists with the expected structure.

**Then CLEAN UP**: remove the created campaign (mutate with `remove` operation on the campaign resource name). Leave no test artifacts. A removed campaign is the cleanest end state.

## CRITICAL — DESTRUCTIVE-ACTION GUARD

This spike CREATES and REMOVES real Google Ads entities. Before running against any account:

- Default to dry-run: build the operations, log them, but do NOT execute mutates unless an explicit `--execute` flag (or env var `GOOGLE_ADS_SPIKE_EXECUTE=1`) is set.
- Everything created MUST be PAUSED.
- The campaign name MUST contain `[SPIKE-TEST]` and `DELETE ME`.
- Clean up at the end (remove the campaign).
- If running against a non-test account, the operator (Matas) must explicitly approve in the Cowork thread first. Surface the chosen account and ask.

## WHAT TO REPORT BACK

This is a spike — the deliverable is KNOWLEDGE, not a feature. Report:

1. **Did writes work?** Yes / No / Blocked-by-approval. If blocked, the exact API error (use the existing INVALID_ARGUMENT logging).
2. **The exact REST request/response shapes that worked** for each of the 5 mutate types — these become the adapter contract for Phase 3 of the wizard build.
3. **Any v23-specific field-name gotchas** (the read layer hit several: `metrics.video_views` invalid, `IN (SEARCH, VIDEO)` unquoted enums, etc — expect similar surprises on the write side, especially bidding strategy field names).
4. **What `app/api/google-ads/launch/` already contained** and whether it's usable.
5. **How the Meta launch contract handles partial failure** and your recommendation for mirroring it in the Google mutate chain (rollback vs partial-state-marking).
6. **Whether Basic Access allows these writes** or if a tier upgrade / account-out-of-test-mode is needed.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-ads/ scripts/ app/api/google-ads/
node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'
npm run build
```

Add a unit test for the new `mutate` method using a mocked fetcher (the client already supports `options.fetcher` injection — use it). Test that operations are POSTed to the right endpoint with the right body shape. Do NOT hit the live API in tests.

## SESSION LOG + PR

Commit `docs/session-logs/pr-NNN-creator-google-ads-write-spike.md` per `docs/SESSION_LOG_TEMPLATE.md`. The session log is the PRIMARY deliverable here — capture all 6 report-back items in detail. This is the reference doc Phase 3 of the wizard build depends on.

```bash
gh pr create --base main --head creator/google-ads-write-spike \
  --title "spike(creator): prove Google Ads write API for campaign creation" \
  --body-file docs/session-logs/pr-NNN-creator-google-ads-write-spike.md
```

## NON-NEGOTIABLES

- Branch: exactly `creator/google-ads-write-spike`
- REST only, explicit OAuth2Client + refresh token — NEVER gRPC, NEVER ADC (PR #207 lesson)
- `GOOGLE_ADS_CHUNK_CONCURRENCY = 1` — mutate ops sequential
- Dry-run by default; live execution behind explicit flag
- Everything created PAUSED + cleaned up
- Do NOT spike on a real client account without explicit operator approval in the Cowork thread
- Do NOT add migrations (this is a spike, no schema yet)
- Do NOT build the wizard UI or data model — that's Phase 1+, gated on this spike passing
- Do NOT modify the read/reporting code paths — additive only

## IF WRITES ARE BLOCKED

If Basic Access doesn't allow writes (or the account is in test mode and can't create real campaigns), document the exact blocker + the path to unblock (tier upgrade, account verification, whatever Google's error indicates). Then the wizard pivots to export-only mode (in-app editable plan + Google Ads Editor CSV export) per the scope doc — note this in the session log as the recommended fallback.

DO NOT spend more than the spike's scope trying to force writes through. The answer "writes are blocked, here's why, here's the fallback" is a complete and valuable result.
