# Session log — proposal tracking-health tier

## PR

- **Number:** 421
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/421
- **Branch:** `cursor/ops/proposal-tracking-health-tier`

## Summary

Investigation-only Plan PR. Adds `docs/PROPOSAL_TRACKING_HEALTH_TIER_2026-05-15.md` — a productisation proposal for a tracking-health diagnostic + recurring monitor tier on top of the existing dashboard infrastructure. No code shipped. The doc answers Matas's five scoping questions (Meta API endpoints, data model, tile UX, client exposure, pricing) and recommends a 5–7 day build post-BR-kickoff.

The proposal leads with a three-bucket framing per memory anchor `feedback_meta_recommendations_are_not_neutral.md`:

- **Bucket A** — objective signal quality (EMQ, owned vs third-party domain split, CAPI dedup, freshness).
- **Bucket B** — platform recommendations (Opportunity Score, Advantage+ recs) surfaced neutrally with OffPixel annotation, **never rolled into a health score**.
- **Bucket C** — strategy-integrity flags (Meta automation silently overwriting campaign config) — RED alerts. This is the OffPixel differentiator vs OnSocial / DeviateLabs / Pixel Manager.

## Scope / files

- `docs/PROPOSAL_TRACKING_HEALTH_TIER_2026-05-15.md` (new, 660 lines)
- `docs/session-logs/pr-pending-cursor-ops-proposal-tracking-health-tier.md` (new, this log)

No source code changes. No migrations. No tests.

## Validation

- [ ] `npx tsc --noEmit` — N/A (docs-only)
- [ ] `npm run build` — N/A (docs-only)
- [ ] `npm test` — N/A (docs-only)
- [x] Markdown renders cleanly (verified via Read tool, no lint errors)
- [x] Confirmed Meta scopes already grant Dataset Quality API access (`app/api/auth/facebook-start/route.ts:40` requests `ads_read` + `ads_management` + `business_management`)
- [x] Cross-referenced OnSocial audit findings against Meta's documented `/stats` aggregation enum and Dataset Quality API surface
- [x] Per `feedback_no_handwave_when_numbers_dont_match.md` — every per-client exposure % in the doc is flagged as estimate pending a live `aggregation=url` probe

## Notes

- Decision asks for Matas listed in Section 8.2 of the proposal (pricing approval, OnSocial competitive positioning, bundling rules, naming, ops cadence).
- Pre-build probe (~30 min Cursor time) recommended before greenlighting the build — produces seed data for `clients.owned_domains` plus firms up the exposure rankings cited in Section 5.
- If Matas decides not to build the full tier, the Bucket C diff-snapshot pattern is worth shipping standalone as an internal-only ops tool (would have caught the WC26-MANCHESTER optimisation-event auto-rotation in 2 hours instead of 3 days). 1–2 day build.
- Per `thread-boundaries.mdc`: opened from fresh main, branch is `cursor/`-prefixed, single-PR scope.
- Per `auto-push.mdc`: commit will be pushed immediately.
