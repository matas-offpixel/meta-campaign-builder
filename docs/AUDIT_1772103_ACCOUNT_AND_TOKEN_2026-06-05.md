# Diagnosis — 1772103 on Aberdeen, account + token + BM-asset threads

- **Date:** 2026-06-05 (late — after the 21:41:51 relaunch)
- **Branch:** `cursor/diagnose-1772103-account-and-token`
- **Scope:** Diagnosis only. Grounded in **live Graph API probes** (Matas's
  user token) + the production launch logs from `dpl_42AgF3F8CRgL3qXaKPeQiwjKPzzv`.
- **Symptom:** Aberdeen WC26 traffic ads still fail `code=100 subcode=1772103`
  after PR #565 deployed.

## TL;DR

The wizard did everything right. The **root cause is a BM-asset gap (Thread 3)**:
@4thefansevents is linked to the 4thefans **Page** but is **not** an asset on the
4thefans **ad account**, so the validator's `/act_*/instagram_accounts` gate
returns an empty list (with a valid token, HTTP 200) → `instagram_actor_id` is
dropped → 1772103. Threads 1 (wrong account) and 2 (token) are **not** the cause.

| Thread | Hypothesis | Verdict |
|---|---|---|
| 1 — wrong ad account / IG picked by wizard | Wizard sent the wrong ids | **FALSE** — both ids are correct |
| 2 — invalid/expired token caused empty list | Validator's empty list is a token failure | **FALSE** — validator got HTTP 200 (valid token); subcode 467 is a *separate*, non-fatal call |
| 3 — BM-asset vs page-level linkage gap | IG is page-linked but not an ad-account asset | **TRUE — root cause** |

---

## Thread 1 — account-mapping audit (the assumed ids were wrong)

Live probes (Matas's token):

```
act_10151014958791885  → name "4TheFans",  business "4thefans" (705528006605689)
act_932846012721428    → name "Off / Pixel Ad Account", business "Off / Pixel"
17841407313865620      → IG @4thefansevents "4theFans"
1318484633042193       → NOT an IG account (#100 "nonexisting field username")
```

- The wizard sent `act_10151014958791885` + IG `17841407313865620`. **Both are
  the correct 4thefans identifiers.** The account picker is fine.
- The values we "expected" across #563–#565 (`act_932846012721428`,
  `1318484633042193`) were wrong:
  - `act_932846012721428` is **Off / Pixel's own** ad account — it is also the
    `.env` `META_AD_ACCOUNT_ID`, which is why my #564/#565 curl "proofs" returned
    a non-empty IG list. **Those proofs validated the wrong account.** The prefix
    fix in #565 is still correct, but it was never the blocker for 4thefans.
  - `1318484633042193` is not an IG user object at all (likely a Page id pasted
    into an earlier prompt).

### Where the ids enter the payload

- `adAccountId` = `draft.settings.metaAdAccountId || draft.settings.adAccountId`,
  set in `components/steps/account-setup.tsx` (the ad-account picker writes both
  `adAccountId` and `metaAdAccountId`). Correct value stored.
- `identity.instagramAccountId` (content id) = `instagram_business_account.id`
  on the Page, read by `resolvePageIdentity` (`lib/meta/page-token.ts`).
- `identity.instagramActorId` = output of `resolveIgActorForAdAccount`: it calls
  `fetchAdAccountIgActors` (BM-asset, **empty** for 4thefans) → no match → falls
  back to **page-level / content id** → returns `17841407313865620`
  (actorSource `page_level` / `content_id_fallback`). **This is why the wizard
  legitimately holds the correct IG id even though the BM-asset list is empty.**
- The wizard's "Page + IG · ID 17841407313865620" line is derived from
  `creative.identity.instagramActorId` (the resolved value above) — **not** the
  wire payload, exactly as the PR #562 audit flagged. The wire payload omitted it.

---

## Thread 2 — the two-token mystery (a red herring for 1772103)

Two different tokens are in play during a launch:

