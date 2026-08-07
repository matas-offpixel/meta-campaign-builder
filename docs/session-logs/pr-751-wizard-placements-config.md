# Session log template

## Correction 2026-08-07

The manual-mode seed (`MANUAL_PLACEMENT_DEFAULTS` in
`components/steps/budget-schedule.tsx`) shipped in this PR as `FB Feed + IG
Feed only` — wrong per the operator's actual intent. Corrected in a
follow-up PR (branch `cursor/wizard-placements-default-fix`) to **FB Feed
only + ALL Instagram placements** (FB Reels/Story/Marketplace underperform
for electronic music campaigns; IG's Reels/Story/Explore are strong and
shouldn't be excluded by default). See
`docs/session-logs/pr-752-wizard-placements-default-fix.md` (PR #752) for the
follow-up's full log. No backend/Meta-payload logic changed — the resolver
in `lib/meta/placement-config.ts` already handled arbitrary
`instagramPositions` arrays correctly; only the UI's initial seed value
was wrong.

## PR

- **Number:** 751
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/751
- **Branch:** `cursor/wizard-placements-config`

## Summary

Adds a wizard-wide "Placements" config (task #117) so every ad set the launch
route creates gets an explicit placement decision instead of silently falling
through to Meta's Advantage+ Placements (= every placement Meta is willing to
serve on). Fixes the East End Dubs Newcastle signup launch failure mode
(act 606252931141334, campaign 120251192078210755, 2026-08-07): 42 ads shipped
to Audience Network, Marketplace, Search, etc. instead of the operator-intended
FB Feed + IG Feed, because nothing in the wizard ever set `publisher_platforms`
for a normal (non-"boost existing post") ad set.

## Root cause (confirmed before fixing)

`app/api/meta/launch-campaign/route.ts` only called
`resolveAdSetPlacementTargeting()` — which sets `publisher_platforms` /
`*_positions` on the ad-set targeting spec — inside
`if (assignedCreative?.existingPost)`. That helper (`lib/meta/placements.ts`)
derives placements from the platform a boosted post already lives on; it was
never meant to be the *only* placement decision in the app, but because no
other code path ever set these fields, every "new ad" (non-boost) ad set
silently launched with Meta's fully automatic Advantage+ Placements. Confirmed
via Supabase: `campaign_drafts.draft_json.settings.placements` = null,
`adSetSuggestions[].placements` = null — there was no placement UI at all.

## Shipped changes

### Data layer (`lib/types.ts`)

- New `PlacementConfig` type (`mode: "advantage_plus" | "manual"` +
  `publisherPlatforms` / `facebookPositions` / `instagramPositions` /
  `audienceNetworkPositions` / `devicePlatforms`), plus the small position
  enum types it's built from.
- `CampaignSettings.placementConfig?: PlacementConfig` — campaign-wide, Step 5.
- `AdSetSuggestion.placementConfig?: PlacementConfig` — rare per-ad-set
  override, wins over the campaign-wide config for that one ad set.
- Absent entirely (every existing draft) → identical to
  `{ mode: "advantage_plus" }` → Meta's automatic placements → **zero
  regression** for every draft that pre-dates this field.

### Pure resolver (`lib/meta/placement-config.ts`, new)

- `resolveEffectivePlacementConfig(campaignWide, perAdSetOverride)` —
  precedence: per-ad-set > campaign-wide > automatic default.
- `buildPlacementConfigTargeting(config)` — converts the resolved config into
  Meta's ad-set targeting fields. Returns `null` (omit every field — NOT an
  explicit empty automatic setting) for `advantage_plus` mode, for an absent
  config, and for `manual` mode with zero platforms selected (falls back to
  automatic rather than launching an ad set with nowhere to serve).
- `validatePlacementConfig` / `summarisePlacementConfig` — mirrors the
  existing `lib/meta/placements.ts` API shape for the narrower existing-post
  case.
- Dependency-free (no Graph client) — exhaustively unit-testable offline.

### `lib/meta/adset.ts`

- `MetaTargeting` gained `audience_network_positions?` and
  `device_platforms?` (`publisher_platforms` / `facebook_positions` /
  `instagram_positions` already existed for the existing-post case).
- `buildAdSetPayload(...)` takes a new, final optional
  `campaignPlacementConfig?: PlacementConfig` param. Resolves it against
  `adSet.placementConfig` (`resolveEffectivePlacementConfig`) and applies the
  result to `targeting` **unconditionally** — every ad set now gets an
  explicit placement decision, not just existing-post boosts.
- The value import from the new module uses a relative path with an explicit
  `.ts` extension (`./placement-config.ts`), NOT the `@/` alias — `adset.ts`'s
  existing `@/lib/types` imports are all type-only and get erased by
  `--experimental-strip-types`, but this is a real value import, and plain
  Node ESM resolution (used by `npm test`) doesn't understand the `@/` alias
  Next.js's bundler provides. Got this wrong on the first pass — broke every
  `lib/meta/__tests__/adset-*.test.ts` file with `ERR_MODULE_NOT_FOUND: Cannot
  find package '@/lib'` before catching it in the test run.

### `app/api/meta/launch-campaign/route.ts`

- All 6 `buildAdSetPayload(...)` call sites (Phase 2 standard sets + its
  deprecated-interest retry, Phase 2b lookalike sets, and the equivalent three
  in the multi-campaign attach loop) now forward `draft.settings.placementConfig`.
- The `if (assignedCreative?.existingPost)` gate at the two "manual placement
  override" call sites is **unchanged** — it still exists, but it's no longer
  the only placement decision in the app. It now layers a MORE SPECIFIC
  override (the post can only render on the platform it was published to) on
  top of whatever `buildAdSetPayload` already resolved from the wizard-wide
  config; existing-post ad sets still win as before.

### Wizard UI (`components/steps/budget-schedule.tsx`, `components/wizard/wizard-shell.tsx`)

- New "Placements" card on Step 5 (Budget & Schedule), between Location
  Targeting and Ad Set Suggestions: Advantage+ / Manual toggle; when manual,
  checkbox groups for Facebook (Feed/Reels/Story primary, Marketplace/Search/
  Instream video/Right column/Video feeds/legacy Reels behind "Show advanced
  placements"), Instagram (Feed/Reels/Story/Explore primary, Explore
  Home/Search behind advanced), Audience Network (own toggle, OFF by default,
  behind advanced), Messenger (own toggle, OFF by default, behind advanced),
  and Mobile/Desktop device toggles (both ON by default). Switching to manual
  for the first time seeds FB Feed + IG Feed — the operator's stated safe
  default — not an empty selection.
- "Apply to all ad sets" is the implicit default (this card sets
  `settings.placementConfig`, which every ad set inherits). A small
  "Placements" link on each ad set's row in the Ad Set Suggestions table
  expands an inline per-ad-set override (same picker, `compact`), with a "Use
  campaign default" reset that clears the override back to inheriting from
  the card above.
- `BudgetSchedule` now takes `settings` + `onSettingsChange` props (mirrors
  the pattern already used by the Creatives and Audiences steps); wired
  through `wizard-shell.tsx`.

### Not touched (scope boundary)

- `app/api/meta/create-adsets/route.ts` / `lib/hooks/useCreateAdSets.ts` — a
  parallel, flat-request ad-set-creation endpoint that appears unused by the
  live wizard launch flow (only self-references + doc mentions, no UI
  caller found). Left alone per "don't refactor unrelated files" — flagged
  here in case it turns out to be live somewhere this session didn't find.
- `components/steps/review-launch.tsx` — no placement summary added; the
  acceptance criteria didn't ask for one and Step 5 already shows the
  resolved config before Review.

## Tests

- `lib/meta/__tests__/placement-config.test.ts` — `resolveEffectivePlacementConfig`,
  `buildPlacementConfigTargeting` (advantage_plus/absent/zero-platform →
  null; FB Feed + IG Feed shape; platform/position cross-filtering; device
  platforms; no input mutation), `summarisePlacementConfig`,
  `validatePlacementConfig`.
- `lib/meta/__tests__/adset-placement-config.test.ts` — `buildAdSetPayload`
  regression proof (omitting the new param, or passing `advantage_plus`,
  produces byte-identical targeting to before this feature), manual
  campaign-wide config applied, per-ad-set override precedence, zero-platform
  fallback, device_platforms forwarding.
- `lib/meta/__tests__/launch-campaign-placement-wiring.test.ts` — source
  assertions (route.ts source text) that every `buildAdSetPayload` call site
  forwards `draft.settings.placementConfig` and that `adset.ts` resolves
  placement targeting unconditionally, following the same
  can't-import-next/server pattern as
  `lib/audiences/__tests__/launch-campaign-recovery-wiring.test.ts`. Plus the
  acceptance criterion verbatim: a FB Feed + IG Feed only config produces
  `publisher_platforms: ["facebook","instagram"]`, `facebook_positions:
  ["feed"]`, `instagram_positions: ["stream"]`.

## Validation

- [x] `npx tsc --noEmit` — clean on every touched/new file
- [x] `npm run build` — clean
- [x] `npm test` — 3384 tests (+28 new), 3368 pass, 13 pre-existing/unrelated
  failures unchanged (dashboard venue-trend-points / `@/lib` path-alias
  resolution, a canonical-tickets window test, the creative-buy-tickets-cta
  rotation test, asset-queue copy-generator/sheet-parse — all fail identically
  on a clean `main` before this branch's changes)
- [ ] Manual: re-launch a draft with the East End Dubs shape (Similar Pages +
  Wide ad sets, FB Feed + IG Feed manual config) and confirm the live Meta
  ad sets carry exactly those placements, not Advantage+ automatic

## Notes

- Migration: none — additive optional field on the `campaign_drafts.draft_json`
  JSONB blob, no schema/Zod validation exists on that column that would reject
  an unknown key.
- Related PRs verified for interaction, found none: PR #575 (BOOK_NOW
  multi-placement hard block) operates on ad *creative* `asset_feed_spec`
  customization rules (`facebook_positions`/`instagram_positions` values on
  the CREATIVE), a completely different Meta object from the AD SET
  `targeting.publisher_platforms`/`*_positions` this PR touches — no shared
  code path, confirmed by grep (`creative-book-now-multi-placement-block.test.ts`
  and `creative-multi-placement.test.ts` both still pass unmodified). PR #601
  (multi-IG-per-page) is unrelated (IG account resolution, not placements).
