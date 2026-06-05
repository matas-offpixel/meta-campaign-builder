# Diagnosis — two regressions surfaced after PR #563 (validated IG actor re-add)

- **Date:** 2026-06-05
- **Branch:** `cursor/diagnose-ig-validator-post-merge-regression-audit-only`
- **Scope:** Diagnosis only — no fix applied. Grounded in live Graph API
  responses + production runtime logs, not speculation.
- **Symptoms reported:**
  1. Aberdeen WC26 traffic ads still fail `code=100 subcode=1772103` across all
     3 ad sets **after #563 merged** (new creative id per launch → #563 is in the
     build).
  2. The wizard's Facebook **Page dropdown** is much slower post-#563 ("Loading…"
     for several seconds); IG Account dropdown now populates first.

## Verdict

| Symptom | Cause | #563 implicated? |
|---|---|---|
| 1 — 1772103 still failing | **NEW bug in #563**: the validator builds a **double `act_` prefix** URL (`act_act_{id}`) → Graph returns HTTP 400 → validator treats the account as having **zero** authorised IG accounts → returns `null` → `instagram_actor_id` omitted → 1772103. | **YES** |
| 2 — slow Page dropdown | **NOT #563.** The validator never runs in the dropdown / page-identity path; #563 touched no file in that path. The latency is pre-existing in `/api/meta/pages`. | **NO (exonerated)** |

They do **not** share a cause. Symptom 1 is a real #563 defect; symptom 2 is a
mis-attribution.

---

## Symptom 1 — root cause (proven)

### The defect

`lib/meta/ig-actor-validator.ts:59` builds the URL by hand:

```ts
const url =
  `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/instagram_accounts` +
  `?fields=id&limit=100&access_token=${accessToken}`;
```

But `adAccountId` is **already prefixed** with `act_` everywhere in the launch
routes. The same variable is handed to `createMetaCreative(adAccountId, …)` and
`createMetaAd(adAccountId, …)`, both of which call `withActPrefix()`
(`lib/meta/ad-account-id.ts`), which is **idempotent**:

```ts
export function withActPrefix(adAccountId: string): string {
  if (!adAccountId) return adAccountId;
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}
```

Every other ad-account call site in `lib/meta/client.ts` (createMetaCreative,
createMetaAd, fetchAdAccountIgActors, createMetaAdSet, …) uses `withActPrefix`.
The validator is the **only** place that hand-rolls `act_${adAccountId}`, so it
produces `act_act_{id}`.

### Artefact A — live Graph API (account-independent)

Using the stored ad account id `act_932846012721428` (note: already prefixed):

```
=== CORRECT  /act_932846012721428/instagram_accounts ===
HTTP 200

=== VALIDATOR /act_act_932846012721428/instagram_accounts ===
HTTP 400
{"error":{"message":"Unsupported get request. Object with ID
 'act_act_932846012721428' does not exist, cannot be loaded due to missing
 permissions, or does not support this operation …","type":"GraphMethodException",
 "code":100,"error_subcode":33,"fbtrace_id":"AyfiJlYNtI5jqUCzOGvC7f_"}}
```

### Artefact B — production runtime logs (the actual Aberdeen relaunch, 21:09:56)

Boolean full-text probes against the failed `POST /api/meta/launch-campaign`
(deployment `dpl_9L7puXaoAMtpYWyt2PbXMwnUHcv4`, prod, main):

| Probe (validator log line) | Matched? | Meaning |
|---|---|---|
| `instagram_accounts API returned HTTP` | **YES** | `res.ok` was false → non-200 from Graph |
| `instagram_accounts fetch failed` | no | no exception was thrown (it was an HTTP status, not a network error) |
| `adAccount=… has N authorised IG account(s)` (success line) | no | the success branch never ran |
| `igActorId=… NOT found in adAccount=…` | **YES** | `validate()` returned `null` |

