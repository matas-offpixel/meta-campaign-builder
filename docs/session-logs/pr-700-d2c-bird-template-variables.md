# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/d2c-bird-template-variables`

## Summary

PR #699 fixed the template-detection downgrade (Bug B) — Bird's WhatsApp
sends now correctly take the approved-template path — but every live send
then 422'd with "missing value for variable" for all of `event_name`,
`event_date`, `presale_day`, `presale_time`, `event_artwork_url`, and
`wa_community_invite`. `d2c_scheduled_sends.variables` never carried those
key names (only `locale`, `artwork_url`, `artwork_source`,
`artwork_gdrive_id`, and the `bird_template_*` identity fields), and
`BirdProvider.send` spreads `message.variables` key-by-key into Bird's flat
`parameters` array with no name mapping.

Added a pure resolver, `resolveBirdTemplateVariables`, that derives every
Bird-template-declared variable fresh from the `events` + `d2c_event_copy`
rows at fire time, and wired it into both live call sites (the real
webhook/poll autoresponder path and the dashboard's WhatsApp test-send
route), merged in **last** so it always wins over whatever (possibly stale
or partial) values already sat in `d2c_scheduled_sends.variables`.

## Scope / files

- `lib/d2c/bird/template-variables.ts` (new) — `resolveBirdTemplateVariables`
  + exported pure helpers `formatEventDate`, `formatPresaleDay`,
  `formatPresaleTime`, `extractEventUrlSuffix`. Reuses
  `extractWhatsappInviteCode` from `./hydrate-variables.ts` rather than
  re-deriving it (see spec-correction note below).
- `lib/d2c/autoresp/fire.ts` — `resolveAutorespContext` now merges the
  resolver's output into `variables` as the last step (after the
  `send.variables` overlay), so it feeds both the real WhatsApp fire path
  and (harmlessly, extra unused keys) the email path.
- `app/api/d2c/scheduled-sends/[id]/test-send/route.ts` — WhatsApp branch now
  fetches the event row via `getEventVariablesSource` (already used by the
  email branch) and merges the resolver's output into `waVariables` the same
  way, last.
- Tests:
  - `lib/d2c/bird/__tests__/template-variables.test.ts` (new, 15 cases) —
    unit tests for the date/time formatters (including the ordinal-suffix
    edge cases: 1st/2nd/3rd/11th–13th/21st/31st), `extractEventUrlSuffix`,
    and `resolveBirdTemplateVariables` against the exact Throwback Algarve
    fixture from the bug report (`event_start_at` → "Saturday 8th August",
    `presale_at` → "Wednesday 15th July" / "12:00").
  - `lib/d2c/bird/__tests__/provider.integration.test.ts` — added a byte-diff
    test that resolves variables from a fixture event/copy row, merges them
    over a simulated stale `send.variables` blob (including a deliberately
    wrong cached `event_date`), sends through the real `BirdProvider`, and
    asserts the captured `template.parameters` array is byte-exact per key
    — proving both the correct values reach Bird's wire shape AND that the
    resolver wins over stale send-row data.

## Spec correction (variable union + `wa_community_invite` semantics)

The ask specified 6 variables — exactly what `throwback_autoresp` needs,
matching the live 422. Enumerating all 3 registered templates
(`lib/d2c/bird/templates/definitions/throwback.ts` + `jackies.ts`, both
brands share the same variable names):

| Template | Variables |
|---|---|
| `*_autoresp` | `event_name`, `event_date`, `presale_day`, `presale_time`, `event_artwork_url` (header), `wa_community_invite` (button url) |
| `*_presale_reminder` | `event_name`, `presale_time`, `event_artwork_url` (header), `wa_community_invite` (button url) |
| `*_presale_live` | `event_name`, `event_url_suffix` (button url), `event_artwork_url` (header) |

`*_presale_live`'s button URL is `https://ra.co/events/{{event_url_suffix}}`
— not covered by the 6-variable set. Added `event_url_suffix` (the last path
segment of `event.ticket_url`) to the resolver so the union covers every
registered template, not just the one that surfaced the bug report.

Also corrected: the ask's pseudocode passed
`copy.whatsapp_community_url ?? ""` straight through as
`wa_community_invite`. Every template's button URL is
`https://app.offpixel.co.uk/j/{{wa_community_invite}}` — that variable is
the **invite code** (e.g. `BEkbaKi9HUS3Tjl1ULBbe1`), not the full
`chat.whatsapp.com/...` URL; passing the full URL would double the domain in
the rendered link. Reused `extractWhatsappInviteCode` (already written +
tested in `hydrate-variables.ts` for this exact purpose).

## Flagged, not fixed (out of scope)

`lib/d2c/bird/hydrate-variables.ts` already implements an equivalent
resolver (`hydrateSendVariables`, same variable set minus `event_url_suffix`)
with different semantics (loud-fails via `MissingTemplateVariablesError` on
any missing value; existing `sendRow.variables` wins over derived, the
opposite precedence from this PR's resolver). It was written for
`lib/d2c/orchestration/bird-runner.ts`'s `executeBirdJob` — a still-blocked
path that throws `BIRD_RUNTIME_UNVERIFIED` unconditionally before that point
is ever reached, so `hydrateSendVariables` has never actually run against a
live send. Left it untouched (not one of this PR's two call sites, and
touching the orchestration stub is a separate scope) but flagging the
duplication for a follow-up consolidation pass once/if that orchestration
path is unblocked.

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing unrelated errors only,
      same 432-line baseline as a clean `main` checkout).
- [x] `npm run build` — succeeds.
- [x] `npm test` — 2976/2991 pass (net +16 from this PR's new tests: 15 in
      `template-variables.test.ts` + 1 in `provider.integration.test.ts`).
      The 14 failures are pre-existing on a clean `main` checkout
      (`venue-trend-points`/`canonical-tickets-window` module-resolution
      issues, `creative-buy-tickets-cta` — all unrelated to D2C/Bird).
      Verified via `git stash` before committing.
- [x] `npx eslint` on every touched file — zero errors/warnings.

## Notes

Self-merging on green tests per the ask, pending the live WA test-send
verification below (will run before merge):

1. Refresh `/d2c/event/8194ab57-cc31-4fae-9c6f-403eb2540b42`.
2. "Send test to my WhatsApp" on the autoresp WA card → should arrive at
   `+447780672270` as an approved template with all 6 body/header/button
   variables filled in (event name, dates, artwork, community URL).
3. Same check on the `presale_reminder` and `presale_live` WA DM cards.
