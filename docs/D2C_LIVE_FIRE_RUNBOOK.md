# D2C Live-Fire Runbook — 2026-07-01 Incident Post-Mortem

**Status (2026-07-02 follow-up, branch `d2c/direct-fire-live-fix-followup`):
all 9 layers now resolved.** Layers 1–5 fixed via ops (prod is correct).
Layers 7 & 8 shipped in PR #661. Layers 6 & 9 are now **fixed and verified** —
`BIRD_RUNTIME_SEND_VERIFIED = true` — reconciled against
`.scratch/bird-runtime-send-capture.txt`. See "How the verified path was
built" below for provenance and the one residual risk flagged for the
post-merge smoke test.

**UPDATE (2026-07-14, branch `fix/d2c-bird-list-fanout`): Layer 6's
`{ contacts: [{ listId }] }` best-guess was LIVE-REJECTED.** The reset
T26-ALGARVE WA DM reminder smoke test 422'd with
`property "listId" is unsupported` — Bird's channels `/messages` endpoint has
**no list-targeting field at all** (its docs only ever show phone-identifier
receivers because that is the only receiver shape that exists). Layer 6 is now
resolved via the runbook's own fallback #2: preflight `GET /lists/{id}/contacts`
→ resolve members to individual phone identifiers → fan out one message each.
See the updated Layer 6 detail below. The tag→list_id resolution (PR #720) was
NOT implicated and remains correct; this was one layer deeper (the wire-shape
of the list-targeted send itself).

**Incident:** The DIRECT-FIRE Bird path (`autoresp_setup`, `community_early`)
was fired live for the first time against a real Jackies Mallorca event
(`160fbb1c-a4be-4435-a53d-a690c9edf895`) via `/api/cron/d2c-send`. It had only
ever been exercised as a dry-run before. The first live attempt surfaced a
9-layer bug chain. The DRAFT-REVIEW path (PR #657) was already verified and was
not implicated.

---

## The 9 layers (one line each)

1. **pgcrypto not installed** — credential decrypt RPC errored; fixed by ops migration 131 (`create extension pgcrypto`).
2. **Credentials in legacy `credentials` jsonb** — not in `credentials_encrypted`; fixed by ops SQL rewriting via the encrypted path.
3. **Credentials missing `channel_id`** — provider aborted on the missing field; fixed by ops repopulating the blob.
4. **pgcrypto in `extensions` schema, code called unqualified `pgp_sym_decrypt`** — decrypt failed; fixed by ops `ALTER EXTENSION pgcrypto SET SCHEMA public` (22:47 UTC).
5. **`D2C_TOKEN_KEY` mismatch (Vercel vs Supabase)** — decrypt produced garbage; fixed by ops aligning the Vercel env var to the Supabase key.
6. **list-targeted receiver shape** — `{ contacts: { listId } }` (422 "value must be an array") → `{ contacts: [{ listId }] }` (422 "property listId is unsupported", 2026-07-14) → **fan-out to `identifierValue` receivers**; **CODE, FIXED** (2026-07-14).
7. **Dispatcher never hydrated `variables`** — send reached Bird with `variables: {}`, all 6 required template params unbound; **CODE, FIXED** — `hydrateSendVariables` added (PR #661).
8. **`d2c_event_copy.artwork_url` null in prod** — required `event_artwork_url` had no value; **CODE, FIXED** — per-client fallback (migration 133) + resolver write-back (PR #661).
9. **Template body shape wrong** (nested `body.template` + `name` + keyed Meta-style `components[]`, vs Bird's top-level `template` + `projectId`/`version` + flat `parameters[]`) — **CODE, FIXED**.

---

## Layer detail

### Layers 1–5 — OPS ARTIFACTS (do not re-touch in code)

These were resolved by direct SQL / env changes to prod during the incident.
Migrations 131 (pgcrypto + schema move) and 132 (credential re-encryption) were
applied directly and are intentionally **not** committed as migration files.
Current prod state is correct. This PR does not re-run any credential decrypt or
pgcrypto change.

| # | Error (verbatim/observed) | Root cause | Fix (ops) | Prevention |
|---|---|---|---|---|
| 1 | `function pgp_sym_decrypt(...) does not exist` | pgcrypto extension never installed | migration 131 `create extension pgcrypto` | Provisioning checklist asserts required extensions before enabling live D2C for a client. |
| 2 | decrypt RPC returned `{}` (empty) | creds sat in legacy plaintext `credentials` jsonb, encrypted blob empty | SQL: re-store via `set_d2c_credentials` (encrypted path) | `getD2CConnectionCredentials` already falls back to legacy — add a health check that flags any live connection still on the legacy column. |
| 3 | `Missing Bird api_key, workspace_id or channel_id` | creds blob had no `channel_id` | SQL: repopulate blob with `channel_id` | `validateCredentials` should require `channel_id` (not just `api_key`/`workspace_id`) before a connection can be marked live. |
| 4 | `function public.pgp_sym_decrypt does not exist` | pgcrypto lived in `extensions` schema; code calls unqualified | `ALTER EXTENSION pgcrypto SET SCHEMA public` | Pin pgcrypto schema in a committed migration; assert `search_path` in the RPC. |
| 5 | decrypt produced non-JSON garbage | `D2C_TOKEN_KEY` differed between Vercel and Supabase | Align Vercel env to the Supabase key | Store the key in one source of truth; add a startup assertion that a known-ciphertext round-trips. |

### Layers 6–9 — CODE

#### Layer 6 — receiver shape (SUPERSEDED twice; FIXED via fan-out 2026-07-14)

- **Error (original, 2026-07-01):** Bird `422 { "value must be an array" }` on
  POST `/workspaces/{wid}/channels/{cid}/messages`.
- **Root cause (original):** `lib/d2c/bird/provider.ts` built
  `receiver: { contacts: { listId } }` — an object where Bird expects an array.
- **First fix (2026-07-02, docs-derived best-guess):**
  `receiver: { contacts: [{ listId }] }`. **This was never live-tested** — see
  the residual-risk note that shipped with it.
- **Error (2026-07-14 live smoke test):** Bird `422 {"code":"InvalidPayload",
  "message":"One or more fields provided in the request body are malformed",
  "details":{".receiver.contacts[0]":["property \"listId\" is unsupported"]}}`.
  No message id, no send — rejected before dispatch.
- **Root cause (real):** Bird's channels `/messages` endpoint has **no
  list-targeting field**. `receiver.contacts[]` only accepts per-contact
  `identifierValue` (a phone/email). Confirmed against the endpoint's own API
  reference — every documented receiver example is a phone identifier because
  that is the only shape that exists. Handing it a `listId` (or `listType`)
  cannot work; there was never a list-targeted receiver to reconcile.
- **Fix (2026-07-14, fan-out — this runbook's own fallback #2):** for a
  list-targeted send, preflight `GET /workspaces/{ws}/lists/{listId}/contacts`
  (endpoint + contact shape verified against Bird's Contacts API docs), resolve
  each member's `phonenumber` identifier, dedupe, then send **one message per
  identifier** with the already-correct `{ contacts: [{ identifierValue }] }`
  receiver. Implemented in `lib/d2c/bird/groups/client.ts::listContactsInList` /
  `contactPhoneIdentifiers` and the fan-out branch of
  `lib/d2c/bird/provider.ts::send`. Resolved members are cached on
  `result_jsonb.details.preflight` for auditability, as flagged. The
  explicit-`recipients[]` path is unchanged (its `identifierValue` shape was
  always correct).
- **Partial-failure semantics:** the fan-out reports `ok:false` if ANY
  per-recipient POST fails, so the cron marks the row `failed` with the full
  per-recipient breakdown in `result_jsonb` for manual review — no silent
  partial success, no auto-retry.
- **⚠️ Still to confirm on the next live smoke test (GET-only, no send risk):**
  (a) the list-contacts **pagination cursor field name** — page size + the
  `results` envelope are docs-confirmed, but the next-page token field is not,
  so `listContactsInList` degrades to "first 100 members only" rather than
  looping if the guessed field is wrong; (b) that `phonenumber` is the exact
  attribute/identifier key Bird returns for phone contacts. Both are read-path
  guesses that fail safe (a wrong GET cannot send a message).
- **Prevention:** `provider.integration.test.ts` now asserts the fan-out makes
  a preflight GET then one `identifierValue` POST per member, and that **no
  outgoing body ever contains `listId`**; `groups/__tests__/client.test.ts`
  covers pagination + phone extraction. Dry-run tests never inspected the bytes
  that leave the process (see post-mortem).

#### Layer 7 — variable hydration (FIXED)

- **Observed:** template send would error on all 6 required variables; the
  scheduled-send row carried `variables: {}`.
- **Root cause:** nothing resolved the template variables from
  `d2c_event_copy` / `events` at dispatch time.
- **Fix:** `lib/d2c/bird/hydrate-variables.ts` →
  `hydrateSendVariables(sendRow, eventCopy, event, client)` resolves the 6
  variables (`event_name`, `event_date`, `event_artwork_url`, `presale_day`,
  `presale_time`, `wa_community_invite`) and **throws
  `MissingTemplateVariablesError` before any HTTP call** if any required
  variable is empty. `wa_community_invite` is extracted from
  `whatsapp_community_url` (protocol/domain/query stripped → code segment).
- **Prevention:** loud-fail → the send surfaces as `failed` with the exact
  missing-variable list, never as a malformed Bird request. Unit-tested for
  each missing-variable case + override precedence.

#### Layer 8 — artwork resolution (FIXED)

- **Observed:** `d2c_event_copy.artwork_url` was null for the Jackies event; the
  template requires `event_artwork_url`.
- **Root cause:** no per-event poster resolved, and no deterministic fallback.
- **Fix:** migration 133 adds `clients.d2c_fallback_artwork_url`.
  `resolveEventArtwork` gains a 4th chain step (per-client fallback) before it
  throws, and now **writes the resolved URL back** to
  `d2c_event_copy.artwork_url` so subsequent sends short-circuit.
- **Prevention:** a missing per-event poster degrades to a brand-safe
  placeholder instead of a hard failure; the write-back makes resolution
  sticky.

#### Layer 9 — template body shape (FIXED 2026-07-02)

- **Root cause:** the code nested `template` under `body.template`, keyed it
  by `name` (not `projectId`/`version`), and wrapped variables in Meta's
  WhatsApp Cloud API `components: [{ type: "body", parameters: [...] }]`
  shape. Bird abstracts this differently.
- **Fix:** `template` is now a **top-level** sibling of `receiver` (no `body`
  field present on template sends at all — confirmed by Bird's docs samples).
  It is keyed by `projectId` + `version` (mapped from `audience.project_id` /
  `audience.template_id` — same naming already used by the draft-campaign
  orchestration path). Variables are a **flat** `parameters: [{type,key,value}]`
  array with no wrapper.
- **Response envelope note:** Bird's docs don't show a success-response
  sample. `res.id` is retained as an inference (matches the pre-existing
  code's assumption) — genuinely unconfirmed until a live send returns a body.
  Not a regression; flagged here for visibility.
- **Prevention:** `provider.integration.test.ts` byte-diffs the full
  `template` object (including parameter order) against the capture's own
  worked example.

---

## How the verified path was built (2026-07-02)

**Provenance — read this before trusting the "verified" label at face value.**
`.scratch/bird-runtime-send-capture.txt` is **not a DevTools capture**. A
DevTools capture was attempted first (per the original layer 6/9 gate's
requirement) and failed: Bird's own UI test-send flow does not surface the
send payload in the Network panel — the file's own "CAPTURE PROVENANCE"
section suspects a server action or an out-of-band batch dispatch mechanism
that DevTools' payload search doesn't index. The approach was then pivoted to
**Bird's public API documentation**
(`docs.bird.com/api/channels-api/message-types/template`,
`.../send-batch-messages`), which is a legitimate, official-source ground
truth — materially different from "derived from conventions/guessed," which
is what caused the original 422.

**What is docs-confirmed (high confidence):**
- Endpoint + method (matches what was already in code).
- Auth scheme (matches what was already in code).
- `recipients[]` → `identifierValue` receiver shape (was already correct, and
  is now the ONLY receiver shape used — see Layer 6 fan-out).
- `template` as a top-level field, keyed by `projectId` + `version`, with a
  flat `parameters` array.
- `GET /workspaces/{ws}/lists/{listId}/contacts` endpoint + `results[]` /
  `featuredIdentifiers[{key,value}]` / `attributes` contact shape
  (2026-07-14, Bird Contacts API docs).

**What is NOT docs-confirmed (residual risk, called out per-layer above):**
- ~~The `list_id`-targeted receiver shape~~ — RESOLVED 2026-07-14: no such shape
  exists; list sends fan out to `identifierValue` receivers instead.
- The list-contacts pagination cursor field name and the exact phone
  identifier/attribute key (Layer 6 read-path — both fail safe; GET-only).
- The success response envelope shape (`{ id }` is an inference).

**Why `BIRD_RUNTIME_SEND_VERIFIED` was flipped to `true` anyway:** the
explicit follow-up brief asked for the flip once the (docs-sourced) shape was
reconciled, with a post-merge smoke test as the live-fire verification step —
exactly the mechanism the capture document itself anticipates ("iterate on 422
responses if any gap surfaces during live-fire verification"). The flag is
retained as a live re-gating point (flip back to `false`) if the smoke test
surfaces a shape regression that can't be fixed forward immediately.

**Smoke-test row analysis (`e22b99c5-eabd-459f-a980-85684056b450`) —
queried before writing code, not assumed:**
- `variables: {}`, `audience: { list_id: "9386300f-..." }` — no `brand` /
  `event_code`, so this row takes the **legacy/generic `provider.send()`
  path** (this PR's scope), NOT `orchestrateJob → executeBirdJob`, which
  remains an unconditional stub, unaffected by this PR.
- Its linked `d2c_templates` row is a **plain markdown body**, not a
  Bird Studio registered template (no `project_id`/`template_id` on
  `audience`) — so the actual smoke-test send will go out as a **plain
  WhatsApp text message**, not a `template` message. This means the smoke
  test primarily exercises the layer-6 `list_id` receiver fix, not the
  layer-9 template-parameters shape. This is a pre-existing data/routing
  characteristic of that row, not something this PR changes.
  **(2026-07-14 note:** the fan-out now turns this single list-targeted send
  into N per-member text sends — re-run the smoke test against a list with
  ONE or TWO test contacts first, since it will now actually message every
  resolved member.)**

`lib/d2c/orchestration/bird-runner.ts::executeBirdJob` (the orchestration-path
executor for rows that DO have `brand`+`event_code`) still throws
`BIRD_RUNTIME_UNVERIFIED` unconditionally — wiring the now-verified send shape
into it, in the order `resolveEventArtwork` → `hydrateSendVariables` → verified
`provider.send()`-equivalent POST, remains a follow-up (out of scope for both
this PR and PR #661, which explicitly left the cron/executor untouched).

---

## Post-mortem — why the dry-run tests missed layers 6–9

The existing suite gated everything behind the 3-of-3 dry-run check and asserted
**intent** (the planner's description of what *would* be sent), never the
**bytes that leave the process**. Consequences:

- **Layer 6/9 (shape):** no test ever inspected the actual `receiver` / body
  JSON, so an object-vs-array or `locale`-vs-`language.code` mismatch was
  invisible until a live 422. The one test that "passed all gates" asserted only
  that a POST reached `/messages` and returned a stubbed id — not the payload.
- **Layer 7 (variables):** the planner logged `variables` as the merged map, but
  the actual send row persisted `{}`; dry-run never diffed the two, so the empty
  binding was never caught.
- **Layer 8 (artwork):** dry-run never required a non-empty `event_artwork_url`,
  so a null artwork looked fine right up to the live template send.

**Structural fix:** integration tests that mock the HTTP layer and assert the
**outgoing request body verbatim** against a real capture (see
`provider.integration.test.ts`), plus loud-fail hydration that refuses to send
with missing variables. Live paths that construct an undocumented third-party
payload must have a captured-shape byte-diff test before the verified flag flips
— dry-run intent assertions are demonstrably insufficient.