1. **`launchToken`** (`launch-campaign/route.ts:237`) =
   `userFbToken ?? process.env.META_ACCESS_TOKEN`. In this launch `userFbToken`
   (the user's DB OAuth token) was present → **valid**. The PR #563 validator is
   constructed with this token, and its call
   `GET /act_10151014958791885/instagram_accounts` returned **HTTP 200**
   (count=0). HTTP 200 ⇒ the token was accepted ⇒ **the empty list is real, not a
   token failure.**

2. **`META_ACCESS_TOKEN` env (the "system token")** — used by the **no-arg**
   `fetchInstagramAccounts()` call in **Phase 1.5**
   (`launch-campaign/route.ts:1098` → `client.ts:919`, `meAccountsToken =
   userToken ?? process.env.META_ACCESS_TOKEN`, here `userToken` is undefined).
   This env token is a **stale/logged-out user token** in prod →
   `/me/accounts` fails `code=190 subcode=467 "user logged out"`. It is wrapped in
   `try/catch` (`client.ts:933`) → logged as a warning, **non-fatal**, and only
   affects an *optional supplement* to the engagement-audience page→IG map. It has
   **no bearing on the validator or on 1772103.**

> `/debug_token` reporting the launch token valid is consistent: the *launch*
> token (user DB) is valid; the *env* token used by the Phase 1.5 supplement is
> the stale one. Two tokens, two outcomes.

Hygiene follow-up (not the cause): stop calling `fetchInstagramAccounts()` with
no token in Phase 1.5 — pass `launchToken`/`userFbToken` so it uses the valid
user token, and/or refresh the prod `META_ACCESS_TOKEN`.

---

## Thread 3 — BM-asset vs page-level linkage (ROOT CAUSE)

Live probes:

```
Page 202868440480679 "4thefans":
  instagram_business_account = { id: 17841407313865620 }   ← IG linked at PAGE level ✓
  connected_instagram_account = { id: 17841407313865620 }

/act_10151014958791885/instagram_accounts  → HTTP 200, data: []   ← BM-asset list EMPTY ✗
```

So @4thefansevents (`17841407313865620`) is connected to the 4thefans **Page**
but has **not** been added as an asset on the 4thefans **ad account**.

- **Meta Ads Manager works** for 4thefans because it resolves IG identity at the
  **Page level** (the `instagram_business_account` on the Page) — exactly the link
  that exists.
- **Our wizard's validator** (PR #563/#565) gates `instagram_actor_id` on
  `/act_*/instagram_accounts` (the **BM-asset** list), which is empty for this
  account. So `validate()` returns `null` → builder omits `instagram_actor_id`
  → page-only creative → Meta rejects the IG-eligible `/ads` call with 1772103.

This is precisely the scenario `lib/meta/page-token.ts:158-169` warned about and
the fallback decision deferred in PR #565. The trigger condition (a real
agency-linked / page-only IG client) has now occurred.

### Full causal chain (all links grounded)

1. Wizard stores correct `adAccountId=act_10151014958791885`,
   `instagramActorId=17841407313865620` (resolved via page-level fallback).
2. Launch validator calls `/act_10151014958791885/instagram_accounts` with the
   **valid** user token → **HTTP 200, []** (BM-asset gap).
3. `[].includes(17841407313865620)` → false → `validate()` returns `null`.
4. `[IG_VALIDATOR_RESULT] returnedNull:true`; `buildCreativePayload` omits
   `instagram_actor_id` → page-only `object_story_spec`.
5. `POST /act_*/ads` with IG placements eligible → **code=100 subcode=1772103**.

---

## Fix shape (NOT applied — diagnosis only)

Per the prompt's decision tree, the cause is the **BM-asset gap**, so the fix is
the deferred **page-level fallback** from PR #565 — *not* an account-picker fix
and *not* (for the 1772103 symptom) a token fix:

- Make the IG-actor gate accept a **page-level-validated** actor: when
  `/act_*/instagram_accounts` is empty/does-not-contain the id, fall back to
  `/{pageId}/instagram_accounts` (page token) — i.e. reuse
  `resolveIgActorForAdAccount` / `resolvePageIgActor` rather than gating solely on
  the BM-asset list. Ads Manager proves the page-level identity is accepted by
  Meta for this account.
- **Caveat to handle in the fix PR:** b57a98e removed the IG id originally because
  *some* accounts returned `#100` "unauthorised actor" when a non-BM id was sent.
  The fallback must therefore be a *validated* page-level resolution (page token
  confirms the link), not a blind re-add, to avoid reintroducing #100 on accounts
  that genuinely lack the link.

Separate, lower-priority hygiene fix (Thread 2): pass the user token to the
Phase 1.5 `fetchInstagramAccounts()` and/or refresh prod `META_ACCESS_TOKEN`.

## One-line takeaway

4thefans' IG (@4thefansevents, 17841407313865620) is linked to the Page but not to
the ad account, so the validator's BM-asset gate is legitimately empty (valid
token, HTTP 200) and drops `instagram_actor_id` → 1772103; the fix is the
deferred page-level fallback, not the account picker or the token.
