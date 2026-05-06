# Session log — enhancement scanner per-client mode

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `creator/enhancement-scanner-per-client`

## Summary

Split enhancement scanner into per-client on-demand mode (session auth + `?clientId=`) and cron mode (all clients, 30 s delay between each, rate-limit errors skip to next cycle). Adds `last_probed_at` timestamptz on `clients` table, stamped after every successful scan.

## Scope / files

- `supabase/migrations/086_clients_last_probed_at.sql`
- `lib/db/database.types.ts` — `last_probed_at` on clients Row/Insert/Update
- `app/api/internal/scan-enhancement-flags/route.ts` — `scanOneClient()`, per-client auth, cron sequential, rate-limit detection

## Validation

- [x] `npm run build`
- [x] ESLint (no errors)

## Notes

- Cron must remain GET with `Authorization: Bearer CRON_SECRET` (Vercel Cron).
- Session-auth POST/GET with `?clientId=` is the on-demand path wired to the Re-scan button (next PR).
- Rate-limit detection keys on Meta error code 80004 + message substring.
