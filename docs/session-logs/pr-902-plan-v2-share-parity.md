# Session log

## PR

- **Number:** 902
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/902
- **Branch:** `cursor/plan-v2-share-parity`

## Summary

Canon §1.6 share-link parity. `/share/plan/[token]` opens one plan, never the list, and renders LAUNCH (read-only), ADJUST and LEARN under `role=client` with the same components. No switcher, no marker. Controls (Launch, unit picker, drawer edit, suggestion / do it / not now / undo) are absent; exhibits stay. System sentences go through `VIZ_CLIENT_SAFE`. `/share/` was already public — PUBLIC_PREFIXES is unchanged. The token is the credential.

## Scope / files

- `lib/plan/share-role.ts` — `planShareControls` (the view the workspace calls)
- `lib/plan/share-tokens.ts` + `supabase/migrations/171_plan_share_tokens.sql` — 16-char token, enabled, `can_edit=false`
- `lib/plan/share-load.ts` + `app/share/plan/[token]/page.tsx` — one-plan public route
- `components/plan/plan-share-action.tsx` — operator `share ↗` / revoke
- `components/plan/plan-workspace.tsx` — `role=client` skips persist and operator fetches
- Face surfaces: launch / target / channels / budget / window / assets / header
- `lib/plan/__tests__/share-parity.test.ts` — controls, faces, route, allow-list

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5300 pass, 4 skipped)
- [x] Review round 1: `share-parity` + `public-routes` + `launch-face` (53 pass)

## Notes

Merge after A → B → C. Apply 171 with this PR (after 169 / 170).

## Review round 1 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| `/share/plan/[id]` treated the plan uuid as the credential on a public prefix | `app/share/plan/[token]/page.tsx` `resolvePlanShareToken`; `171_plan_share_tokens.sql` | `share path is a 16-char token, never a plan uuid`; `resolves an enabled token and 404s uuid / disabled / unknown` |
| Tests asserted `/share/plan/<uuid>` public | `lib/plan/__tests__/share-parity.test.ts`; `lib/auth/__tests__/public-routes.test.ts` | both now assert `/share/plan/abcdefghijklmnop`; uuid fails `isPlanShareToken` |
| No mint / revoke | `components/plan/plan-share-action.tsx` `share ↗` / `revoke`; `app/api/plan/[id]/share/route.ts` | `is under /share/plan/[token]` matches `share ↗` and `PlanShareAction` |
