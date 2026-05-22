# Cursor prompt [Cursor, Opus] — push geo location criteria + fix budget/geo UI persistence

Copy this entire block into Cursor as a single message. Opus — the geo-resolution piece touches the live push path; get the geo-target-constant lookup right.

PREREQUISITE: Phases 1-4 + 3.5 + #448/#449/#450 merged. Wizard has pushed live to LWE successfully (J2 plan, 7 campaigns PAUSED). Migration 096 applied.

---

## CONTEXT

The wizard pushed 7 J2 campaigns live to LWE (PAUSED) — proven working. BUT three gaps surfaced in the live result, confirmed in the Google Ads UI:

1. **Geo location targeting NOT pushed (the v0 gap from #449).** Campaigns show "Currently targeting all but excluded locations" in the Locations tab — i.e. worldwide, no London targeting. The push adapter sets `geoTargetTypeSetting` (Presence type) but never sends `campaignCriterion` location rows. For a real launch this would spend on global traffic. THIS is the main fix.
2. **Budget input doesn't persist from the wizard UI.** The Campaigns-step budget field + bulk-set don't write `daily_budget` to the tree before autosave (had to set £1 via direct DB UPDATE). Geo targets saved fine in the same session → it's specific to the budget input wiring.
3. **Geo bid-modifier doesn't capture.** Typing "+20" in the bid-modifier field saves `bid_modifier_pct` as null (the location string saves fine).

## BUG 1 — push geo location criteria (the priority)

The plan stores `geo_targets` as `{ targets: [{ location, bid_modifier_pct }], geo_target_type }` (jsonb on `google_search_plans`). The push adapter (`lib/google-ads/campaign-writer.ts`) must, for each campaign, send location targeting criteria.

### Geo resolution — string → Google geoTargetConstant ID

`location` is a free-text string ("london", "London, England", "South East"). Google Ads `campaignCriterion` location targets need a `geoTargetConstant` resource (`geoTargetConstants/1006886` for London, UK). Two options:

**Option A (recommended): GeoTargetConstantService.suggest.** Google Ads API has `geoTargetConstants:suggest` — POST a location name + locale/country, get back ranked geoTargetConstant matches. Resolve each `location` string to its top match's resource name at push time. This handles "london", "South East", "Italy" etc robustly.
- Endpoint: `POST /v23/geoTargetConstants:suggest` with `{ locale: "en", countryCode: "GB", locationNames: { names: [...] } }`.
- Take the highest-relevance ENABLED result per query.
- Cache within a single push (don't re-query the same string).

**Option B (fallback): hardcoded map.** A `lib/google-ads/geo-target-constants-map.ts` of common UK locations → IDs (London 1006886, United Kingdom 2826, South East England, etc). Faster, no extra API call, but brittle for arbitrary strings. Use as a fallback if `suggest` returns nothing.

Recommend Option A with Option B as fallback for the top ~20 UK locations.

### Build the criteria

For each campaign, after the campaign + ad groups are created, send a `campaignCriteria:mutate` with one create per geo target:
```json
{
  "campaign": "<campaign resourceName>",
  "location": { "geoTargetConstant": "geoTargetConstants/1006886" },
  "bidModifier": 1.20   // if bid_modifier_pct is +20; convert pct → multiplier (1 + pct/100); omit if null
}
```
- `bidModifier` is a multiplier: +20% → 1.20, -10% → 0.90. Only send if `bid_modifier_pct` is non-null.
- Sequential (GOOGLE_ADS_CHUNK_CONCURRENCY=1), partialFailure:true on the geo batch so one bad location doesn't kill the campaign.
- Add the created geo criteria to the launch summary (`geoTargetsCreated` / `geoTargetsFailed`).
- If a location string can't be resolved, add to `geoTargetsFailed` with a clear reason, don't crash the push.

### Idempotency
Geo criteria need their own idempotency signal so a re-push doesn't duplicate. Either store `pushed_resource_name` per geo target (would need the geo targets as their own rows — they're currently in plan jsonb, so this is awkward) OR before pushing geo, query existing campaignCriteria for the campaign and skip locations already present. Simplest v1: on re-push of an already-pushed campaign (campaign has pushed_resource_name), skip geo entirely unless force. Document the choice.

## BUG 2 — budget input persistence (wizard UI)

In the Campaigns step component (`components/google-search-wizard/steps/campaigns.tsx` or similar), the daily-budget input + the bulk-set "set all" input must write `daily_budget` into the working tree state so the debounced autosave picks it up. Currently they don't (DB showed null after the operator entered values). Trace:
- Does the input's onChange update the tree state via the tree-mutation helpers (`lib/google-search/tree-mutations.ts`)?
- Is there a `setCampaignDailyBudget` mutation? If not, add one + wire the input to it.
- The bulk-set input must map over all campaigns calling that mutation.
- Verify with a test: simulate entering a budget → assert the tree state's campaign.daily_budget updates → assert the autosave payload includes it.

## BUG 3 — geo bid-modifier capture (wizard UI)

In the Targeting & Budget step's geo-target editor, the bid-modifier input doesn't write `bid_modifier_pct`. Same root cause shape as Bug 2 — the input's onChange isn't updating the geo_targets tree state. Fix the wiring + parse the input (accept "+20", "20", "-10" → numeric 20 / -10). Test: enter "+20" → assert geo_targets[i].bid_modifier_pct === 20.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-ads/ lib/google-search/ components/google-search-wizard/
node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts' 'lib/google-search/__tests__/*.test.ts'
npm run build
```

Tests:
- Geo resolution: "london" → resolves to a geoTargetConstant (mock the suggest response); unresolvable string → geoTargetsFailed
- Geo criteria: campaign with 1 geo target + bid modifier → campaignCriteria:mutate sent with location + bidModifier=1.20
- Geo bid modifier null → criterion sent without bidModifier
- Budget mutation: setCampaignDailyBudget updates tree state; bulk-set updates all
- Geo bid-modifier input: "+20" → bid_modifier_pct 20
- Push idempotency: re-push of pushed campaign skips geo (or dedupes)

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-geo-criteria-and-ui-fixes`
- REST only, sequential, GOOGLE_ADS_CHUNK_CONCURRENCY=1
- partialFailure on geo batch — one bad location doesn't kill the campaign
- Don't regress the working push (campaign/adgroup/keyword/RSA/negative chain stays intact)
- Don't regress the #450 save hotfix or the geo codec totality
- No migration unless geo-target idempotency genuinely needs per-target rows — prefer query-existing-criteria dedup

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-geo-criteria-and-ui-fixes.md`. PR title: `feat(creator): push geo location criteria + budget/geo UI persistence fixes`. Document the geo-resolution approach (suggest vs map) + the idempotency choice.

## AFTER THIS MERGES

Re-push the J2 plan (force re-push, or push to a fresh plan). Verify in Google Ads: campaigns now show London (+20%) in the Locations tab instead of "all locations". Then the wizard is truly launch-ready for a real client. Budget + geo-modifier inputs persist from the UI without needing DB intervention.

## NOTE ON TONIGHT'S LIVE CAMPAIGNS

The 7 campaigns already on LWE (PAUSED, [UTB0043-New]) target all-locations. After this fix, either: (a) force re-push the plan to add geo criteria to the existing campaigns, or (b) since they're a smoke test on LWE, just delete them and re-push clean. The operator (Matas) will decide — they're PAUSED so spending £0 either way.
