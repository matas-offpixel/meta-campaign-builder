# Session log — D2C full send orchestration

## PR

- **Number:** 652
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/652
- **Branch:** `d2c/full-send-orchestration` (worktree `~/worktrees/d2c-orchestration`)

## Summary

Completes D2C send-time orchestration end-to-end. Wires Bird template
**activate** (publish to Meta) and ships the 5 production templates to `pending`;
mirrors the Bird templates architecture for **Mailchimp templates** (types /
client / builder / brand definitions / CLI / admin route) and ships 5 Jackies
templates; migrates Mailchimp credentials to encrypted `d2c_connections` with an
env fallback; and adds a **job-type-aware orchestration layer** (Mailchimp +
Bird) wired into the `d2c-send` cron behind the 3-of-3 dry-run gate.

## Scope / files

- Phase 1 — `lib/d2c/bird/templates/client.ts` (`activateTemplate`), `runner.ts`,
  `scripts/d2c/ship-bird-templates.ts` (`--submit`), `delete-bird-template.ts`,
  reworded `presale_reminder` bodies.
- Phase 2 — `lib/d2c/mailchimp/templates/**` (types/client/builder/definitions/
  runner), `scripts/d2c/ship-mailchimp-templates.ts`,
  `app/api/admin/d2c/mailchimp-templates/route.ts`.
- Phase 3 — `lib/d2c/mailchimp/credentials.ts`,
  `scripts/d2c/seed-jackies-mailchimp-connection.ts`.
- Phases 4/5 — `lib/d2c/orchestration/**`, cron `app/api/cron/d2c-send/route.ts`.
- Phase 6 — `docs/D2C_FULL_ORCHESTRATION.md`,
  `docs/D2C_MAILCHIMP_TEMPLATE_AUTOMATION.md`, updated
  `docs/D2C_BIRD_TEMPLATE_AUTOMATION.md`.

## Validation

- [x] `npx tsc --noEmit` — 0 errors in d2c code (362 pre-existing errors are all
  `@types/jest`-missing test files, untouched).
- [x] `npm run build` — passes (real `node_modules`; package.json/lock untouched).
- [x] `node --test` — 34 d2c unit tests green (activate, mailchimp builder/client,
  orchestration dry-run).

## Notes / follow-ups

- **Bird runtime send is the one blocker:** the Studio template API is verified,
  but the runtime send-to-audience (broadcast + `scheduledFor`) payload isn't
  captured, so live Bird sends fail loudly. Needs a DevTools capture to unblock.
- **Throwback Mailchimp templates defined but not shipped** — no
  `THROWBACK_MAILCHIMP_API_KEY`.
- **Seed script not run locally** — `D2C_TOKEN_KEY` absent in this env; run in a
  keyed env (Vercel) to populate the Jackies `d2c_connections` row.
- **`presale_reminder` copy reworded** to satisfy Meta's no-leading-variable
  rule — needs Matas sign-off.
- Worktree hygiene: isolated worktree off fresh `origin/main`; no shared-root
  edits.
