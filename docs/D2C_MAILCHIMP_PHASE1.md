# D2C Mailchimp — Phase 1 (API key + encrypted credentials)

## Enable live sends for a client (e.g. Jackies)

1. Set `D2C_TOKEN_KEY` in Vercel (and locally) — same class of secret as `EVENTBRITE_TOKEN_KEY` (random, ≥32 chars).
2. Apply migration `042_d2c_encrypted_credentials.sql` to Supabase; regenerate types if your workflow requires it.
3. Save the Mailchimp connection in the client **D2C** tab (POST validates `/3.0/ping` before persisting).
4. Turn on **Live enabled** and **Matas approved** for that connection in the same tab (or PATCH `/api/d2c/connections/{id}/live`).
5. Set `FEATURE_D2C_LIVE=true` in Vercel **only after** the above — this is a manual post-deploy step (do not commit it in env example files for production defaults).
6. Add Matas’s Supabase user id to `MATAS_USER_IDS` in `lib/auth/operator-allowlist.ts` so scheduled sends can be approved in the UI.
7. Schedule a send on the event **Comms** page; an allowlisted operator clicks **Approve & schedule**; cron `/api/cron/d2c-send` (every 5 minutes) picks up approved rows whose `scheduled_for` is due.

Cross-thread: persistence lists and `CLAUDE.md` env documentation are owned by **Ops** — see the open D2C PR description under “Cross-thread asks for Ops”.

## Rollback

- Turn off `FEATURE_D2C_LIVE` (or set to false) — all Mailchimp `send` paths return dry-run results.
- Uncheck **Live enabled** / **Matas approved** on the connection — triple-gate dry-run blocks live API calls even if the env flag is mis-set.
- To reverse migration 042: drop the new columns and functions in a follow-up migration (avoid dropping in production without backing up `credentials_encrypted`). Safer rollback is **disable flags** above rather than schema revert.

## Mailchimp errors we surface

| Situation | App behaviour |
|-----------|----------------|
| HTTP **401 / 403** from Marketing API | Treated as auth failure; cron may set connection `status=error` and `last_error`. |
| HTTP **5xx** | `mailchimpFetch` retries once after 2s; then bubbles as send failure. |
| Schedule time in the past | Provider falls back from `actions/schedule` to `actions/send`. |
| Missing `audience.list_id` or `reply_to` | Send returns `ok: false` before calling Mailchimp. |

OAuth / long-lived tokens are **Phase 2** — see TODO in `lib/d2c/mailchimp/provider.ts`.
