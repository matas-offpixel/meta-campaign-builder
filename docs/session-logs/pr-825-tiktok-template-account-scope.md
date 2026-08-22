# Session log

## PR

- **Number:** 825
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/825
- **Branch:** `cursor/tiktok-template-account-scope`

## Summary

Library Use Template no longer treats the snapshot client as the target. The operator must pick a client and event before a draft is created; account setup restores only when that chosen client matches the template. `omitTemplateIdentity` is gone (it either deleted required fields or listed them — both were dead). A cleared Target cost per result stays null on reload. Review still shows wizard validation next to launch blockers, including when the killswitch is off.

## Scope / files

- `lib/tiktok-wizard/templates.ts` — delete `omitTemplateIdentity`; spread snapshot; pin `clientId` / `eventId`
- `lib/tiktok-wizard/library.ts` — `startTikTokDraftFromTemplate` takes caller client + event
- `components/dashboard/tiktok-campaign-library.tsx` — show saved client; require client + event before Use Template
- `components/tiktok-wizard/load-template-modal.tsx` — show saved client
- `components/tiktok-wizard/wizard-shell.tsx` — pass client names; keep current event_code on in-wizard apply
- `components/tiktok-wizard/steps/review-launch.tsx` — wizard validation list + labeled wizard cards
- `lib/tiktok-wizard/migrate-draft.ts` — present-as-null `targetCostPerResult` is not backfilled
- `lib/tiktok-wizard/review.ts` — chip shows blocker count even when killswitch is off
- `app/(dashboard)/tiktok/page.tsx` — load all clients/events for the picker

## Five fixes

1. **omitTemplateIdentity deleted.** `applyTikTokTemplate` spreads `template.snapshot` and pins `clientId` / `eventId` after. `npm run build` must succeed (previous TS2790 claim was false).
2. **Library Use Template no longer passes `template.snapshot.clientId`.** Caller supplies target client + event. No client context → operator must pick before the draft is created. Template client shown on `TemplateRow` and `TikTokLoadTemplateModalBody`. Unscoped helper load no longer asserts `advertiserId === "adv-live"`.
3. **Library-path drafts require an event.** Use Template picker requires event. Same-event apply keeps snapshot `eventCode`; different event clears it so the campaign page hydrates from the event row. Test: helper with chosen eventId + event_code is advanceable past step 1.
4. **present-as-null `targetCostPerResult` is not backfilled.** Absent key + COST_CAP + CONVERSION still backfills from `benchmarkCpc`. Present-as-null stays null and `collectTikTokLaunchPreflight` blocks (`target-cost` / `targetCostPerResult`).
5. **Review chip + wizard validation.** Killswitch branch is below / composed with blocker count. `buildTikTokWizardValidationIssues` is listed as "Wizard validation" (not launch preflight). Card grid labeled "Wizard checks (not launch blockers)" — those cards were not added to launch preflight.

## Validation

- [x] `npm run build` — succeeded. TypeScript finished in 14.7s; compiled successfully in 5.7s. No TS2790. One pre-existing Next.js warning on `app/api/admin/remotion/render-reel/route.ts` (`config` export ignored).
- [x] `npx eslint` on changed files — clean
- [x] `npm test` — `4160 = 4144 passed + 13 failed + 3 skipped`. Pre-existing failures still 13. Net +2 tests vs the prior 4158 / 4142 pass baseline (library-path event-code + present-as-null targetCostPerResult).

## Notes

- Decision: require client **and** event in the library Use Template flow (inline picker). Do not silently use snapshot identity as the target. Wizard Load Template still uses the current draft's client + event.
- Decision: label the Review card block "Wizard checks (not launch blockers)" rather than expanding `collectTikTokLaunchPreflight` with campaign-name / creative-assignments / targeting cards that are not launch fields.
- identityBcId: re-resolve on load (never restore from snapshot).
- Schedule start/end always nulled.
- Rebased onto `2ce2af4` (#826).
