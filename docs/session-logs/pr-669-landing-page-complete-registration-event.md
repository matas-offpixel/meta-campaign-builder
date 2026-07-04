# Session log — landing-page: swap Lead → CompleteRegistration on signup

## PR

- **Number:** 669
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/669
- **Branch:** `landing-page/complete-registration-event`

## Summary

Mechanical rename of the landing-page signup event from Meta's `Lead` to
`CompleteRegistration` (Matas's request post-PR-#668): Meta's standard
event for account/newsletter signups, pairing naturally with `Purchase`
in the event-marketing conversion funnel (signup → presale link → ticket
buy). Renamed the client-side pixel command builder, the server-side CAPI
event name + helper function, the shared event-id suffix (`-lead` →
`-cr`), and every test fixture/assertion that hardcoded the old name.
`sendCapiEvent`'s log lines now derive the event name from the payload
rather than hardcoding it, so future conversion events (`Purchase`,
`AddToCart`) need no edit there. PageView is untouched. Dedup semantics
(repeat signups skip both event legs) are untouched.

## Scope / files

- `lib/landing-pages/pixel-events.ts` — `leadEventId` →
  `completeRegistrationEventId` (suffix `-lead` → `-cr`); `buildLeadCommand`
  → `buildCompleteRegistrationCommand`, fbq event name `Lead` →
  `CompleteRegistration`
- `lib/landing-pages/meta-capi.ts` — `event_name: "Lead"` →
  `"CompleteRegistration"`; `sendCapiEvent` log lines now read the event
  name from the payload instead of hardcoding "Lead"
- `lib/landing-pages/capi-fire.ts` — `fireLeadCapi` →
  `fireCompleteRegistrationCapi`
- `lib/landing-pages/signup-handler.ts` — pipeline comment + fallback
  event-id suffix (`{signupId}-lead` → `{signupId}-cr`)
- `lib/landing-pages/types.ts` — comment only
- `components/landing-pages/signup-form-block.tsx` — call site updated to
  the renamed helpers
- `app/api/l/[clientSlug]/[eventSlug]/signup/route.ts` — CAPI invocation
  updated to the renamed helper
- Tests: `pixel-events.test.ts`, `meta-capi.test.ts`,
  `capi-isolation.test.ts` — every hardcoded `"Lead"` / `-lead` fixture
  and assertion updated; isolation byte-diff test logic unchanged
  (structure, not content)
- `docs/LANDING_PAGE_ARCHITECTURE.md` — §12 event table + rationale
  (CompleteRegistration → Purchase funnel pairing), PR-3 runbook, PR
  sequence table row, new landmine 17 (exact Meta names for future
  conversion events; MVP fires exactly one signup event)

## Validation

- [x] `npx tsc --noEmit` — 364 pre-existing errors repo-wide (identical
      baseline to PR #668), zero new errors in touched files
- [x] `npm run build` — passes
- [x] landing-page suite: 136/136 pass (unchanged count — pure rename,
      no new/removed test cases)
- [x] `npm run lint` — 25 pre-existing errors elsewhere, zero in touched
      files (identical to PR #668 baseline)

## Notes

- `meta-pixel.tsx` (PageView loader) required no changes — it never
  referenced Lead.
- The event-id suffix change (`-lead` → `-cr`) is internal and
  non-breaking: the suffix is computed at call time from the
  sessionStorage-persisted base uuid, never itself persisted, so no
  migration or backward-compat shim is needed.
- `FireCapi` / `FireCapiArgs` type names in `capi-fire.ts` were left as
  generic names (not event-specific) — no rename needed there.
