# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-refresh-cron-secret-auth`

## Summary

Adds `Bearer CRON_SECRET` auth to `POST /api/events/[id]/mailchimp/refresh`
so ops batch scripts can fire refreshes without a browser session. The
existing session-cookie path (in-app "Sync now" button) is unchanged. Bearer
auth skips the per-user ownership check — the service-role client still
verifies the event exists. Also adds a regex middleware carve-out for the
path so the proxy doesn't redirect bearer-only curls to `/login` before the
handler runs (same lesson as PR #407, #411, #479 etc.).

## Scope / files

- `app/api/events/[id]/mailchimp/refresh/route.ts` — dual-auth block: bearer
  checked first (cheap), session fallback if no/wrong bearer header.
- `lib/auth/public-routes.ts` — regex carve-out for
  `/api/events/{id}/mailchimp/refresh` in `isPublicPath`.

## Validation

- [x] `npm run build` — clean, no TypeScript errors

## Notes

Post-deploy test (replace with your own event UUID):
```bash
curl -X POST "https://app.offpixel.co.uk/api/events/14d55718-ffa5-490e-b555-2423bc22f05e/mailchimp/refresh" \
  -H "Authorization: Bearer $CRON_SECRET" \
  --http1.1 --max-time 30
```
Expected: `{"ok":true,"snapshot":{...}}`. If 401 comes back the middleware
carve-out is still missing — check `isPublicPath` in `lib/auth/public-routes.ts`.
