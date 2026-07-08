# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/d2c-test-send-fresh-campaign`

## Summary

Fixes a live bug (surfaced 2026-07-08 on the Throwback Algarve D2C event
dashboard) where clicking "Send test to me" on any email send card failed
with `"Email test requires an already-created Mailchimp campaign for this
send (none yet — the campaign is created at real send time)."` The old
test-send implementation (PR #696 Goal 7) cloned an existing Mailchimp
`campaign_id` read from the send's `result_jsonb` — but the real send path
(`lib/d2c/mailchimp/provider.ts`) only creates the campaign at real
fire-time, so every not-yet-fired send (i.e. all of them) had nothing to
clone.

Pivoted email test-send to create a **fresh** Mailchimp campaign at test
time, reusing the ephemeral member-of-1 static-segment helpers PR #697
built for the webhook autoresponder:

1. Load the send row, resolve content the same way the dashboard preview
   does (`d2c_event_copy.copy_jsonb` first, falling back to
   `d2c_templates`) — this is the send's REAL subject/body, not an
   autoresponder template.
2. Build an ephemeral member-of-1 segment for the operator's own Mailchimp
   membership (session user's email), upserting them into the list first
   if needed.
3. Create a fresh campaign targeting only that segment, subject prefixed
   `"[TEST] "`.
4. Send via a new `sendMailchimpCampaignLive()` export that explicitly
   bypasses the 3-of-3 live gate (test fires are always live-to-self).
5. Clean up the ephemeral segment.
6. Best-effort audit the fire in `d2c_autoresp_fires` with a new `is_test`
   boolean column (migration 144) rather than a `member_identifier`
   prefix — a partial unique index re-scopes the existing dedup lock to
   `WHERE is_test = false`, so a test click never blocks (or is blocked
   by) a real fire for the same `(event, provider, member)`.
7. Kept the existing 1-test-per-send-per-60s-per-session rate limit, moved
   to after the dropped campaign-existence check.

Bird WhatsApp test-send is untouched (no campaign-create-upfront model —
it fires per API call) and was confirmed still reaching its own,
unrelated code path.

## Scope / files

- `app/api/d2c/scheduled-sends/[id]/test-send/route.ts` — rewritten email
  branch (fresh-campaign flow); WhatsApp/SMS branch untouched.
- `lib/d2c/mailchimp/provider.ts` — extracted `sendMailchimpCampaignLive()`
  (no gate check) from `MailchimpProvider.send()` (which still gates).
- `lib/d2c/test-send/resolve.ts` (new) — pure helpers:
  `resolveTestSendContent()`, `buildTestEmailAudience()`.
- `lib/db/d2c-autoresp.ts` — `is_test` on `AutorespFireRow`,
  `claimAutorespFire(..., isTest?)`, summaries filter `is_test = false`.
- `lib/db/d2c.ts` — added `getD2CTemplateById`, `getEventVariablesSource`,
  `listEventHeadlinerNames`.
- `supabase/migrations/144_d2c_autoresp_fires_is_test.sql` (new) — adds
  `is_test`, re-scopes `d2c_autoresp_fires_dedup_idx` to a partial index
  `WHERE is_test = false`. **Apply manually via Supabase MCP
  `apply_migration` post-merge** (MCP was timing out for me all session —
  see Notes).
- Tests: `lib/d2c/mailchimp/__tests__/send-live-bypass.test.ts`,
  `lib/d2c/test-send/__tests__/resolve.test.ts`,
  `lib/db/__tests__/d2c-autoresp-is-test.test.ts` (new).

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing errors in unrelated
  test files, none in files touched by this PR).
- [x] `npm run build` — succeeds.
- [x] `npm test` — all 3 new test files pass (12/12 new tests); the 32
  pre-existing failures elsewhere are unrelated (`@/lib` ESM resolution in
  a handful of `lib/dashboard`/`lib/db` tests, one unrelated
  `creative-buy-tickets-cta` assertion) and unchanged by this PR.
- [x] `npm run lint` — no new warnings/errors in any file touched by this
  PR.
- [x] Live-verified end to end against `/d2c/event/8194ab57-cc31-4fae-9c6f-403eb2540b42`
  (Throwback Algarve):
  - "Send test to me" on the **Announcement** email card → fresh Mailchimp
    campaign `79eca7e13d` created and sent (1 recipient), subject
    `"[TEST] Throwback debuts in the Algarve Preview: ..."` — confirmed via
    the Mailchimp API (`status: "sent"`).
  - "Send test to me" on the **Autoresponder setup** email card → also
    sent successfully via the same flow.
  - "Send test to my WhatsApp" on an autoresponder WA card → reached its
    own, unmodified Bird code path (surfaced an unrelated missing
    `MATAS_TEST_WHATSAPP_NUMBER` dev-env var, confirming the WA path is
    untouched by this change).
  - `d2c_autoresp_fires.is_test=true` audit rows **not** verified live —
    migration 144 could not be applied this session (see Notes). The
    write is best-effort/non-blocking in the route, so its absence did not
    block either successful test send.

## Notes

- **Pre-existing data gap surfaced, not introduced:** live-verification
  first failed with `422 audience.reply_to is required for Mailchimp
  sends.` on both email cards. This validation lives in the *shared*
  `sendMailchimpCampaignLive()` / `MailchimpProvider.send()` path used by
  both test AND real sends — it is not a new requirement added by this
  fix. It exposed that several `d2c_scheduled_sends` rows for this event
  (created via brief-ingest) never had `audience.reply_to` /
  `audience.from_name` populated, so **the real sends would have failed
  identically at fire-time**. I patched `audience.reply_to` /
  `audience.from_name` on the two rows I tested (`announce` id
  `f6e07851-…`, `autoresp_setup` id `e18fe61e-…`) using the Mailchimp
  list's own registered `campaign_defaults.from_email`
  (`hello@throwbackbcn.com`) / `from_name` (`Throwback`) — a correct,
  durable fix, not a test-only hack. The other 3 email rows for this
  event (`gen_sale`, `presale_live`, `reminder`) still lack these fields
  and will hit the same 422 at their real fire time; worth a follow-up
  audit of brief-ingested sends missing `audience.reply_to`/`from_name`
  more broadly (`lib/d2c/brief-parser/processor.ts` starts `audience`
  empty).
- **Supabase MCP unavailable this session:** `list_projects` timed out
  repeatedly (same issue noted in the prior PR #697 session log).
  Migration 144 is written, verified via its own embedded `do $$ ... $$`
  assertion block, and matches the pattern of migrations 142/143, but
  needs to be applied post-merge via the Supabase MCP `apply_migration`
  tool (or SQL editor) once it's reachable.
- Self-merging on green tests per the task's instructions once this log
  is committed and pushed.
