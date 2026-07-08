# Session log — D2C autoresponder (webhook / poll driven)

## PR

- **Number:** 697
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/697
- **Branch:** `cursor/d2c-autoresp-webhook-driven`

## Summary

Rewrites the misnamed `autoresp_setup` job from a one-off approve-time broadcast
into a persistent, webhook/poll-driven autoresponder. Approving now **arms** a
trigger (`result_jsonb.autoresp_config.enabled = true`) instead of firing; every
qualifying Mailchimp tag-add (webhook) or Bird list-add (60s poll) thereafter
fires a **single-recipient** send, deduped + audited in the new
`d2c_autoresp_fires` table. Adds operator dashboard visibility (armed badge, fire
stats, recent-fires timeline), arm/disarm controls, and a resumable "fire for
existing tagged members" backfill. The 3-of-3 D2C live gate still governs every
individual fire (any gate off ⇒ dry-run audit row, nothing on the wire).

## Scope / files

**Schema (apply post-merge via Supabase MCP — see below)**
- `supabase/migrations/142_d2c_autoresp_fires.sql` — audit + dedup table (unique
  on `(event_id, provider, member_identifier)`, owner-read RLS, service-role writes).
- `supabase/migrations/143_autoresp_rows_reset.sql` — seeds inactive
  `autoresp_config` on pre-existing `autoresp_setup` rows (Throwback Algarve +
  Hop on the Top Porto), idempotent + env-safe.

**Fire semantics (Goal 4)**
- `lib/d2c/fire-type.ts` — new `configure_autoresponder` fire type; `autoresp_setup`
  moves out of `direct_fire`; teal "AUTORESPONDER" badge.
- `lib/actions/d2c-sends.ts` — `armAutoresponder` / `disarmAutoresponder`.
- `app/api/cron/d2c-send/route.ts` — skips `autoresp_setup` rows (no more one-off fire).

**Pure seams (testable)**
- `lib/d2c/autoresp/helpers.ts` — config read/merge, `shouldFireAutoresp`,
  `resolveAutorespRecipient`, `normaliseE164`.
- `lib/d2c/autoresp/bird-contacts.ts` — defensive Bird contacts parser.

**Fire path + persistence**
- `lib/db/d2c-autoresp.ts` — claim-then-fire dedup + dashboard fire summaries.
- `lib/d2c/autoresp/fire.ts` — shared fire+dedup+audit (email via ephemeral
  member-of-1 segment; WhatsApp via single-recipient Bird template).
- `lib/d2c/mailchimp/ephemeral-segment.ts` — create/delete member-of-1 segment.
- `lib/d2c/mailchimp/provider.ts` — honour `audience.saved_segment_id` +
  `audience.send_now` (single-member immediate send).
- `lib/db/d2c.ts` — `getAutorespSendForEvent`, `listAutorespSendsByChannel`.

**Triggers**
- `app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts` — fires the armed
  email autoresponder on a qualifying tag-add (Goal 2, best-effort, synchronous).
- `app/api/cron/d2c-autoresp-poll-bird/route.ts` — 60s Bird poll (Goal 3).
- `app/api/cron/d2c-autoresp-backfill-tick/route.ts` + `lib/d2c/autoresp/backfill.ts`
  + `app/api/d2c/scheduled-sends/[id]/autoresp-backfill/{start,status}/route.ts` — resumable backfill (Goal 7).
- `vercel.json` — registers the two per-minute crons.

**Dashboard (Goal 6)**
- `components/dashboard/d2c/autoresp-panel.tsx` (new), `send-preview.tsx`,
  `event-dashboard.tsx`, `lib/db/d2c-dashboard.ts` — armed badge, fire stats,
  recent-fires timeline, arm/disarm + backfill controls. Public share is
  read-only and PII-stripped (identifiers masked / removed server-side).

## Validation

- [x] `npx tsc --noEmit` (no new errors in touched files)
- [x] `npm run build`
- [x] `node --test` on new + affected suites (45 pass): autoresp helpers,
  bird-contacts parser, backfill state, fire-type (updated), Mailchimp
  single-member byte-diff, Bird single-recipient byte-diff (pre-existing).

## Notes / spec corrections

- **Bird webhook skipped (per user decision).** Investigation intentionally
  skipped; Bird autoresp uses a 60s poll cron instead. Rationale: thin Bird API
  surface, webhook subscribe/verify is a full sub-arc, 60s latency is fine,
  polling is easier to test + reuse for backfill.
- **Bird list-contacts shape UNVERIFIED.** No live capture was taken. The parser
  (`bird-contacts.ts`) reads defensively across plausible field names and drops
  anything unparseable (safe no-op, never mis-fires). **Action for reviewer:** a
  live capture of `GET /workspaces/{ws}/lists/{listId}/contacts` should be dropped
  into `.scratch/` so the parser + `createdAt` windowing can be tightened.
- **No Mandrill/transactional key** on the Mailchimp account, so single-member
  email sends go via a throwaway member-of-1 static segment (create → send now →
  delete). Delete is best-effort; a leaked segment is cosmetic, never a mis-send.
- **`scheduled_for` is NOT NULL**, so the brief's "reset scheduled_for to null"
  is impossible. Instead the `d2c-send` cron skips `autoresp_setup` rows entirely,
  making the stale timestamp inert (documented in migration 143).
- **Dedup is absolute per `(event, provider, member)`** — the claim-then-fire row
  guarantees at-most-once even under concurrent webhooks. Hard provider failures
  release the claim so a later poll/backfill retries; dry-run + successful fires
  keep the row.
- **Supabase MCP was unreachable this session** (connection timeout). Migrations
  142 + 143 follow the repo's standard "apply manually post-merge via MCP
  `apply_migration`" flow (same as 141). They must be applied before the feature
  is live.
