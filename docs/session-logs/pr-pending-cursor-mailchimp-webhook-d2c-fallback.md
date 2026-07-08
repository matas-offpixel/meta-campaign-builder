# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-webhook-d2c-fallback`

## Summary

Mailchimp is delivering profile-update webhooks correctly for Throwback
(`200` on every hit), but `handleProfileUpdate` (`lib/mailchimp/tag-tracking.ts`)
required `clients.mailchimp_account_id` + a matching `mailchimp_accounts` row
to resolve credentials — Throwback (and every future D2C-only client) has
`mailchimp_account_id = null` because its Mailchimp credentials live in
`d2c_connections` (the D2C onboarding system) instead. The webhook silently
bailed with `no_account_id`, so zero rows ever landed in
`mailchimp_tag_event_log` and the autoresponder never fired. Confirmed live
against prod Supabase before writing any code: Throwback's `clients` row has
`mailchimp_account_id: null`, an active/live/approved `d2c_connections`
`provider=mailchimp` row exists (`external_account_id: "us7"`), the Algarve
event's `mailchimp_tag_event_log` has zero rows, and `d2c_autoresp_fires` has
only the earlier `is_test=true` row from PR #698's test-send route — exactly
matching the bug report.

Added a fallback credential resolver bridging `d2c_connections` into the
`MailchimpCredentials` shape the tag-tracking arc expects, wired it into
`handleProfileUpdate` (tried only after the legacy `mailchimp_account_id`
path yields nothing, so existing legacy clients are unaffected), and applied
the same fallback to the other two layers of the same documented "layered
Mailchimp tag-tracking architecture" (the EOD backstop cron and the
resumable-backfill cron) — leaving one layer fixed and the other two broken
for D2C clients would have been an incomplete fix of the very system this PR
targets.

## Root cause (confirmed against prod DB, not just the bug report)

```
clients.mailchimp_account_id for Throwback           → null
d2c_connections (client=Throwback, provider=mailchimp) → id=901a8bfd-...,
                                                           external_account_id="us7",
                                                           status=active, live_enabled=true,
                                                           approved_by_matas=true
events.mailchimp_tag_event_log for the Algarve event   → 0 rows
d2c_autoresp_fires for the Algarve event                → 1 row, is_test=true only
                                                           (PR #698's test-send route)
```

## Scope / files

- `lib/mailchimp/d2c-credentials-adapter.ts` (new) —
  `getMailchimpCredsFromD2CConnection(supabase, clientId, audienceId?)`.
  Reuses `resolveMailchimpCredentials` (`lib/d2c/mailchimp/credentials.ts` —
  the same resolver the live D2C send path already uses: looks up the
  client's `d2c_connections` `provider='mailchimp'` row, decrypts via
  `getD2CConnectionCredentials`/`D2C_TOKEN_KEY`, and derives `dc` from
  `server_prefix` or falls back to `parseMailchimpApiKey(apiKey)`) rather than
  re-implementing that lookup — one source of truth for "how do we get
  Mailchimp creds for a D2C client." Maps `{ apiKey, serverPrefix }` →
  `{ apiKey, dc, loginId: null, accountName: null }` (the shape
  `MailchimpCredentials` / `getMemberTags` expect). `audienceId` is accepted
  for diagnostic logging only — `d2c_connections` has no per-list scoping and
  its `unique (user_id, client_id, provider)` constraint already guarantees
  at most one Mailchimp connection per client, so `clientId` alone
  disambiguates; no extra live Mailchimp round trip added.
- `lib/mailchimp/tag-tracking.ts` — `handleProfileUpdate` now tries the legacy
  `clients.mailchimp_account_id` path first, then falls back to
  `getMailchimpCredsFromD2CConnection`. Converted its `@/lib/...` imports to
  relative (`./credentials.ts`, `./client.ts`, plus the new adapter) so the
  function is actually importable under the `node --test` runner — it wasn't
  under test before this PR.
  - **Spec correction (necessary, not optional):** `handleProfileUpdate` only
    ever wrote to `mailchimp_tag_event_log` / recomputed the day snapshot —
    it never called the autoresponder fire path at all (that only happened
    on the classic `tag_added` webhook type, in `processTagEvent` /
    `fireAutorespForTagAdd`, in the route file). Fixing credentials alone
    would NOT have made the ask's own verification step 4
    (`d2c_autoresp_fires` gaining an `is_test=false` row) pass. Extended
    `handleProfileUpdate`'s return type with `addedEventIds: string[]` —
    every event that just gained a fresh "added" reconciliation this call —
    and had the webhook route call the existing `fireAutorespForTagAdd`
    helper for those event ids, mirroring the `tag_added` branch exactly.
