# Session log

## PR

- **Number:** 805
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/805
- **Branch:** `cursor/tiktok-launch-progress-and-ads-manager-link`

## Summary

Review & Launch showed only "Launching…" until the write finished, then left no way to open the campaign. Stream real per-phase progress from the orchestrator, persist campaign / ad-group / ad ids plus launched-at on the draft, and add an advertiser-scoped TikTok Ads Manager link.

Rebased onto `e78c346` (#812) so Lead generation, targeting reconcile, cover-image / name-collision / deny-list / empty-name preflight, and audience presets stay intact.

## Scope / files

- `lib/tiktok/write/orchestrator.ts` — optional `onProgress` after campaign / each ad group / each ad; kept `existingCampaignNames`
- `app/api/tiktok/launch-campaign/route.ts` — NDJSON stream (`progress` then `result`)
- `lib/tiktok/write/launch.ts` — persist `launchedAt`; kept cover-image hydrate and campaign-name preflight
- `lib/tiktok/ads-manager-url.ts` — `/i18n/manage/campaign?aadvid=` (live redirect, advertiser `7639802149165301776`); no campaign-selection param
- `components/tiktok-wizard/launch-panel.tsx` — in-flight / succeeded / failed
- `lib/tiktok-wizard/migrate-draft.ts` — `normalizePublishedIds` fills omitted `launchedAt`

## Rebase conflicts

- `orchestrator.ts` — kept both `existingCampaignNames` (#804) and `onProgress`
- `migrate-draft.test.ts` — kept CONVERSIONS load test (#811) and omitted-`launchedAt` test
- `write-foundation.test.ts` — kept cover-image blocker and per-phase progress test
- Auto-merged `review-launch.tsx` / `launch.ts` kept Lead-gen labels, widening notes, cover hydrate, name collision, `campaignName` on error map

## Validation

- [x] `npm run lint` on changed files
- [x] `npm run build`
- [x] `npm test` — 4074 = 4058 passed + 13 failed + 3 skipped (pre-existing 13; +12 vs #812 / e78c346)

## Notes

- Streaming is real: orchestrator reports after each write. Before the first event the panel names the three phases as Waiting — no invented counts.
- Ads Manager URL is advertiser-scoped only. No TikTok SDK/docs campaign-selection equivalent was found; none shipped.
- Preflight blockers still fire: identity_bc_id, cover image, budget minimum, campaign-name collision, optimisation-event deny-list, empty ad group name.
