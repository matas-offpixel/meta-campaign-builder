# Session log — client channel identity defaults (M.1)

## PR

- **Number:** 860
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/860
- **Branch:** `cursor/client-channel-identity-defaults`

## Summary

Per-client channel identity defaults so every plan stops re-asking for
identities the business already knows. Existing account FKs stay canonical;
migration 160 only adds IG actor + TikTok identity. Resolver is honest unset.
Plan prepare / preflight consume defaults; blockers name the client-settings
cure when unresolved.

## Scope / files

- `supabase/migrations/160_client_channel_identity_defaults.sql` — file only, not applied
- `lib/clients/channel-defaults.ts` — resolve / load / apply / cure
- `lib/plan/preflight.ts` + `app/api/plan/preflight/route.ts`
- `app/api/plan/[id]/prepare-draft/route.ts`
- `app/api/clients/[id]/route.ts`
- `components/dashboard/clients/channel-defaults-card.tsx` + `client-detail.tsx`
- `components/plan/plan-workspace.tsx` — href on cure blockers
- `components/steps/creatives.tsx` — auto-pick mark
- `lib/types.ts` — `channelDefaultsApplied`

## Validation

- [x] eslint on changed files: 0 errors (creatives.tsx warnings pre-existing)
- [x] `npx tsc --noEmit` — no new errors in this change set
- [x] `npm run build` — compiled + TS finished
- [x] `npm test` — 4577 / 4574 pass / 3 skipped / 0 fail

## Notes

- Inventory and consumer wiring live in the ship report / PR body.
- Do not apply migration 160 in this run.
