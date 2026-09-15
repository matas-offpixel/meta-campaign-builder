# Session log — registrations from Cirqlin

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/registrations-from-cirqlin`

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

## Scope / files

- `lib/cirqlin/*` — client, snapshot mapping, sync, tracker helpers
- `supabase/migrations/177_signup_source_snapshots.sql`
- Mailchimp refresh + EOD cron Cirqlin legs
- REGISTRATIONS card model + venue / share wiring
- Daily tracker REGS source chain: Cirqlin → Mailchimp → Meta
- `CIRQLIN_PARTNER_READ_SECRET` / `CIRQLIN_API_BASE` in `CLAUDE.md`

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm test`

## Notes

Migration 177 must be applied to prod before this PR merges.
`computeRegistrationsData` is unchanged; Cirqlin sits beside it.
`evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched.
