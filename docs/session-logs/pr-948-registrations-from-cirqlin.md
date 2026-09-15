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

## Scope / files

- `lib/cirqlin/*` — client, snapshot mapping, sync, tracker helpers
- `supabase/migrations/177_signup_source_snapshots.sql`
- Mailchimp refresh + EOD cron Cirqlin legs
- REGISTRATIONS card model + venue / share / event-report wiring
- Daily tracker REGS source chain: Cirqlin → Mailchimp → Meta
- `CIRQLIN_PARTNER_READ_SECRET` / `CIRQLIN_API_BASE` in `CLAUDE.md`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build` TypeScript step)
- [x] `npm run build` — compiled, typecheck finished, 193 static pages
- [x] `npm test` — 5904 tests, 5900 pass, 0 fail, 4 skipped
- [x] GitHub CI on `23930955` — 6/6 green (`npm test`, `npm run build`, `frames:check`, two Vercel previews, Vercel Preview Comments)

## Notes

Migration 177 must be applied to prod before this PR merges.
`computeRegistrationsData` is unchanged; Cirqlin sits beside it.
`evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched.
Do not merge until the Cirqlin partner route is live.
