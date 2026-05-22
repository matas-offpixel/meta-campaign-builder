# Session log — creator: Google Search sitelink support

## PR

- **Number:** 456
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/456
- **Branch:** `creator/google-search-sitelinks`

## Summary

Campaigns pushed by the Phase 3 adapter inherited the LWE account's
pre-existing account-level sitelinks ("What's On", "About Us") which
pointed to LWE's generic site, not the J2 landing page. This PR adds
**per-plan, campaign-level sitelinks** with auto-generated defaults so
the operator can launch with sitelinks scoped to the actual event.

Four default sitelinks (Tickets / Lineup / Venue Info / FAQ) are seeded
on every new plan (blank create + xlsx import) and editable in the
Ad Copy step with live char-counters. The push adapter creates each
sitelink as a v23 `sitelinkAsset` via `assets:mutate`, then links it to
every fresh campaign via `campaignAssets:mutate` with
`fieldType: SITELINK`. Sitelinks are diff-aware in the autosave so
their `pushed_resource_name` (idempotency signal) survives the 1.5 s
debounce, identical to the Phase 3.5 fix for negatives/RSAs.

## Account-level inheritance handling

Google Ads v23 does **not** expose a per-campaign override for
account-level asset inheritance. Removing the account-level
`CustomerAsset` would affect every campaign on the account (dangerous).
The practical mitigation Google itself recommends is to create
campaign-level sitelinks — they generally take precedence in the
serving auction. The push adapter surfaces a launch-summary warning so
the operator knows the account-level ones may still appear and can be
manually paused in the Google Ads Assets tab.

## Scope / files

### Data model

- `supabase/migrations/098_google_search_sitelinks.sql` — new table,
  RLS join-up to plan owner (mirrors `google_search_negatives_owner`).

### Types

- `lib/google-search/types.ts`
  - `GoogleSearchSitelink`, `GoogleSearchSitelinkDraft`.
  - Extended `GoogleSearchPlanTree.sitelinks` + `GoogleSearchPlanDraftTree.sitelinks`.
  - `GOOGLE_SEARCH_LIMITS.SITELINK_LINK_TEXT_MAX_CHARS` (25),
    `SITELINK_DESCRIPTION_MAX_CHARS` (35), `RECOMMENDED_MIN_SITELINKS` (2).

### Defaults

- `lib/google-search/sitelink-defaults.ts` — `defaultSitelinkSeeds({ venueName? })`
  → 4 seeds (Tickets / Lineup / Venue Info / FAQ) all with NULL
  `final_url` so push falls back to the plan's RSA landing URL.

### CRUD

- `lib/db/google-search-plans.ts`
  - `createGoogleSearchPlan` accepts a `sitelinks?` seed list.
  - `createGoogleSearchPlanTreeFromDraft` inserts sitelinks from the draft.
  - `loadGoogleSearchPlanTree` reads `google_search_sitelinks` into
    `tree.sitelinks` (ordered by `sort_order`).
  - `saveGoogleSearchPlanTree` adds a 7th diff-aware reconciliation
    step for sitelinks — same shape as the negatives step, never
    writes `pushed_resource_name` on update.
  - `setGoogleSearchSitelinkResource` per-row push-back writer for
    the Phase 3 persister callback.

### Push adapter

- `lib/google-ads/campaign-writer-types.ts`
  - Added `sitelinkAssetsCreated/Failed` +
    `sitelinksLinkedToCampaigns/FailedToLink` to `GoogleSearchLaunchSummary`.
- `lib/google-ads/campaign-writer.ts`
  - `prepareSitelinkAssets()` runs ONCE per push: skips reused, calls
    `assets:mutate` for the rest with `sitelinkAsset: { linkText,
    description1, description2 }` + `finalUrls`. partialFailure on.
    Per-sitelink URL override → plan landing URL fallback (via
    `collectPlanFinalUrlState`) → recorded as `sitelinkAssetsFailed`
    when neither is set.
  - `linkSitelinksToCampaign()` runs per FRESH campaign: calls
    `campaignAssets:mutate` with `{ asset, campaign, fieldType:
    "SITELINK" }` per sitelink. partialFailure on. Reused campaigns
    skip relinking (Google dedupes by `(campaign, asset, fieldType)`;
    re-linking would 409).
  - Push emits a launch warning: "Account-level sitelinks can't be
    excluded per-campaign via the Google Ads API. If wrong-looking
    sitelinks still appear under the ad after launch, remove or pause
    them at the account level in Google Ads."

### API routes

- `app/api/google-search/route.ts` (blank-plan POST) — looks up the
  linked event's `venue_name`, seeds the 4 defaults at plan create.
- `app/api/google-search/import/route.ts` (xlsx POST) — seeds the 4
  defaults when the parser doesn't extract sitelinks (Phase 1 doesn't).
- `app/api/google-search/[id]/push/route.ts` — wires
  `setGoogleSearchSitelinkResource` into the persister.

### Wizard UI

