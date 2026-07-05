# Session log — OP909 Phase 10: LP editor preview mode

## PR

- **Number:** 684
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/684
- **Branch:** `cursor/admin-p10-preview`

## Summary

`?preview=1` on `/l/{clientSlug}/{eventSlug}` lets the page's OWN
client admin see draft/archived state, gated by a session-cookie
membership check (client_users → LP's client_id). A fixed mono
"PREVIEW — DRAFT/ARCHIVED" badge marks the view; the admin Preview
links (pages list + editor top bar) now carry the param so drafts are
previewable where they previously 404'd. Anonymous / wrong-client /
broken sessions fall through to the public behaviour — no leak.

## Scope / files

- `lib/landing-pages/resolve.ts` — `opts.preview` bypasses the status
  gate only (null context / evntree branches unchanged).
- `app/l/[clientSlug]/[eventSlug]/page.tsx` — reads `searchParams`,
  verifies via `isOwnClientAdmin` (session-bound client +
  `resolveClientMembership`, migration-137 self-read RLS; never
  service-role), renders the fixed badge in the route wrapper —
  `components/landing-pages/*` untouched (renderer stays locked).
- `components/admin/page-editor.tsx`,
  `app/admin/[clientSlug]/pages/page.tsx` — Preview links append
  `?preview=1`.
- `lib/landing-pages/__tests__/resolve.test.ts` — +5 cases: draft +
  preview renders, archived + preview renders, preview:false is not a
  bypass, preview never resurrects a 404, live + preview unchanged.

## Deviation from spec

Spec floated `?draft=1&preview_token={session-scoped-jwt}` but defined
verification as "session cookie belongs to a matching client_users
row" — the cookie already flows on same-origin navigation, so the JWT
adds attack surface without adding proof. Implemented cookie-check-only
`?preview=1`.

## Validation

- [x] `node --test` resolve suite green (12 tests incl. 5 new);
  tsc clean on touched files; eslint clean; `npm run build` clean
- [x] Browser (GMC, local dev against prod DB): created a throwaway
  DRAFT page via SQL → logged-in admin at `?preview=1` got the rendered
  page with the "PREVIEW — DRAFT" badge (DOM-verified fixed top-right,
  10px mono); anonymous curl → 404 both with and without `?preview=1`.
  Test event + page_event rows deleted after (verified 0 remaining).

## Notes / landmines

- Signup POSTs on previewed non-live pages still 404 by design
  (signup-handler's own status gate, Phase 3) — preview is read-only.
- `/l` route was already dynamic (`headers()` for rate limiting), so
  reading `searchParams`/cookies adds no caching regression.