- `app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts` — profile-update
  branch now fires autoresp for `result.addedEventIds` (see above) and
  includes the `autoresp` counter in the JSON response, same shape as the
  `tag_added` branch.
- `app/api/cron/mailchimp-eod-snapshot/route.ts` — same
  `mailchimp_account_id` → `d2c_connections` fallback (was silently
  `action: "skip", reason: "no_account"` for D2C-only clients; the whole
  point of this cron is to be the backstop when the webhook misses an event,
  so leaving it broken for D2C clients would undermine this PR's fix).
- `app/api/cron/mailchimp-backfill-tick/route.ts` — same fallback (was
  throwing `"event client has no mailchimp_account_id"` and marking the job
  `failed`).
- Tests (all new):
  - `lib/mailchimp/__tests__/d2c-credentials-adapter.test.ts` — 4 cases:
    happy path (`server_prefix` present), `parseMailchimpApiKey` fallback
    (`server_prefix` missing), no matching connection → `null`, missing
    `clientId` → `null` with no DB round trip. Isolates
    `JACKIES_MAILCHIMP_API_KEY` (the resolver's local-dev-only env fallback)
    so a real dev key sitting in the shell can never leak into a "no
    connection" assertion.
  - `lib/mailchimp/__tests__/tag-tracking-d2c-fallback.test.ts` — 3 cases
    against a purpose-built in-memory Supabase fake covering the exact query
    chains `handleProfileUpdate` + `recomputeDaySnapshot` use: falls back to
    D2C creds and reconciles a fresh add (asserts `addedEventIds`, the log
    row, and the recomputed snapshot); returns `no_credentials` and never
    calls the Mailchimp API when neither path resolves; legacy
    `mailchimp_account_id` clients still resolve via the old path and never
    touch the D2C fallback (regression guard).

## Also investigated (per the ask) — no fix needed

- `lib/d2c/autoresp/fire.ts` (`resolveAutorespContext` /
  `fireAutorespToMember`, the real webhook/poll/backfill fire path) resolves
  credentials exclusively via `send.connection_id` →
  `getD2CConnectionById`/`getD2CConnectionCredentials` — it is **already**
  entirely `d2c_connections`-based with no client-level `mailchimp_account_id`
  assumption. Confirmed no gap here.

## Flagged, not fixed (out of scope — separate subsystem)

`lib/mailchimp/sync.ts`'s three functions (`syncMailchimpAudienceForEvent`,
`syncMailchimpAudienceDailyHistory`, `syncMailchimpTagForEvent`) — which feed
the `rollup-sync-events` / `sync-mailchimp-audiences` crons and the manual
"refresh" button on the event page — have the exact same
`mailchimp_account_id`-only gap and will also silently skip D2C-only clients.
This is a distinct, larger-scoped subsystem (3 functions, 2 crons, a manual
refresh endpoint, its own dedicated audit) from the tag-tracking
webhook+EOD+backfill architecture this PR fixes; bundling it here would blow
the PR's scope. Same treatment for `lib/mailchimp/diagnose.ts` (diagnostic
tool only), `app/api/admin/mailchimp-overlap/route.ts`, and
`app/api/integrations/mailchimp/audiences/route.ts` (manual admin tools) —
all share the gap, none are in the live webhook/cron hot path. Tracking as a
follow-up.

## Validation

- [x] `npx tsc --noEmit` — no new errors (all pre-existing, unrelated to any
      touched file).
- [x] `npm run build` — succeeds.
- [x] `npm test` — 2983/2998 pass (net +7 new tests from this PR). The 14
      failures are pre-existing on a clean `main` checkout (asset-queue,
      dashboard trend/tickets-window module-resolution issues,
      `creative-buy-tickets-cta` — all unrelated to Mailchimp/D2C).
- [x] `npx eslint` on every touched file — zero errors/warnings.
- [x] Root cause confirmed against **live production Supabase** (not just
      the bug report) before writing the fix — see above.

## Notes

Live end-to-end verification (real Evntree LP signup → webhook 200 →
`mailchimp_tag_event_log` row → `d2c_autoresp_fires` `is_test=false` row →
email arrival with the branded chassis) needs a real signup on the
third-party-hosted Evntree page and an email inbox check — outside what I can
drive from here (no Evntree LP URL, and `MAILCHIMP_WEBHOOK_SECRET` isn't in
local env, so I can't sign a synthetic webhook POST against prod either).
Flagging for the user to run the 5-step check from the ask before/after
merge; happy to merge now on green tests + the DB-confirmed root cause, or
wait for the live check first — user's call.
