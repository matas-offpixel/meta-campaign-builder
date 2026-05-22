# Cursor prompt [Cursor, Opus] — live geo-resolution preview in the wizard

Copy this entire block into Cursor as a single message. Opus — touches the live Google Ads API + the wizard UI.

PREREQUISITE: Phases 1-4 + 3.5 + #448-#451 merged. Geo criteria push works (PR #451). Migration 096 applied.

---

## PROBLEM

The Targeting & Budget step's Geo Targets editor accepts a free-text location ("london") but gives NO indication whether that string will resolve to a real Google Ads location. Resolution happens only at push-time (via `geoTargetConstants:suggest` in the push adapter). So the operator pushes blind — they don't find out if "london" matched London-UK, matched the wrong London (Ontario? Kentucky?), or failed entirely, until after the campaigns are created and they check the Locations tab.

For a tool that creates live campaigns, that's not good enough. Add live resolution preview: as the operator types a location, show what Google will actually match it to.

## WHAT TO BUILD

### 1. Resolution API route — `app/api/google-search/resolve-geo/route.ts`

A POST route (cookie-bound auth) that:
- Takes `{ location: string, google_ads_account_id: string }` (or resolves creds from the plan)
- Calls the SAME resolution path the push adapter uses (reuse `geoTargetConstants:suggest` + the UK fallback map from PR #451 — extract into a shared `lib/google-ads/geo-resolve.ts` if it isn't already, so wizard preview + push use ONE resolver and can't diverge)
- Returns the top match(es): `{ ok: true, matches: [{ resourceName, canonicalName, countryCode, targetType, reach? }] }` or `{ ok: false, reason }`
- Resolves creds via the plan's `google_ads_account_id` → `getGoogleAdsCredentials`. Session-bound.
- Cache-friendly: the suggest call is read-only; debounce on the client so we're not hammering Google on every keystroke.

CRITICAL — single source of truth: the preview and the push MUST use the identical resolver function. If they diverge, the preview could show "✓ London" but the push resolves differently. Extract the resolver from `campaign-writer.ts` into `lib/google-ads/geo-resolve.ts`, export it, and have BOTH the push adapter and this new route import it. This refactor is the load-bearing part — don't duplicate the logic.

### 2. Wizard UI — Geo Targets editor (Targeting & Budget step)

For each geo target row:
- Debounced (400-500ms) call to `/api/google-search/resolve-geo` as the operator types the location
- Show the resolved result inline under/beside the input:
  - ✓ green: `London, England, United Kingdom` (canonical name from Google) — matched
  - ⚠ amber: `No match found for "londn" — check spelling` — unresolved
  - subtle loading state while the debounced call is in flight
- If multiple plausible matches, show the top one with the canonical name so the operator can see EXACTLY what Google will target (e.g. confirms it's London-UK not London-Ontario). Optionally a small dropdown of alternatives, but minimum viable = show the top match's canonical name clearly.
- Store the RESOLVED resourceName + canonical name on the geo target (extend the geo_targets jsonb entry: `{ location, bid_modifier_pct, resolved_resource_name?, resolved_name? }`). Then push uses the pre-resolved id directly (no re-resolution needed at push, removing the divergence risk entirely).
- If a geo target has no resolved match, the Review step should soft-warn (or hard-block, your call — recommend soft-warn since the push handles failures gracefully): "Geo target 'londn' didn't resolve — it won't be targeted."

### 3. Push adapter — prefer the pre-resolved id

In `campaign-writer.ts`, if a geo target already has `resolved_resource_name` (set by the wizard preview), use it directly instead of re-calling suggest. Fall back to live resolution only if the pre-resolved id is absent (e.g. xlsx-imported plans that never went through the preview UI). This makes push faster + guarantees push matches what the operator saw.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-ads/ lib/google-search/ app/api/google-search/ components/google-search-wizard/
node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts' 'lib/google-search/__tests__/*.test.ts'
npm run build
```

Tests:
- `geo-resolve.ts` shared resolver: "london" → London UK resourceName (mock suggest); unresolvable → null. Same function used by route + adapter (assert one import source).
- resolve-geo route: valid location → matches; bad creds → 502; unauth → 401
- push adapter: geo target WITH resolved_resource_name → uses it directly, no suggest call; geo target WITHOUT → falls back to suggest
- geo_targets jsonb codec: round-trips the new resolved_resource_name + resolved_name fields; legacy entries (no resolved fields) still decode

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-live-geo-preview`
- ONE shared resolver (`lib/google-ads/geo-resolve.ts`) used by both preview route and push adapter — no duplicated logic
- Debounce the preview API calls (don't hammer Google per keystroke)
- Session-bound auth on the resolve route
- Don't regress the #451 geo push or the #450 save hotfix
- Extend geo_targets jsonb additively (resolved fields optional; legacy decodes fine — the geo codec from #449/#450 must stay total)
- No migration (geo_targets is jsonb)

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-live-geo-preview.md`. PR title: `feat(creator): live geo-resolution preview in wizard + shared resolver`.

## AFTER THIS MERGES

Matas opens the J2 plan → Targeting step → "london" shows "✓ London, England, United Kingdom" inline before pushing. Confidence restored. Then delete the old LWE campaigns + push clean → London (+60%) targeting confirmed both in the wizard preview AND the Google Ads Locations tab.

## ALSO (one-line, while you're in geo code)

PR #451's UK fallback map has a copy-paste bug: `wales` maps to the same geoTargetConstant ID as `england` (20339). Fix Wales to its correct ID. Low priority (suggest API runs first), but you're in the file.
