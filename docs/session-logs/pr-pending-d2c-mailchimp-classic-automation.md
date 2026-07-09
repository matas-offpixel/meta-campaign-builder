# Session log

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cursor/d2c-mailchimp-classic-automation`

## Summary

Pivots the D2C **email** autoresponder off the per-fire campaign anti-pattern
(one throwaway Mailchimp campaign per fan) to Mailchimp **Customer Journeys**
(`tag-added` trigger, created in the Mailchimp UI). Our system no longer
creates, triggers, or sends the email autoresp — it logs tag events for signup
counting and defers to the Journey. Removing the per-fire path also fixes a live
**double-send** incident: events with our email autoresp armed *and* a Customer
Journey were sending fans two autoresp emails. WhatsApp (Bird) is untouched.

Original ask was to build a Classic Automation via `POST /automations`, but that
feature was retired June 1, 2025; Customer Journeys (the replacement) have no
create API. Verified live + against the OpenAPI spec — see
`docs/D2C_MAILCHIMP_AUTORESP_JOURNEY.md`. Pivoted to Option A (manual per-event
Journey; system just stops the anti-pattern) with the user's sign-off.

## Scope / files

- `app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts` — removed the
  email `fireAutorespForTagAdd` path (both `processTagEvent` + profile fallback);
  kept tag logging + snapshot recompute.
- `lib/mailchimp/profile-fallback.ts` (+ test) — dropped the autoresp dep +
  `autoresp` response field; now tag-tracking only.
- `lib/d2c/autoresp/backfill.ts` — disabled email backfill (short-circuits to
  `done`); removed the unreachable `mailchimpChunk` + unused imports. WhatsApp
  backfill unchanged.
- `app/api/d2c/scheduled-sends/[id]/autoresp-backfill/start/route.ts` — rejects
  the email channel with guidance.
- `lib/d2c/autoresp/helpers.ts` (+ test) — added pure
  `buildCustomerJourneyChecklist(tag, serverPrefix)`.
- `components/dashboard/d2c/autoresp-panel.tsx` — email shows the Journey
  checklist (tag + deep link + no-double-send line); hides the email backfill.
  WhatsApp unchanged.
- `components/dashboard/d2c/send-preview.tsx` — passes channel/signupTag/
  serverPrefix to the panel.
- `lib/actions/d2c-sends.ts` — arm/disarm docstrings updated (no logic change).
- Docs: `docs/D2C_MAILCHIMP_AUTORESP_JOURNEY.md` (new),
  `docs/D2C_FULL_ORCHESTRATION.md` (autoresp rows).

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files (pre-existing errors
  in unrelated `lib/meta`, `lib/clients/asset-queue`, `lib/dashboard`,
  `lib/db` test files only).
- [ ] `npm run build`
- [x] `npm test` — touched tests green (profile-fallback, autoresp helpers).
  Pre-existing unrelated failures confirmed present on clean `main` too
  (e.g. `lib/meta/__tests__/creative-buy-tickets-cta.test.ts`).

## Notes

- **No self-merge** — user-visible behaviour change on the live prod autoresp
  path; needs Matas review.
- Disarming an email autoresp does NOT pause the Mailchimp Journey (no API) —
  that's a manual step in Mailchimp. Called out in the panel + docs.
- Audit query for the double-send incident (which events had email autoresp
  armed while a Journey was also live) is in the PR body.
