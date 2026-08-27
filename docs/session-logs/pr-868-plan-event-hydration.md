# Session log — plan event hydration

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/plan-event-hydration`

## Summary

Selecting an event now resolves the client's identity stack through the
existing M.1 resolver (`resolveChannelDefaults` + `apply*ChannelDefaults`)
and shows it as a chip row. Bare Meta ad-account ids (Ironworks =
`1967530076312`) are normalised with `normalizeAdAccountId` so preflight
no longer rejects a fully-configured client for `act_`.

## Normalisation helper

- **Used:** `normalizeAdAccountId` in `lib/meta/ad-account.ts`
- **Not used:** `withActPrefix` (`lib/meta/ad-account-id.ts`) — no digit
  validation; the 565 `act_act_` pin lives there for IG URLs
- **Not used:** `normalizeMetaAdAccountId` in the thumbnail allowlist
  (strip-only)

Call sites on the plan/defaults path now go through that helper inside
`pickNormalisedAdAccount` + `applyMetaChannelDefaults`. Invalid bodies
stay unset; never `act_act_`.

## Other surfaces that read the bare stored value

`clients.meta_ad_account_id` is stored **bare** (migration 009). Surfaces
that already prefixed before Graph / Ads Manager (silently working):

- `withActPrefix`: insights, audiences, creative-insights, saved-audience,
  ad-account-benchmarks, IG actor validator (PR #565), several `/api/meta`
  debug/probe routes
- `normalizeAdAccountId`: campaigns, custom-audiences, customer-audience
  upload, saved-audience list, bulk-attach Ads Manager URL, plan Ads
  Manager links, client rollout view

Surfaces that still copy raw (out of scope):

- `components/wizard/wizard-shell.tsx` client hydrate (same bug class)
- `client-detail.tsx` display-only Ad Account ID row

## Before / after Meta blockers (Ironworks fixture)

Bare id `1967530076312`, page / pixel / IG / TikTok / Google filled.

**Parent (`5c0c883`) Meta blockers:**

- `Ad account ID must start with "act_"`
- `IW event: at least one caption is required`
- `IW event: at least one asset must be uploaded`

**After:**

- `IW event: at least one caption is required`
- `IW event: at least one asset must be uploaded`
- Google keyword blockers (unchanged — not identity)

## Scope / files

- `lib/clients/channel-defaults.ts` — pixel on the resolved stack; `act_`
  normalisation; ad-account cure href
- `lib/plan/preflight.ts` + `/api/plan/preflight` — return the same
  `resolved` Prepare applies
- `lib/plan/identity-chips.ts` + `components/plan/plan-identity-chips.tsx`
- `components/plan/plan-workspace.tsx` — chip row under the event picker

## Validation

- [x] `npx eslint` on touched files — clean
- [x] `npx tsc --noEmit` — no errors in touched files (repo-wide jest/`.next` noise unchanged)
- [x] `npm run build` — compiled successfully
- [x] `npm test` — 4680 tests, 1187 suites; 4677 pass, 0 fail, 3 skipped
- [x] Falsified against parent sha `5c0c883`: Ironworks bare `1967530076312` applied as-is and Meta preflight returned `Ad account ID must start with "act_"`

## Notes

- No schema change. Migration 160 still unapplied; IG / TikTok identity
  defaults stay unset when those columns are absent.
- Killswitches and launch orchestrator untouched.
- Overrides still beat defaults.
