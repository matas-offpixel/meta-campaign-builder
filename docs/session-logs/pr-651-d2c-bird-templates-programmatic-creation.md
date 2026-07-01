# Session log — D2C Bird Studio programmatic template creation

## PR

- **Number:** 651
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/651
- **Branch:** `d2c/bird-templates-programmatic-creation`

## Summary

Reverse-engineered Bird's **internal Studio** channel-template API and built a
typed, cross-brand system to create WhatsApp templates programmatically: wire +
declarative types, a typed client (reusing the existing AccessKey client), a pure
fluent builder, brand definitions (Throwback, Jackies), a shared idempotent
runner, a CLI, and an admin API trigger. Shipped 5 templates as Bird drafts.

## Scope / files

- `lib/d2c/bird/templates/` — `types.ts`, `client.ts`, `builder.ts`, `runner.ts`,
  `definitions/{throwback,jackies,index}.ts`, `__tests__/{builder,integration}.test.ts`
- `scripts/d2c/ship-bird-templates.ts` — CLI
- `app/api/admin/d2c/bird-templates/route.ts` — admin POST (MATAS_USER_IDS / CRON_SECRET)
- `docs/audits/D2C_BIRD_TEMPLATES_API_AUDIT_2026-06-30.md` — reverse-engineering audit + probe log
- `docs/D2C_BIRD_TEMPLATE_AUTOMATION.md` — usage + rollback
- `.gitignore` — ignore `.scratch/` + root reverse-engineering scripts (contain a key)

## Validation

- [x] `npm run build` — passes (route `/api/admin/d2c/bird-templates` registered)
- [x] `npx eslint <new files>` — clean
- [x] builder unit tests — 12/12 pass (`node --experimental-strip-types --test`)
- [x] integration test — passes against live Bird probe project (create → idempotency → cleanup)
- [x] CLI dry-run + live ship + idempotency-skip re-run — verified

## Probe budget

7 template creates + ~3 project creates, **all deleted/withdrawn** (every DELETE → 204),
**zero reached Meta** (all stayed `draft`). Cap was 20.

## Templates shipped (drafts)

| Template | Bird id | Project id |
|---|---|---|
| throwback_autoresp | 2f0db67d-7823-4ac4-9a48-19d3454c93a7 | f8e4e0e5-41ef-4073-b050-0ebdd6b8c766 |
| throwback_presale_reminder | d09973c1-6c61-4cab-95bd-0502e80d1190 | 9ee48546-1ae4-44b0-b105-0918a43fa167 |
| jackies_presale_live | 024b8706-26ee-4322-9b83-281f6f985930 | 01cd061c-7d56-453c-8dc1-08e604e3cac3 |
| jackies_autoresp | fe00fdaa-2b68-4cf7-9913-855a9cdf4659 | 2818faaf-1433-4983-a579-cba8c3b410ea |
| jackies_presale_reminder | 02d9b563-6944-4041-816d-b21db691f754 | b7314a0b-3ce9-4130-93be-7470aa2279e5 |

## Notes / follow-ups

- **BLOCKER (U8):** programmatic *submit-to-Meta* is not yet solved — a create only
  stages a draft; the Studio "Submit for approval" click is a separate request not in
  the capture (probing ruled out sub-routes/PUT-PATCH/async/deployments). All 5 drafts
  are submit-ready (WABA attached) — submit in Bird Studio (one click each). To automate:
  capture that request and add `publishTemplate()`; the `--submit` flag is pre-wired.
- Discovered: Bird allows only ONE draft per project → tool uses one project per template.
- Cross-thread asks for Ops (CLAUDE.md env-var docs) are in the PR description.
