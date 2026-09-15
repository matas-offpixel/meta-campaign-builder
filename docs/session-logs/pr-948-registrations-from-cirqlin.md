# Session log — registrations from Cirqlin

## PR

- **Number:** 948
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/948
- **Branch:** `cursor/registrations-from-cirqlin-81ca`

## Summary

REGISTRATIONS means Cirqlin signups. The dashboard had no Cirqlin read,
so the card could only ever show a Mailchimp segment count. This adds a
partner-read client, an additive snapshot table, a Cirqlin leg on the
Mailchimp refresh and EOD cron (failure there does not fail Mailchimp),
a Cirqlin-first card (Mailchimp as the named secondary line), signup-
phase cost per signup, and a tracker REGS column that prefers Cirqlin
per-day counts when those snapshots exist.

The Cirqlin-side partner endpoint lives in `matas-offpixel/cirqlin` and
could not be opened from this environment — that repository is not
visible to this agent. The dashboard client is written against the
agreed payload.

`#947` squash-merged while this work was in flight. The first push was
on `cursor/registrations-from-cirqlin` cut from that branch; this PR
is the same commit cherry-picked onto `main`.

Round 2: the card reads `snapshot_at`. Fresh (≤48h) is current;
older is `1,843 signups · Cirqlin · as of 15 Sept`. `unauthorized`
/ `error` do not write a London-today row (that unique key is the
live count). They upsert a `1970-01-01` failure marker so a
first-time miss still has a sentence after reload, and they ping
`ads_ops` once per `cirqlin_sync_failed:<eventId>:<reason>` with
`respectBusinessHours: false` so the 23:55 EOD run can fire.
`not_configured` writes nothing and does not alert. The dead
`mailchimpTagged` input is gone — the card's Mailchimp line is
`1,686 subscribed in Mailchimp`. Fetch times out. The EOD Cirqlin
loop measures from request start (Mailchimp shares the 300s
`maxDuration`) and stops 30s before the kill, reporting
`cirqlinLeft`. CPR at counted 0 still renders. The CPR label names
all-platform spend. `no_page` sentinel days use Europe/London.
`isCirqlinSignupsPayload` rejects `NaN` and malformed `daily[]`.
Migration 177's events-join read policy is documented as
deliberate. Check-run conclusions live in the PR thread, not in a
commit that records them.

Round 3: the timeout stays armed through `res.json()` and the abort
signal tears down a stalled body — a 200 whose body never arrives
reports `error` within `CIRQLIN_FETCH_TIMEOUT_MS`. `no_page` writes
the reserved day, not London-today, so it cannot hide 1,843. Failure
markers on that day are ordered by `snapshot_at`, so a stale
`no_page` does not outrank a fresh `unauthorized`. `cirqlinAsked` is
gone. `dedupeWindowMs` is `Number.MAX_SAFE_INTEGER` on the alert.
`not_configured` is a fetch reason only — it is not a persisted
sentinel. The PR body no longer says the client uses
`AbortSignal.timeout`.

## Scope / files

- `lib/cirqlin/*` — client, snapshot mapping, sync, tracker helpers
- `supabase/migrations/177_signup_source_snapshots.sql`
- Mailchimp refresh + EOD cron Cirqlin legs
- REGISTRATIONS card model + venue / share / event-report wiring
- Daily tracker REGS source chain: Cirqlin → Mailchimp → Meta
- `CIRQLIN_PARTNER_READ_SECRET` / `CIRQLIN_API_BASE` in `CLAUDE.md`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build` TypeScript step)
- [x] `npm test` — 5922 pass / 0 fail / 4 skipped (round 3)
- [x] `npm run build` — compiled, typecheck finished, 193 static pages (round 3)
- [ ] Check-run conclusions on the final head — PR thread, not a commit

## Notes

Migration 177 must be applied to prod before this PR merges.
`computeRegistrationsData` is unchanged; Cirqlin sits beside it.
`evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched.
Do not merge until the Cirqlin partner route is live.
