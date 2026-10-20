# Diagnosis — #100 "instagram_actor_id must be a valid Instagram account id"

- **Date:** 2026-06-05 (late — after the 22:07:28 Aberdeen relaunch on PR #568)
- **Branch:** `cursor/diagnose-100-actor-id-stale-state-or-format`
- **Deployment:** `dpl_9jVYWHJS1RtTLirrpVP3o1vPpV8B` (prod, app.offpixel.co.uk)
- **Draft:** `3398a4e0-d949-4d90-9ce7-75e18e772899` — "Scotland v Morocco — Pre-announce"
- **Scope:** Diagnosis only. Grounded in **three artefacts** (wire payload +
  persisted form state + live Meta API), as required.

## TL;DR

The id value was **always correct**. The bug is the **field name**.

We send the Instagram account under the **legacy** `instagram_actor_id` field.
Meta Marketing API (both v21.0 and v23.0) now rejects that field for this
account with `(#100) Param instagram_actor_id must be a valid Instagram account
id`. The **same id**, sent under the current field name **`instagram_user_id`**,
is accepted (`{"success":true}` via `validate_only`).

This is the 6th iteration because every prior fix chased the *id resolution*
(BM-asset vs page-level, double-prefix, page-token fallback) when the id was
never the problem — the **field key** was.

| Branch | Hypothesis | Verdict |
|---|---|---|
| A — id format/type mismatch | page-level returns the wrong id type | **TRUE, refined** — not the id value, the **field name** (`instagram_actor_id` → `instagram_user_id`) |
| B — stale wizard state / dropdown load order | wizard sent a stale/mismatched IG id | **FALSE** — persisted id is current and self-consistent |
| C — token scope | page/launch token can't use this IG in `/adcreatives` | **FALSE** — same user token + same id succeeds under `instagram_user_id`; page & ad account share one business |

---

## The three artefacts (all point to the same conclusion)

### 1. Wire payload (prod log, 22:07:33)

```
[WIRE_CREATIVE_PAYLOAD] {"creativeName":"Craig Levein Morocco","path":"multi_placement",
  "instagramActorId":"17841407313865620","pageId":"202868440480679",
  "objectStorySpec":{"page_id":"202868440480679","instagram_actor_id":"17841407313865620"}}

POST /act_10151014958791885/adcreatives
  object_story_spec: { page_id: "202868440480679", instagram_actor_id: "17841407313865620" }

Meta: (#100) Param instagram_actor_id must be a valid Instagram account id  (fbtrace A4ggBz1_5c2SOQwlVccaI83)
```

### 2. Persisted form state (Supabase `campaign_drafts`)

```json
"identity": {
  "pageId": "202868440480679",
  "instagramActorId":   "17841407313865620",
  "instagramAccountId": "17841407313865620"
}
```

`instagramActorId === instagramAccountId === 17841407313865620`. There is **no
staleness and no mismatch** — both fields hold the live page-linked IG account.
The wizard's loading order did not produce a wrong value. **Branch B dead.**

### 3. Live Meta API (db user token `EAAdZABoqfqU…`, valid; verified `/debug_token` in the same launch)

```
GET /17841407313865620?fields=id,username,name
  → {"id":"17841407313865620","username":"4thefansevents","name":"4theFans"}   # IG business account

GET /202868440480679?fields=instagram_business_account,connected_instagram_account
  → instagram_business_account.id   = 17841407313865620
    connected_instagram_account.id  = 17841407313865620                         # both = the same content id

GET /act_10151014958791885/instagram_accounts
  → {"data":[]}                                                                 # BM-asset list empty (the PR #567 finding, real)

GET /202868440480679/instagram_accounts        (page token)
  → [{"id":"17841407313865620","username":"4thefansevents"}]                    # returns the CONTENT id

GET /202868440480679/page_backed_instagram_accounts  (page token)
  → [{"id":"17841425266017908"}]                                               # a DIFFERENT id (PBIA)
```

#### The decisive `validate_only` probes (no creatives created)

`POST /act_10151014958791885/adcreatives` with `execution_options=["validate_only"]`:

| object_story_spec | v21.0 | v23.0 |
|---|---|---|
| `instagram_actor_id: 17841407313865620` (content) | **#100 fail** | **#100 fail** |
| `instagram_actor_id: 17841425266017908` (page-backed) | #100 fail | #100 fail |
| **`instagram_user_id: 17841407313865620`** (content) | **success ✓** | **success ✓** |
| page-only (no IG field) | success ✓ | success ✓ |

Same result with the full failing `asset_feed_spec` multi-placement shape.

So:
- The legacy field `instagram_actor_id` is rejected for this account **regardless
  of which id** we put in it (content id *or* page-backed id).
- The current field `instagram_user_id` accepts the **content id** we already have.
- Page-only validates too — which is exactly why `b57a98e` (dropping the IG field)
  "fixed" #100 but reintroduced 1772103 on IG placements.

#### Ownership (kills Branch C)

```
act_10151014958791885 → business 705528006605689 ("4thefans")
page 202868440480679   → business 705528006605689 ("4thefans")
```

Ad account and Page are in the **same** business. No cross-business sharing gap,
no token-scope problem. The user token that failed under `instagram_actor_id`
**succeeds** under `instagram_user_id` with the same id.

---

## Root cause

`lib/meta/creative.ts` builds **new-ad** creatives with the legacy
`object_story_spec.instagram_actor_id`:

- `buildLinkCreative`     → `spec.instagram_actor_id = validatedIgActorId` (line ~359)
- `buildVideoCreative`    → `spec.instagram_actor_id = validatedIgActorId` (line ~421)
- `buildMultiPlacementCreative` → `{ ...(validatedIgActorId ? { instagram_actor_id } : {}) }` (line ~614)

Meta has moved new-ad IG identity to `instagram_user_id`. The codebase **already
uses `instagram_user_id` correctly** for the existing-post path
(`buildExistingPostCreative`, line ~678) — that path works. Only the new-ad
builders were left on the deprecated key.

Every earlier PR (#563 validation gate, #565 double-prefix, #568 page-level
fallback) correctly resolved/validated the **id**, then wrote it under the wrong
**field**. The id was fine all along.

---

## Fix shape (per branch — NO code in this PR)

**Branch A (the real one) — rename the field in the three new-ad builders:**

In `lib/meta/creative.ts`, change `object_story_spec.instagram_actor_id` to
`object_story_spec.instagram_user_id` for `buildLinkCreative`,
`buildVideoCreative`, and `buildMultiPlacementCreative`. The value is the IG
**business account id** (the `instagramAccountId` / content id the wizard already
holds, equal to the validated id here).

- Keep the PR #568 validation gate — it is now *correct*: the gate confirms the
  id appears in `/{pageId}/instagram_accounts` (which returns exactly the IG
  business account id), so it preserves `b57a98e` protection for genuinely
  unauthorised ids while the field rename makes the accepted ones actually launch.
- `instagram_user_id` and `instagram_actor_id` should not both be sent; the
  rename replaces the key, it does not add one.
- `MetaCreativePayload`/`ObjectStorySpec` types in `creative.ts` already declare
  `instagram_user_id?: string` (used by the existing-post path) — no type change
  needed beyond using it.

**Branch B — none.** No staleness; nothing to fix in the wizard loading order.

**Branch C — none.** Token scope is fine.

**Recommended acceptance gate (RED → GREEN):** a `validate_only` integration
check (or a unit test asserting the built payload uses `instagram_user_id`, not
`instagram_actor_id`) reproducing the 4thefans shape:
`object_story_spec` must contain `instagram_user_id` and must **not** contain
`instagram_actor_id`.

---

## Second-order finding (log-only, not the cause)

The Phase-3 "CREATIVE PRE-POST SUMMARY" printed:

```
[instagram_actor_id]      OMITTED ✓ (page-only identity for new_ad)
[contentAccountId]        17841407313865620
```

…while the **actual** posted payload contained
`object_story_spec.instagram_actor_id: 17841407313865620`. The summary's
"OMITTED" branch does not reflect the `multi_placement` builder, which injects
the field. Worth correcting when the field rename lands so the summary stops
lying about the wire payload. (No functional impact; flagged for honesty of logs.)

---

## Cleanup owed once the field-rename fix is verified

- Remove the temporary `TODO(2026-06-12)` logs from PR #565
  (`ig-actor-validator` URL log) and PR #566
  (`[IG_VALIDATOR_RESULT]`, `[WIRE_CREATIVE_PAYLOAD]`,
  `[META_WIRE_PAYLOAD]`). They did their job — this audit closes the loop.
