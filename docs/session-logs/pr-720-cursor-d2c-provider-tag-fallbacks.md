# Session log — D2C provider gaps blocking bulk-to-tag reminder sends

## PR

- **Number:** #720
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/720
- **Branch:** `cursor/d2c-provider-tag-fallbacks`

## Summary

Live-verified 2026-07-14: the T26-ALGARVE WA DM reminder failed with "Bird
sends require audience.recipients[] or audience.list_id" because tag-scoped
`d2c_scheduled_sends` rows only ever persist `audience.tag`, never
`audience.list_id`. Fixed `lib/d2c/bird/provider.ts` to resolve `list_id` from
`audience.tag` at send time via `findGroupByName` (PR #715's Bird groups
client), and surfaced the resolved id as `SendResult.details.resolvedAudiencePatch`
so the cron route (the only caller with a DB handle) can cache it back onto
the row's `audience` for audit + retry idempotence — extended
`updateScheduledSendStatus` (`lib/db/d2c.ts`) with an `audiencePatch` merge
and wired it into `app/api/cron/d2c-send/route.ts`'s success path.

The second reported bug (Mailchimp needing `audience.segment_opts` for
tag-scoped sends) was investigated against the live T26-ALGARVE rows and the
existing codebase **before writing any code** and does not reproduce:
`sendMailchimpCampaignLive`'s `resolveSegmentOpts` (added in PR #696) already
resolves `audience.tag` → `segment_opts` at send time, and already has byte-diff
test coverage (`provider-segment-opts.test.ts`) for the plural `tags[]` shape.
The live T26-ALGARVE "announce" email's `result_jsonb` confirms a correctly
tag-scoped send (`segment_text: "Tags contact is tagged T26-ALGARVE"`), not a
whole-audience blast. Added a new test using the exact singular-`tag`
production shape (`singular-tag-segment-opts.test.ts`) to close that specific
coverage gap and guard against regression, without duplicating the resolver.

## Scope / files

- `lib/d2c/bird/provider.ts` — `resolveBirdListId()` (tag→list_id via
  `findGroupByName`), wired into `send()`; resolved id surfaced in
  `SendResult.details.resolvedAudiencePatch`
- `lib/d2c/bird/__tests__/provider.test.ts` — 8 new tests for the resolver +
  the live-send tag-only path (success, no-match error, list_id-wins-over-tag)
- `lib/d2c/mailchimp/__tests__/singular-tag-segment-opts.test.ts` — new test,
  production-shape singular `audience.tag` → correctly scoped `segment_opts`
  (confirms Bug 2 does not reproduce)
- `lib/db/d2c.ts` — `updateScheduledSendStatus` gains an `audiencePatch`
  merge-patch option
- `app/api/cron/d2c-send/route.ts` — reads `resolvedAudiencePatch` off a
  successful provider result and passes it through as `audiencePatch`

## Validation

- [x] `npx tsc --noEmit` — 368 pre-existing errors, unchanged; 0 in touched files
- [x] `npm test` — 3106 tests, 3089 pass, 14 fail (identical 14 pre-existing
  failures on unmodified `main` — confirmed via `git stash` A/B); +7 new tests,
  all passing
- [x] `eslint` on changed files — 0 errors/warnings
- [x] Pre-code DB check: queried the live T26-ALGARVE event's
  `d2c_scheduled_sends` rows before writing any code (see Notes)

## Notes

- **Pre-code DB check (critical to this PR's scope):** queried
  `d2c_scheduled_sends` for event `8194ab57-cc31-4fae-9c6f-403eb2540b42`
  (T26-ALGARVE) directly against Supabase before touching any code. Confirmed:
  - The failed WA DM reminder (`8ac8f361-...`) has `audience: { tag:
    "T26-ALGARVE", channel_id, ... }` — no `list_id`, no `recipients` — and
    `result_jsonb.error` byte-matches the reported error string exactly.
  - The "announce" email (`f6e07851-...`, `status: "cancelled"`) already has a
    Mailchimp `result_jsonb` showing a correctly tag-scoped
    `segment_text: "Tags contact is tagged T26-ALGARVE"` — hard evidence Bug 2
    does not reproduce on current `main`.
- **Scope judgment call:** the brief asked for the list_id cache-back to live
  "in provider.ts... at send time." `BirdProvider.send()` has no DB handle
  (matches every other provider — `D2CProvider.send(connection, message)` — a
  deliberate, testable separation so provider files run under plain
  `node --test`). Rather than threading a supabase client through the shared
  `D2CProvider` interface (4 providers, 3+ call sites), the resolution stays
  a pure network call in `provider.ts` and the actual DB write-back happens in
  the cron route via a small, additive `audiencePatch` option on the existing
  `updateScheduledSendStatus` write — same shape of tradeoff as
  `resolveEventArtwork`'s write-back living in the resolver, not the provider.
  Flagging this explicitly since it's a design choice, not the literal
  file-list in the brief.
- **Mailchimp: no code changed in `lib/d2c/mailchimp/provider.ts`.** Bug 2 as
  described does not reproduce against current `main` — implementing the
  requested `/tag-search`-based fix would have created a second, divergent
  tag→segment-id resolution path alongside the existing
  `resolveSegmentOpts`/`getAudienceTags` one (added PR #696, hardened PR #699).
  Added test coverage for the exact production shape instead of duplicate
  logic. Flagged loudly here and in the PR body rather than silently skipping
  the ask.
- **Live-verify step (post-merge):** reset the T26-ALGARVE WA DM reminder
  (`8ac8f361-ac9c-44e6-9669-8457bea391b6`) to `status = 'scheduled'` and
  confirm the next `d2c-send` cron run resolves `T26-ALGARVE` → a Bird group id
  and fires successfully.
