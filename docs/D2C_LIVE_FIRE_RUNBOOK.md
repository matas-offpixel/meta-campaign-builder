# D2C Live-Fire Runbook — 2026-07-01 Incident Post-Mortem

**Status:** layers 1–5 fixed via ops (prod is correct); layers 6–9 tracked by
branch `d2c/direct-fire-live-fix`. Layers 6 & 9 remain gated behind
`BIRD_RUNTIME_SEND_VERIFIED = false` until the runtime-send DevTools capture
lands.

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
6. **`receiver: { contacts: { listId } }` (object, not array)** — Bird returned 422 "value must be an array"; **CODE**, gated pending capture.
7. **Dispatcher never hydrated `variables`** — send reached Bird with `variables: {}`, all 6 required template params unbound; **CODE**, `hydrateSendVariables` added.
8. **`d2c_event_copy.artwork_url` null in prod** — required `event_artwork_url` had no value; **CODE**, per-client fallback (migration 133) + resolver write-back added.
9. **Template body shape unverified** (`template.locale` + keyed params vs Meta's `language.code` + positional) — never checked against a real send; **CODE**, gated pending capture.

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

### Layers 6–9 — CODE (this PR)

#### Layer 6 — receiver shape (GATED, pending capture)

- **Error:** Bird `422 { "value must be an array" }` on POST
  `/workspaces/{wid}/channels/{cid}/messages`.
- **Root cause:** `lib/d2c/bird/provider.ts` built
  `receiver: { contacts: { listId } }` — an object where Bird expects an array
  of contacts (or possibly rejects `list_id` entirely for template sends and
  requires a preflight list→contacts expansion).
- **Fix applied here:** the live WhatsApp send path now **loud-fails** with
  `BIRD_RUNTIME_UNVERIFIED` behind `BIRD_RUNTIME_SEND_VERIFIED = false`, so the
  known-broken shape can never leave the process again. The correct shape must
  be reconciled against `.scratch/bird-runtime-send-capture.txt` (same
  discipline as PR #657's draft-campaign flow) before flipping the flag.
- **Prevention:** the new `provider.integration.test.ts` asserts the outgoing
  request body against the captured shape — dry-run tests never inspected the
  bytes that leave the process (see post-mortem).

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

#### Layer 9 — template body shape (GATED, pending capture)

- **Root cause:** the body used `template.locale` and keyed
  `parameters[].key`; Meta/Bird's runtime WhatsApp API historically uses
  `language.code` and positional params. Never verified against a real send.
- **Fix applied here:** gated with layer 6 behind `BIRD_RUNTIME_SEND_VERIFIED`.
  Reconcile the body shape against the capture before flipping.
- **Prevention:** same integration-test byte-diff as layer 6.

---

## Where this plugs in (when the capture lands)

`lib/d2c/orchestration/bird-runner.ts::executeBirdJob` is the direct-fire
executor and currently throws `BIRD_RUNTIME_UNVERIFIED`. When the capture lands,
implement it in this order:

1. **Layer 8** — `resolveEventArtwork(supabase, eventId, { clientId, brandHint, eventCode })`
   so `event_artwork_url` is populated (and written back).
2. **Layer 7** — `hydrateSendVariables(sendRow, eventCopy, event, client)` →
   loud-fail on any missing required variable BEFORE the HTTP call.
3. **Layers 6 & 9** — reconcile the receiver + template body shapes in
   `provider.ts` against the capture, flip `BIRD_RUNTIME_SEND_VERIFIED = true`,
   fill in and un-skip the `provider.integration.test.ts` shape assertions.

> **Constraint note:** the cron route (`app/api/cron/d2c-send/route.ts`) is
> intentionally untouched by this PR. The helpers above are standalone and
> unit-tested; wiring them into the executor belongs with the layer 6/9
> implementation once the shape is verified.

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
