# Session log

## PR

- **Number:** 702
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/702
- **Branch:** `cursor/mailchimp-webhook-subscribe-fallback`

## Summary

After PR #701 fixed credential resolution, Mailchimp webhooks were hitting
`/api/webhooks/mailchimp/{clientId}/{audienceId}` with `200`s (verified live
against prod Vercel logs), but `mailchimp_tag_event_log` still had zero rows
for Throwback's Algarve event. Root cause: the route's classic-webhook
branching only routed `profile` / `upemail` / `cleaned` through the tag
re-fetch-and-diff fallback (`handleProfileUpdate`); `tag_added` / `tag_removed`
went through their own direct path. Mailchimp fires `subscribe` — never
`tag_added` — when a member is created with a tag already applied via the API,
which is exactly what happens when Evntree pushes a fresh signup with the
event's tag pre-set. That `subscribe` type fell into the route's catch-all
`{ ok: true, ignored: true, reason: "type=subscribe" }` branch: no log write,
no autoresponder fire. Same gap for `unsubscribe`.

Verified against Mailchimp's own webhook payload docs that `subscribe` and
`unsubscribe` carry the member email under `data[email]` — the same key the
existing profile-update fallback already reads (via
`data[new_email]` → `data[email]` precedence) — not under
`data[merges][EMAIL]`, so no spec correction was needed there.

Extended the profile-update fallback condition to also cover `subscribe` and
`unsubscribe`. `handleProfileUpdate`'s tag-diff already produces the correct
outcome either way with no further changes needed: a `subscribe` where the
tag is already applied diffs to `"added"` (logs the row + fires the
autoresponder via PR #701's `addedEventIds` wiring); an `unsubscribe` diffs to
`"removed"` (logs the row, never fires — the autoresp path only triggers on
`addedEventIds`).

## Scope / files

- `app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts` — the
  profile-update-fallback branch condition now includes `type === "subscribe"`
  and `type === "unsubscribe"`. Extracted the branch's decision + response-
  building logic into `lib/mailchimp/profile-fallback.ts` (see below) so it's
  unit-testable — the route itself imports `next/server` and
  `@/`-aliased Supabase clients, neither of which resolve under this repo's
  `node --experimental-strip-types` test runner (no tsconfig path-alias
  support; confirmed by experiment — even `mock.module("@/x", …)` can't
  intercept an unresolvable alias specifier). Updated the file's top-of-file
  JSDoc to describe the widened event-type coverage.
- `lib/mailchimp/profile-fallback.ts` (new) — pure, dependency-injected
  helpers extracted from the route:
  - `isProfileFallbackEventType(type)` — the `subscribe`/`unsubscribe`/
    `profile`/`upemail`/`cleaned` membership check.
  - `extractProfileFallbackEmail(get)` — the `data[new_email]` →
    `data[email]` precedence, parameterized over a `get(key)` accessor so it
    doesn't need a real `URLSearchParams`.
  - `runProfileFallback(supabase, clientId, audienceId, email, deps)` — calls
    `deps.handleProfileUpdate`, then `deps.fireAutorespForTagAdd` for any
    `addedEventIds`, and builds the exact `{ mode: "profile_update", ...
    }` response shape the route returns. Generic over the Supabase client
    type so real callers (typed `SupabaseClient<...>`) satisfy the injected
    function types without an `unknown`-parameter contravariance error.
- `lib/mailchimp/__tests__/profile-fallback.test.ts` (new) — 10 cases:
  - `isProfileFallbackEventType`: `subscribe`/`unsubscribe` → true (the fix),
    the original `profile`/`upemail`/`cleaned` set → true, `tag_added`/
    `tag_removed`/`campaign`/`null` → false.
  - `extractProfileFallbackEmail`: `new_email` precedence, `email`-only
    fallback (the actual `subscribe`/`unsubscribe` shape), empty when
    neither key present.
  - `runProfileFallback`: subscribe-shaped case asserts `handleProfileUpdate`
    is called with the exact `(supabase, clientId, audienceId, email)`
    arguments and the autoresponder fires for a fresh add, byte-diffing the
    full response object; unsubscribe-shaped case asserts
    `handleProfileUpdate` is called but the autoresponder is never invoked on
    a tag removal (`addedEventIds: []`); a `no_credentials` failure case
    propagates without firing the autoresponder.

## Validation

- [x] `npx tsc --noEmit` — 439 errors before and after (identical count on a
      clean `main` checkout via `git stash`); zero attributable to any
      touched file. (One generic-typing fix was needed mid-session: the
      injected `handleProfileUpdate`/`fireAutorespForTagAdd` deps are typed
      `SupabaseClient<...>`, not `unknown`, so `ProfileFallbackDeps` had to be
      generic over the Supabase client type rather than fixed to `unknown` —
      caught by this exact check.)
- [x] `npm run build` — succeeds.
- [x] `npm test` — 2992/3007 pass overall (net +12 new tests from this PR).
      The 14 failures are pre-existing on a clean `main` checkout (asset-queue,
      dashboard trend/tickets-window module-resolution issues,
      `creative-buy-tickets-cta` — all unrelated to Mailchimp/D2C). Ran the
      full `lib/mailchimp/**/__tests__/*.test.ts` suite in isolation too:
      78/78 pass.
- [x] `npx eslint` on every touched file — zero errors/warnings.

## Notes

Live end-to-end verification (real signup on the Evntree LP → webhook `200`
→ `mailchimp_tag_event_log` row → `d2c_autoresp_fires` `is_test=false` row →
email + WhatsApp autoresp arrival) needs a real signup on the third-party-
hosted Evntree page and inbox/phone checks — outside what's drivable from
here. Per the ask, self-merging on green tests; the user will live-verify
after deploy.