- `components/google-search-wizard/steps/ad-copy.tsx`
  - New `SitelinksSection` + `SitelinkEditor` rendered at the bottom
    of the Ad Copy step (still rendered when there are 0 campaigns so
    the operator can configure sitelinks ahead of campaign setup).
  - Char counters (25 / 35), Add / Remove / Reorder, per-sitelink
    URL override (placeholder hints "defaults to plan landing URL").
  - "Pushed" pill on rows with `pushed_resource_name`.
- `components/google-search-wizard/steps/review.tsx`
  - New "Sitelinks" summary card.
  - Jump-step support for the 5 new sitelink validation codes.
- `components/google-search-wizard/steps/push.tsx`
  - Results summary surfaces sitelink asset + link counts.

### Validation

- `lib/google-search/validation.ts`
  - `validateSitelinks()` — hard errors for empty/long link_text,
    over-35-char descriptions, invalid override URLs.
  - `softWarnings()` adds `sitelinks_below_minimum` (Google needs ≥2
    to show in the ad slot).

### Tree mutations

- `lib/google-search/tree-mutations.ts` — `addSitelink`,
  `updateSitelink`, `removeSitelink`, `moveSitelink`.

### Tests (new + extended)

- `lib/google-search/__tests__/sitelinks.test.ts` (12 tests) —
  default seed shape, venue-name flavouring, char-limit hard errors,
  minimum soft-warn, default-set validates cleanly.
- `lib/google-ads/__tests__/campaign-writer-sitelinks.test.ts` (10
  tests) — `buildSitelinkAssetOp` shape, full mutate chain assertion,
  URL fallback chain, "no URL anywhere → recorded as failed",
  reused-asset path, persister callback, ZERO-mutate idempotency,
  zero-sitelinks short-circuit, account-level warning emission.
- `lib/db/__tests__/google-search-plans-save.test.ts` — new
  `saveGoogleSearchPlanTree — sitelinks` block (4 tests): diff-aware
  update preserves push marker, UPDATE payload never carries
  `pushed_resource_name`, removed sitelink deletes, tmp-id insert
  resolves to a real id.
- Existing tree fixtures updated to include `sitelinks: []` for
  type-safety (validation, tree-mutations, single-campaign-mode,
  final-url-state, geo-preview, repush-idempotency, save fixture).
- In-memory Supabase shim cascade-deletes `google_search_sitelinks`
  when a plan is deleted.

## v23 sitelink asset shape that worked

```json
POST /v23/customers/{cid}/assets:mutate
{
  "partialFailure": true,
  "operations": [
    {
      "create": {
        "finalUrls": ["https://lwe.events/j2"],
        "sitelinkAsset": {
          "linkText": "Tickets",
          "description1": "Secure your place",
          "description2": "Limited availability"
        }
      }
    }
  ]
}

POST /v23/customers/{cid}/campaignAssets:mutate
{
  "partialFailure": true,
  "operations": [
    {
      "create": {
        "campaign": "customers/{cid}/campaigns/{campaign_id}",
        "asset":    "customers/{cid}/assets/{asset_id}",
        "fieldType": "SITELINK"
      }
    }
  ]
}
```

Empty `description1` / `description2` are OMITTED from the payload —
Google rejects empty-string descriptions. Asserted in
`buildSitelinkAssetOp` tests.

## Validation

- [x] `npx tsc --noEmit` — clean for all touched files (pre-existing
  audience + dashboard errors are out of scope).
- [x] `npx eslint lib/google-search/ lib/google-ads/ components/google-search-wizard/ app/api/google-search/ lib/db/google-search-plans.ts` — 0 errors (5 pre-existing warnings).
- [x] `node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts' 'lib/db/__tests__/*.test.ts'` — 505 pass, 0 fail, 1 skipped (pre-existing).
- [x] `npm run build` — green.

## Notes / risks

- Migration 098 must be applied to prod via Supabase MCP before push
  re-runs successfully (the wizard load and push routes both read
  `google_search_sitelinks` and will fail with table-not-found until
  applied).
- Account-level sitelink exclusion is intentionally a manual step —
  documented in-app via the launch summary warning. If a future v24
  exposes a `campaign.exclude_account_level_assets`-style setting we
  can wire it in then.
- Sitelink asset creation happens ONCE per push regardless of how many
  campaigns the plan has (single-campaign vs campaign-per-theme); the
  per-campaign linker iterates campaigns and attaches the same asset
  resource names. Tested.
- The asset itself is idempotent via `pushed_resource_name`; the
  campaignAsset link is recreated per fresh campaign push (Google
  dedupes by `(campaign, asset, fieldType)`, but we deliberately skip
  reused campaigns to avoid 409s on a re-push).

## After merge

1. Apply migration 098 via Supabase MCP.
2. Re-open the J2 single-campaign plan → Ad Copy step → Sitelinks
   section shows the 4 auto-gen defaults pointing to the LWE URL.
3. Edit / add / reorder as needed.
4. Push → Google Ads Assets tab on the campaign should show the J2
   sitelinks. Account-level sitelinks may still appear; if so, pause
   them at the account level.
