# Session log — upload-asset service-role storage read

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/upload-asset-service-role-storage-read`

## Summary

Root cause of "Failed to access stored file: Object not found" confirmed via PR #534 diagnostics:
the `campaign-assets` bucket has an INSERT RLS policy but no SELECT policy. Supabase Storage
returns "Object not found" for RLS-denied reads (security through obscurity), so PR #533's retry
loop never helped — the denial was deterministic, not transient.

Fix: `createSignedUrl` and all object-deletion cleanup calls now use `createServiceRoleClient()`
instead of the cookie-bound `createClient()`. Auth is still enforced at the top of the route;
service-role is scoped only to the two storage operations (signed URL + cleanup) that require
bypassing RLS.

No SELECT RLS policy was added to the bucket — that would allow any authenticated user to read
other users' uploads by path. The service-role-on-authenticated-route pattern is the correct one
here (same as the public share route in this codebase).

Also carries over `maxDuration = 300` from PR #534 (defensive against Vercel timeout on large
uploads) and removes the now-redundant diagnostic breadcrumbs from #534, keeping only the two
that remain useful (`[upload-asset] start` and `[upload-asset] Meta upload threw`).

## Scope / files

- `app/api/meta/upload-asset/route.ts`
  - Import `createServiceRoleClient` alongside `createClient`
  - Add `const storage = createServiceRoleClient()` after auth check
  - `createSignedUrl` → `storage.storage.from(...)` (single call, no retry loop)
  - Validation cleanup → `storage.storage.from(...)`
  - `cleanup()` helper → `storage.storage.from(...)`
  - Remove retry loop (RLS denial is not transient)
  - Remove dead diagnostic logs from PR #534
  - Retain `maxDuration = 300` and `[upload-asset] start` / `Meta upload threw` logs

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [ ] Dual-video upload at `/campaign/[draft-id]` → Creatives → Dual (4:5 + 9:16) → Bulk Upload

## Notes

- `SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel prod env vars (already is — used by share route).
- The retry loop from PR #533 is removed: its premise (propagation race) was wrong. The real
  cause was a hard RLS denial, which retrying can never resolve.
