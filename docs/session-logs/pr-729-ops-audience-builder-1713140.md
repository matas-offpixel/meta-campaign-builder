# Session log — Audience seed permissions: diagnose 1713140, then fix, salvage, explain

## PR

- **Number:** 729
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/729
- **Branch:** `cursor/ops/audience-builder-1713140`

## Summary

Meta subcode 1713140 ("Audience creation permission is missing for one or more
event sources") has been failing page-based custom audience creates, most recently
two Electric Brixton audiences on 2026-07-27. This PR establishes what the error
actually means by live experiment, then makes the write path act on it: grant the
operator ADVERTISE on the refused seed and retry, or drop just that seed and keep
the rest, or fail with the real cause. It also puts the failure text on screen —
until now `status_error` was written to every failed audience row and never
rendered.

**The finding: 1713140 means the operator's token holds no page-level role on that
seed page.** Not a business-ownership condition, not a token-scope condition, and
not a missing page "audience" task (PR #727 established no such task exists). Being
in the client's Business Manager is not sufficient, which is precisely why the
existing prefilter let this through.

## What was tested, and how

The four hypotheses in the brief were tested against live Graph v23.0, not docs.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| (a) seed must be owned by / shared into the ad account's business | **false** | The control page that CREATED fine is a client page of a different business than the ad account's. The remediation run granted through Columbo Group (527693220707294) while creating on an Electric Brixton ad account. |
| (b) requires `FULL_CONTROL` rather than `ADVERTISE` | **false** | Granting plain `ADVERTISE` made the identical create succeed. |
| (c) operator token missing an `audience_management` scope | **false** | One token, same run: succeeded on one page, refused on another. A token cannot simultaneously have and lack a scope. |
| (d) something else | **confirmed, and identified** | Per-page authorisation of the operator's user. Absent → refused; granted → succeeds. |

### The decisive run (verbatim, reversible)

```
BEFORE grant -> code=2654 subcode=1713140
   (#2654) No permission for event source: Audience creation permission is missing for one or more event sources (ID: 260956420427418).

GRANT ADVERTISE -> {"success": true}

AFTER grant -> SUCCESS id=120249388714350239 (ADVERTISE is sufficient)

REVERT (revoke page assignment) -> {"success": true}
```

Setup: page 260956420427418 (DJ Heartstring, `bm_pages.user_has_access = false`),
ad account `act_1073273492854557`, grant issued in business 527693220707294 to
business-scoped user 122102828505388478. The created audience was deleted and the
grant revoked in the same run; afterwards the ad account was re-listed to confirm
no `ZZ_PRC*` audience remained.

### Control

Same token, same ad account, same payload, page 506935682808859
(`user_has_access = true`) → created (`120249388695890239`, deleted immediately).
This is the pair that kills (c).

### Population check (Supabase MCP)

Across every page-based audience ever written: of 117 seed slots on audiences that
reached `ready`, **zero** were pages where the operator lacked a role. Every
no-role seed page appears only in failures. Also queried: pages the BM tool has
granted vs pages used as audience seeds — **zero overlap**, which is why the
grant-and-retry behaviour had to be tested live rather than inferred. That query
returning empty is the reason this PR contains a live remediation fixture at all.

### Notes on getting the probe right

- The business-scoped user is named **"Matas Off/Pixel"** while `/me` reports
  "Matas Liebus", so matching `business_users` by name found nothing. Matched on
  email instead. (The plain FB user id is rejected by `assigned_users` — PR #710.)
- `/me/accounts` was rate-limited (`#4`) throughout, so the read-side task
  enumeration was abandoned in favour of the create-side experiment, which is the
  stronger evidence anyway: it tests the actual operation that was failing.
- Meta Ads MCP could not run this: `create_custom_audience` has no subtype
  accepting the app's page-engagement payload (`prefill` + `rule`, no `subtype`),
  and `delete_audience`'s input schema cannot express a delete. Raw Graph calls
  with the app's own operator token (`user_facebook_tokens.provider_token`) were
  used so the payload is byte-identical to production's.

## What shipped

**Diagnosis (dependency-free, so the write path, preflight and tests share one definition)**

- `lib/audiences/event-source-permission.ts` — subcode constants, detector, and
  the parser for the ids Meta names in the message. The detector deliberately does
  NOT match on the bare word "permission"; the parser deliberately accepts only
  numeric ids.
- `lib/audiences/event-source-recovery.ts` — the recovery ladder as pure logic:
  **fix** (grant + retry the full seed set) → **salvage** (drop only the named
  seeds) → **explain** (fail with cause and fix). One attempt per stage.

**Acting on it**

- `lib/audiences/seed-remediation.ts` — grants ADVERTISE through the #727
  validated primitive using the per-BM stored token only (no `META_ACCESS_TOKEN`
  fallback), resolves the business-scoped user, logs an audit event, and never
  throws.
- `lib/meta/audience-write.ts` — wires the ladder in and records what recovery did
  on the audience row. Retries reuse one idempotency key (it caches only on
  success, so a failed attempt re-runs while a landed one cannot double-create).

**Surfacing it**

- `app/(dashboard)/audiences/[clientId]/page.tsx` — renders `statusError` under the
  status badge: destructive on `failed`, muted on `ready` (where it holds a
  non-fatal recovery note).
- `components/audiences/source-picker.tsx` + `app/api/audiences/sources/pages/route.ts`
  + `lib/audiences/page-source-union.ts` — flags seeds the operator verifiably holds
  no role on, before selection. Flagged only on positive evidence (a scanned row
  saying `false`, with no row saying `true`); no row at all is unknown, not bad.
- `lib/db/business-managers.ts` — `getPagesWithoutOperatorRole` and
  `findAudienceSeedLocations`.

### The IG id-space hazard

`findAudienceSeedLocations` matches IG seeds on `bm_ig_accounts.ig_user_id` (what an
audience rule and `object_story_spec.instagram_user_id` carry) and returns
`ig_asset_id` for the grant edge (a different id space). Migration 147 stores both
columns for exactly this reason. A wiring test asserts the two are not confused.

### Why the prefilter's weak rule was documented rather than tightened

`lib/meta/page-access.ts` treats "page is in the BM's owned/client pages" as
access, which is what let this failure through — the page IS in the BM. It is kept
(removing it re-breaks the PR #425 partner-share case, where the per-page probe
cannot see BM-mediated grants) but is now documented as buying a create ATTEMPT,
not a guarantee, with the gap closed downstream by the recovery ladder. Turning it
into a hard block would trade a recoverable failure for a silent false drop, and a
dropped page produces an audience quietly missing a source.

## Scope / files

- `lib/audiences/event-source-permission.ts`, `event-source-recovery.ts`,
  `seed-remediation.ts` (new)
- `lib/audiences/__tests__/event-source-permission.test.ts`,
  `seed-remediation-wiring.test.ts`, `fixtures/*.json` (new)
- `lib/meta/audience-write.ts`, `lib/meta/page-access.ts`
- `lib/db/business-managers.ts`, `lib/audiences/page-source-union.ts`
- `app/api/audiences/sources/pages/route.ts`,
  `app/(dashboard)/audiences/[clientId]/page.tsx`,
  `components/audiences/source-picker.tsx`

No migration: migration 149 (#727) already stores the evidence this PR reads.

## Validation

- [x] `npx tsc --noEmit` — no new errors. The pre-existing `TS2589` in
      `audience-write.ts` is now **gone**: typing the recovery helper with the
      module's structural client type fixed it (baseline 1 → 0).
- [x] `npm run build` — clean.
- [x] `npm test` — 3221 tests, 14 failures, all pre-existing (baseline on a clean
      tree: 3195 tests, the same 14 failures in `asset-queue`, `dashboard`, `db`
      and campaign-videos). +26 tests, all passing.
- [x] Live: 1713140 reproduced, cleared by an ADVERTISE grant, and reverted.
- [x] Live: probe residue checked — no `ZZ_PRC*` audience left on the ad account.

## Notes

- **Both connected BMs currently report `token_expired = true`** (The Columbo Group
  and Electric Brixton), so auto-remediation will skip with "needs reconnecting"
  until they are reconnected at `/business-managers`. The salvage path (drop the
  named seed, keep the rest) works regardless, and the probe used the operator's
  personal token directly, which is why it could grant while the app currently
  cannot.
- Recovery covers the single-create path, including single-seed audiences, and
  applies to `page_followers_fb` as well as `page_engagement_fb` — the prefilter
  only ever ran for multi-page `page_engagement_fb`, which is how the followers
  failure reached Meta untouched. The oversized-set split paths
  (`writeSplitPageEngagement` / `writeSplitVideoViews`) do NOT have the ladder yet;
  worth adding if a >5-source audience ever hits this.
- Follow-up worth doing: a scan-time pass that reports every offered seed page the
  operator lacks a role on, so these are granted in bulk from
  `/business-managers` rather than one refusal at a time.
- `reference_meta_bm_asset_grant_endpoints.md` should note that page audience
  sources require a page-level role on the operator, satisfied by `ADVERTISE`.
