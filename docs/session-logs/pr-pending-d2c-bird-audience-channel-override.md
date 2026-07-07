# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/d2c-bird-audience-channel-override`

## Summary

`BirdProvider.send()` read `channel_id` only from the connection's decrypted
credentials, so every Bird send under a client routed to that one credential
channel — breaking multi-brand-per-client setups (Throwback + Hop on the Top
share one `d2c_connections` row, `UNIQUE(user_id, client_id, provider)`
forbids a second Bird row per client, but each brand has its own WhatsApp
channel). Hop's scheduled sends already carried the correct
`audience.channel_id`; the provider just ignored it.

Fix: `audience.channel_id` (per-send) now wins over `creds.channel_id`
(connection-level fallback), exactly as spec'd — the 1-line override matched
the ask with no need for a spec correction this time.

## Scope / files

- `lib/d2c/bird/provider.ts` — `channelId` resolution now checks
  `message.audience.channel_id` first, falling back to `creds.channel_id`.
  Guard clause and error message unchanged.
- `lib/d2c/bird/__tests__/provider.test.ts` — 4 new tests: audience override
  wins, credential fallback (legacy clients), both-absent graceful error, and
  a byte-diff of the `/workspaces/{ws}/channels/{channelId}/messages` URL for
  both paths (exact string equality, not `.includes`).

No `@/` imports were touched or introduced — `provider.ts` and its test file
were already all-relative.

## Validation

- [x] `node --test` on `provider.test.ts` — 12/12 pass (8 existing + 4 new).
- [x] `npm test` (full suite) — 2864/2879 pass, 14 fail — same pre-existing
  failure set as `main` post-#694 (unrelated `@/lib` resolution issues in
  other test files + one Meta creative test flake).
- [x] `tsc --noEmit` — zero errors in changed files.
- [x] ESLint clean.
- [x] `npm run build` — passes.
- [x] **Post-implementation DB verification** (per the prompt's checklist),
  run directly against the live Supabase project:
  1. All 5 Hop on the Top Porto WhatsApp sends
     (`63c8efc4-ceb2-49b9-bafc-93c846e7b6f4`) carry
     `audience.channel_id = "61ad0713-8fa4-5f6c-aabf-fcf3316462fc"` — 5/5
     match, no nulls, no other value.
  2. Legacy-client sanity scan:
     - Throwback client (`943bc5f1-…`) has 2 events (ALGARVE + Hop on the
       Top Porto); **both** events' sends carry an explicit per-send
       `audience.channel_id` (Throwback's own `04dcc60a-…` vs Hop's
       `61ad0713-…` respectively) — the override path is exercised for
       every Throwback-client send, never the fallback.
     - Every `d2c_connections` row where `provider='bird'` (2 total:
       Throwback, GMC Worldwide Productions) inspected. Of 14 total
       whatsapp/sms scheduled sends across the whole DB, **4 genuinely rely
       on the credential fallback** — all under the GMC connection, all
       missing `audience.channel_id` — including **one already
       `status='sent'`**, i.e. it already sent live successfully via
       `creds.channel_id` before this change. Confirms the fallback path is
       correct and unregressed for single-brand clients.

## Notes

- **Discovery (documented, not fixed — out of scope):** Throwback's own
  connection-level `creds.channel_id` (`322236d8-c182-4d32-bcdc-2e96f833ccfc`)
  does NOT match Throwback's own audience-level channel
  (`04dcc60a-39df-51db-bcb0-6aab68de54b1`), and is byte-identical to GMC
  Worldwide Productions' credential channel_id on an entirely separate
  connection row. This is harmless today because every current Throwback
  send sets its own `audience.channel_id` (the fallback is never reached for
  that connection), but it means the Throwback credential's channel_id is
  effectively stale/unused. Flagging for Matas — worth a data cleanup pass
  if a future Throwback send is ever scheduled without a per-send
  `channel_id`.
- No browser verification — this is a server-side provider with no UI
  surface; the DB probes above exercise the exact same code path the cron
  (`/api/cron/d2c-send`) uses when dispatching live sends.
