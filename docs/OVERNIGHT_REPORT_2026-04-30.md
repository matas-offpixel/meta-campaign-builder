# Overnight Report — 2026-04-30

## PRs Merged

1. [#181 — creator: TikTok wizard Step 0 + Step 1 (account + campaign setup)](https://github.com/matas-offpixel/meta-campaign-builder/pull/181)
   - Merged: 2026-04-29 22:53 UTC
   - Merge commit: `a5b1b086dbfbee7ea8501a58b1baecea17077e9c`
   - Shipped advertiser, identity, pixel, campaign naming, objective, optimisation-goal, and bid-strategy setup with draft persistence.

2. [#183 — creator: TikTok wizard Step 2 + Step 5 (optimisation + budget)](https://github.com/matas-offpixel/meta-campaign-builder/pull/183)
   - Merged: 2026-04-29 22:58 UTC
   - Merge commit: `76ac5f40916e575c207838179e0c8a7417bfcbeb`
   - Shipped Smart+ linkage, benchmarks, pacing, guardrails, budget mode/amount, schedule, and frequency cap.

3. [#184 — creator: TikTok wizard Step 3 + Step 4 (audiences + creatives)](https://github.com/matas-offpixel/meta-campaign-builder/pull/184)
   - Merged: 2026-04-29 23:04 UTC
   - Merge commit: `4912e309c64aeda7d0a7245952959ff77ae767d6`
   - Shipped audience targeting and video-reference creative setup using read-only TikTok API helpers.

4. [#185 — creator: TikTok wizard Step 6 + Step 7 (assign + review/launch placeholder)](https://github.com/matas-offpixel/meta-campaign-builder/pull/185)
   - Merged: 2026-04-29 23:09 UTC
   - Merge commit: `946712825618b1f5b78e5f7966e8f4ac31da9c2c`
   - Shipped creative assignment matrix, pre-flight checks, read-only review, and disabled launch surface.

5. [#186 — creator: TikTok campaign library + event/client entry points](https://github.com/matas-offpixel/meta-campaign-builder/pull/186)
   - Merged: 2026-04-29 23:16 UTC
   - Merge commit: `52fff6e6de7b08ebd6d98ba5698ff9e0c7888348`
   - Shipped the TikTok draft library, draft creation flow, and dashboard entry points.

## Validation

For every PR:
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `git diff --check` passed.
- Vercel PR checks passed before merge.

Known baseline:
- `npm run lint` still fails on existing unrelated lint issues outside these PRs, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Decisions

Detailed decisions are in [TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md](./TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md).

Highest-signal decisions:
- No TikTok write APIs were added. All TikTok Business API calls are read-only.
- No migrations were added during the wizard flesh-out.
- Identity API failures keep the draft usable via a manual identity override.
- Smart+ locks Step 1 bid strategy and Step 5 lifetime/automatic scheduling.
- No audience-category cache table was added; live read latency can be reassessed after testing.
- Review-ready state is stored as `reviewReadyAt` in draft JSON instead of adding a DB status migration.
- The existing `/tiktok` skeleton became the TikTok campaign library instead of adding a second `/tiktok-campaigns` route.

## Spec Questions

Open questions are in [SPEC_QUESTIONS_FOR_MATAS.md](./SPEC_QUESTIONS_FOR_MATAS.md).

No new blocker questions were added during the wizard PRs. Existing historical questions still include TikTok share-report window/fallback decisions.

## Pending Cowork Migrations

- `supabase/migrations/059_tiktok_rollup_breakdowns_and_metrics.sql` from the earlier TikTok reporting PR still needs confirmation if it has not already been applied.
- No new migrations were committed in PRs #181, #183, #184, #185, or #186.

## Morning Walkthrough

Recommended test event: use BB26-RIANBRAZIL or Rian Brazil Promo, whichever currently has a client/event TikTok account connected.

1. Open `/tiktok` and confirm the TikTok campaign library loads.
2. Click `New TikTok campaign`.
3. Pick the TikTok-connected client and the event, then create the draft.
4. Step 0: select the advertiser, identity, and optional pixel. If identities do not load, test the manual identity override.
5. Step 1: enter the editable campaign name and confirm the locked `[event_code]` prefix remains in place. Change objective and confirm optimisation goals update.
6. Step 2: enable Smart+ and confirm bid strategy is locked to Smart+ and Step 5 switches to lifetime/automatic schedule. Add CPV/CPC/CPM and guardrails.
7. Step 3: select at least one interest/behaviour/custom/lookalike or location/demographic/language dimension. Confirm chips and estimated reach area render.
8. Step 4: paste a TikTok video URL or video ID, add ad text, landing page, CTA, and create one or more variations. Confirm variation names use ` · v1`, ` · v2`.
9. Step 5: confirm budget, schedule, and frequency cap persist. If Smart+ is on, confirm budget mode and schedule controls are disabled.
10. Step 6: assign every creative to at least one ad group and ensure every ad group has at least one creative.
11. Step 7: review all panels and pre-flight checks. Confirm `Launch on TikTok` is disabled with the writes-coming-soon tooltip. Click `Mark review ready` and confirm the timestamp appears.
12. Return to `/tiktok` and confirm the draft appears in the library with `review ready`.

## Notes / Smells

- The repo-wide lint baseline is still noisy enough that focused lint remains the only useful validation for these PRs.
- `gh pr merge --squash --delete-branch` successfully merged remotely but repeatedly failed local cleanup because `main` is checked out in `/Users/liebus/mcb-tiktok-oauth`. Remote branches were manually deleted after each merge.
- The generated Supabase types still do not include `tiktok_campaign_drafts`; existing helpers cast around this until types are regenerated.
- The `/tiktok/new` route currently filters the client dropdown to TikTok-connected clients but lists all events. Events can still be narrowed by the selected client in the form.
