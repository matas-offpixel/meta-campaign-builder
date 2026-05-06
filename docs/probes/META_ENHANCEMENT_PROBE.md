# Meta enhancement spec probe

Transient **read-only** route that samples ACTIVE ads on a client’s Meta ad account and returns aggregated `degrees_of_freedom_spec.creative_features_spec` keys plus observed `enroll_status` values, raw samples, and ad-level `multi_advertiser_ads_options` fingerprints.

**Route:** `GET /api/admin/meta-enhancement-probe`

**Auth:** `Authorization: Bearer <CRON_SECRET>` **or** signed-in Supabase session whose user owns the client (`clients.user_id`).

**Query:** `clientId` (required, UUID) · `limit` optional (default 25, max 50).

**Example:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/admin/meta-enhancement-probe?clientId=<uuid>&limit=10"
```

Remove this probe (route + middleware bypass in `lib/auth/public-routes.ts` + this doc) once the enhancement-detector feature ships and ground-truth keys are no longer needed.
