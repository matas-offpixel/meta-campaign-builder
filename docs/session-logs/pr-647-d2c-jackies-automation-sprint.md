# Session log

## PR

- **Number:** 647
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/647
- **Branch:** `d2c/jackies-automation-sprint`

## Summary

Brief-to-campaign automation for D2C: a PDF (or pasted) event brief is parsed by
Anthropic into a structured event + per-milestone copy + six scheduled sends, all
gated behind the existing 3-of-3 dry-run invariant and a per-send Matas approval.
The only human runtime input is the WhatsApp community URL paste. Built on top of
the already-shipped encryption (migration 042) and Mailchimp provider — this PR
adds the orchestration schema, the brief parser, the **real Bird provider**, an
artwork resolution chain, the brief-ingest + event-approval UI, and extends the
existing `d2c-send` cron.

> **Reconciliation note:** the source prompt was written against an older repo
> snapshot. Migration `042` and the full Mailchimp provider already existed, so
> the spec's "migration 042/043" became **124/125**, and Slice 3's Mailchimp work
> was skipped (already done). See "Deviations from the prompt" below.

## Scope / files

New schema (additive, reversible):
- `supabase/migrations/124_d2c_orchestration.sql` — `d2c_scheduled_sends.job_type`
  + `idempotency_key` (full unique index) + new `d2c_event_copy` table.
- `supabase/migrations/125_d2c_brief_ingest.sql` — `d2c_brief_ingest_jobs` table.

Slice 2 — brief parser:
- `lib/d2c/brief-parser/schedule.ts` — pure, timezone-aware schedule math.
- `lib/d2c/brief-parser/index.ts` — `parseBrief(pdfBuffer)` via Anthropic PDF
  document blocks + tool-use JSON schema (model `claude-opus-4-6`, override via
  `D2C_BRIEF_PARSER_MODEL`).
- `lib/d2c/brief-parser/processor.ts` — background job processor.
- `app/api/d2c/ingest-brief/route.ts` (+ `[id]/route.ts` status) — upload/manual,
  `after()` background processing.

Slice 3 — Bird:
- `lib/d2c/bird/client.ts` — `AccessKey` auth, 20s timeout, single 5xx retry.
- `lib/d2c/bird/provider.ts` — real validate/send behind the 3-of-3 gate.
- `lib/d2c/bird/asset-resolver.ts` — Bird Media Library lookup.

Slice 4 — asset resolver:
- `lib/d2c/assets/chain.ts` (pure) + `lib/d2c/assets/resolver.ts` (event copy →
  asset queue Storage URL → Bird media → `AssetUnresolvedError`).

Slice 5 — runner + UI + tests:
- `app/api/cron/d2c-send/route.ts` — extended (artwork + `community_url` injection,
  Bird auth-error handling). **No new cron** — reuses the `*/5` `d2c-send` schedule.
- `app/(dashboard)/d2c/brief-ingest/page.tsx` + `components/dashboard/d2c/brief-ingest-form.tsx`
- `app/(dashboard)/d2c/event/[id]/page.tsx` + `components/dashboard/d2c/event-approval-panel.tsx`
  + `scheduled-send-row.tsx` + `app/api/d2c/event/[id]/community-url/route.ts`
- Tests: `brief-parser.test.ts`, `asset-resolver.test.ts`, `bird/__tests__/provider.test.ts`.
- Types/CRUD: `lib/d2c/types.ts`, `lib/db/d2c.ts`.

## Validation

- [x] `npx next build` — passes (`/d2c/brief-ingest`, `/d2c/event/[id]` compiled).
- [x] `npm run lint` — 0 errors in new files (repo has pre-existing errors elsewhere).
- [x] new tests — 13/13 pass. Full `npm test` retains exactly the 8 pre-existing
      failures (all `@/`-alias / jest-based tests that never ran under `node:test`).

## Three-gate dry-run invariant

Every live send requires ALL of: `FEATURE_D2C_LIVE` (global) **AND**
`connection.live_enabled` **AND** `connection.approved_by_matas`. Enforced in
`shouldD2CDryRun()` shared by Mailchimp + Bird. The cron additionally rejects any
row that comes back `dryRun:true` while expecting a live send.

## Flip procedure per client (manual, post-deploy)

1. Set `FEATURE_D2C_LIVE=true` in Vercel prod (global) — **NOT** done in this PR.
2. Per connection: set `live_enabled=true` and `approved_by_matas=true`.
3. Per send: operator approves (`approval_status=approved`) on the event page.
4. Add the operator's `auth.users.id` to `MATAS_USER_IDS` in
   `lib/auth/operator-allowlist.ts` (currently empty → approvals disabled).

## Deviations from the prompt (also in PR "Cross-thread asks")

- Migrations renumbered 042/043 → **124/125** (042 already exists; next free = 124).
- Mailchimp provider work skipped — already shipped.
- Runner extends `d2c-send` (per maintainer decision) instead of a new
  `d2c-orchestrate` cron; `vercel.json` unchanged.

## Notes / follow-ups

- `lib/db/database.types.ts` NOT regenerated (needs prod project ref); new tables
  use the existing loose-client pattern in `lib/db/d2c.ts`.
- Real `/3.0/ping` and Bird `GET /channels` 200s require live credentials
  (post-deploy); provider tests assert the endpoints + 200 handling via mocked fetch.
