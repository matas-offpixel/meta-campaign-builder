# Session log — Bird broadcast pivot (review-first draft campaigns)

## PR

- **Number:** 657
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/657
- **Branch:** `d2c/bird-broadcast-drafts`

## Summary

Splits Bird (WhatsApp) D2C sends into two paths so Matas can review + proof-test
30k-contact broadcasts before they fire. Broadcast job types
(`announce`, `reminder`, `presale_live`, `gen_sale`) now create a **Bird draft
campaign** and stop at `status='draft_ready'`; Matas reviews, adds audiences,
proof-tests and fires manually in the Bird UI. Low-blast personalised sends
(`autoresp_setup`, `community_early`) stay direct-fire via `/messages`
(unchanged). All under the existing 3-of-3 dry-run gate.

## Scope / files

- `supabase/migrations/129_d2c_bird_draft_campaigns.sql` — `status` CHECK gains
  `draft_ready`; adds `bird_campaign_id`, `bird_campaign_edit_url`.
- `lib/d2c/bird/campaigns/client.ts` (new) — `createDraftCampaign` +
  idempotency-by-name + `buildDraftPayload`.
- `lib/d2c/orchestration/index.ts` — `BIRD_DRAFT_REVIEW_JOBS` /
  `BIRD_DIRECT_FIRE_JOBS`, `isBirdDraftReviewJob`, `draftCampaignName`,
  `draft_campaign` plan action + dispatch branch.
- `app/api/cron/d2c-send/route.ts` — persists draft campaign + `draft_ready`,
  calls `logDraftReady`.
- `components/dashboard/d2c/scheduled-send-row.tsx` — "Draft ready for review"
  badge, "Review in Bird →" button, result payload preview.
- `app/(dashboard)/d2c/event/[id]/page.tsx` — "N drafts awaiting review" header
  counter.
- `lib/d2c/notifications/draft-ready.ts` (new) — structured log hook.
- `lib/d2c/types.ts`, `lib/db/d2c.ts` — enum + columns + persistence.
- `components/dashboard/events/event-comms-panel.tsx` — status label for new enum.
- `docs/D2C_BROADCAST_REVIEW_FLOW.md` (new).
- Tests: `lib/d2c/bird/campaigns/__tests__/client.test.ts`,
  `lib/d2c/orchestration/__tests__/broadcast-split.test.ts`; updated
  `lib/d2c/mailchimp/__tests__/orchestration.test.ts`.

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing unrelated test-fixture
  errors only).
- [x] `npm run build` — green.
- [x] D2C tests — 70/70 pass. (Full-suite `@/`-alias failures are pre-existing
  and unrelated to this change.)

## Notes

- **Blocker / maintenance:** the prompt's `.scratch/bird-campaign-draft-capture.txt`
  ground-truth capture was **not present** in the repo. `createDraftCampaign`
  uses a best-effort endpoint (`POST /workspaces/{wid}/campaigns`) + payload,
  guarded by `DRAFT_CAMPAIGN_VERIFIED = false`. Safe because live creation only
  runs under the (off) 3-of-3 gate. Capture a real request and reconcile
  `campaignsPath` / `buildDraftPayload` / `birdCampaignEditUrl` before going live.
- Draft-review jobs intentionally skip the template-`active` check (Matas fires
  manually after review); direct-fire jobs still refuse non-active templates.