These four facts uniquely identify this code path: `fetchAuthorisedIds()` hit a
non-200 (Artefact A shows it's a 400 from the double prefix) → `authorisedIds = []`
→ `[].includes(igActorId)` is false → `validate()` returns `null`.

### Causal chain (each link proven)

1. `adAccountId` is stored **with** the `act_` prefix (`act_932846012721428`).
2. Validator builds `act_act_932846012721428/instagram_accounts` → **HTTP 400**
   (Artefact A; matched in prod logs, Artefact B).
3. `res.ok === false` → `authorisedIds = []` (no success log — Artefact B).
4. `validate()` → `[].includes(actorId)` → `null` ("NOT found" log — Artefact B).
5. Route logs `IG actor validation failed … falling back to page-only`; passes
   `validatedIgActorId: undefined` to `buildCreativePayload`.
6. `buildLinkCreative` / `buildVideoCreative` omit `instagram_actor_id` →
   page-only `object_story_spec`.
7. Meta `POST /act_…/ads` with IG placements eligible → **code=100 subcode=1772103**.

> The wizard's "Page + IG · ID 1318484633042193" line is, as the PR #562 audit
> warned, derived from `creative.identity` (resolved at identity-fetch time via
> `resolveIgActorForAdAccount`, which uses the **correct** prefix). It is not the
> wire payload. The wire payload omitted the field.

### Why "single asset worked before"

Before #563, `instagram_actor_id` was omitted for **all** new-ad creatives
(b57a98e). After #563 it is *still* omitted for this account — because the
validator's gate always fails (400). So #563's intended fix never engages for any
account whose id is stored with the `act_` prefix, i.e. effectively all of them.
This is why the symptom is unchanged despite #563 being in the build.

---

## Symptom 2 — #563 exonerated

### The dropdown call graph (Page dropdown)

```
creatives.tsx mount
  └─ useFetchPages(adAccountId)            [lib/hooks/useMeta.ts]
       └─ GET /api/meta/pages?adAccountId  [app/api/meta/pages/route.ts]
            ├─ resolveServerMetaToken(supabase, user)        (DB read)
            └─ Promise.all([
                 fetchPersonalPages(token)            → GET /me/accounts (limit=200)
                 fetchBusinessIdForAccount(adAccountId) → GET /act_…?fields=business
                   → fetchPages(businessId)           → GET /{bm}/owned_pages (limit=200)
                 fetchBusinessIdForAccount(adAccountId) → GET /act_…?fields=business  (DUPLICATE)
                   → fetchClientPages(businessId)      → GET /{bm}/client_pages (limit=200)
               ])
```

The IG actor dropdown / identity resolution is a separate call:
`useFetchPageIdentity` → `GET /api/meta/page-identity` →
`resolvePageIdentity` (up to 3 sequential Graph calls) +
`resolveIgActorForAdAccount` → `fetchAdAccountIgActors`.

### Proof #563 is not in this path

- Files changed by #563 (`git show --stat 1b215f4`):
  `app/api/meta/bulk-attach-ads/route.ts`, `app/api/meta/launch-campaign/route.ts`,
  `lib/meta/creative.ts`, `lib/meta/ig-actor-validator.ts`, 2 tests, 1 session log.
  **None** is in the dropdown path above.
- Grep for `ig-actor-validator` / `createIgActorValidator` runtime importers →
  **only** `launch-campaign/route.ts` and `bulk-attach-ads/route.ts`. (The
  `creative.ts` and `*regression.test.ts` matches are doc/comment mentions, not
  imports.) The validator therefore **cannot** run during dropdown render or
  page-identity fetch. The user's "validator runs during page-identity fetch"
  hypothesis is refuted.
- `git log` of the dropdown path predates #563 by weeks:
  `app/api/meta/pages/route.ts` → `dadd4d9`; `lib/hooks/useMeta.ts` → `5128fbe`;
  `lib/meta/page-token.ts` & `app/api/meta/page-identity/route.ts` → `f34b337`.
- `app/api/meta/pages/route.ts` imports only from `lib/meta/client.ts` and
  `lib/meta/server-token.ts` — never `creative.ts` or the validator.

### What the latency actually is (pre-existing)

`/api/meta/pages` resolves the BM id **twice** (lines 113 & 119) and runs three
`limit=200` enumerations (`/me/accounts`, `/{bm}/owned_pages`,
`/{bm}/client_pages`). That is the multi-second cost; it is unchanged by #563. The
perceived "reversal/slowdown coinciding with the #563 deploy" is coincidental
(Meta-side latency / token state / the duplicate business-id resolution), not a
#563 effect. (Note: the prod runtime-log query for `/api/meta/pages` repeatedly
timed out fetching pages — consistent with a high-latency / high-volume route.)

> Out of scope for the #563 fix, but a real follow-up: dedupe the two
> `fetchBusinessIdForAccount` calls in `/api/meta/pages` (resolve once, reuse).

---

## Fix proposal (NOT applied — follow-up branch)

**Symptom 1 (the actual #563 bug) — required.**

In `lib/meta/ig-actor-validator.ts`, stop hand-rolling the prefix; use the
idempotent helper:

```ts
import { withActPrefix } from "./ad-account-id.ts";
// …
const url =
  `https://graph.facebook.com/${META_API_VERSION}/${withActPrefix(adAccountId)}/instagram_accounts` +
  `?fields=id&limit=100&access_token=${accessToken}`;
```

This turns the 400 into a 200, so the validator returns the real authorised list.

**Residual risk to verify in the fix PR (agency-linked accounts).** Even with the
correct prefix, `/act_{id}/instagram_accounts` is the **BM-asset** list.
`lib/meta/page-token.ts:158-169` explicitly warns it can exclude agency-linked IG
accounts (and `client.ts:967` calls it "authoritative" — the two docstrings
contradict each other). The identity resolver already handles this by falling back
to `/{pageId}/instagram_accounts` (`resolveIgActorForAdAccount` → `page_level`).
Two safe options for the fix:

1. **Reuse the resolver, don't re-validate.** `creative.identity.instagramActorId`
   was already resolved authoritatively at identity time. The launch-time
   validator is largely redundant; gate on "is it a plausible numeric id" or drop
   the second network round-trip entirely.
2. **Make the gate agency-aware.** If the BM list doesn't contain the id, fall
   back to `resolvePageIgActor(pageId, pageToken, …)` before returning `null`,
   mirroring `resolveIgActorForAdAccount`.

Either way the fix PR must confirm against the 4thefans account that the
post-fix validator returns `1318484633042193` (not `null`).

**Symptom 2 — no change needed for the 1772103 fix.** Optionally dedupe the
business-id resolution in `/api/meta/pages` as a separate perf PR.

## RED test

`lib/meta/__tests__/ig-actor-validator-prefix-regression.test.ts` mocks
`global.fetch`, constructs the validator with an **already-prefixed** account id
(`act_932846012721428`, exactly as stored), calls `validate()`, and asserts the
requested URL contains `/act_932846012721428/instagram_accounts` and **not**
`act_act_`. It is **RED on current main** (URL is `act_act_932846012721428`) and
turns green once the validator uses `withActPrefix`.

## One-line takeaway

#563's validator double-prefixes the ad-account id (`act_act_…`) → every
`/instagram_accounts` check 400s → `instagram_actor_id` is always dropped → 1772103
persists; the slow Page dropdown is unrelated pre-existing `/api/meta/pages`
latency.
