# Migration drift audit — 2026-06-29

**Trigger:** P0 incident (PR #639, 2026-06-29). `migration 042_d2c_encrypted_credentials`
was missing from the prod ledger; its absence caused `column d2c_connections.live_enabled does
not exist` on every `/clients/{id}` render, contributing to 504s.

**Method:** `ls supabase/migrations/*.sql` compared against
`SELECT version, name FROM supabase_migrations.schema_migrations` on project
`zbtldbfjbhfvpksmdvnt`. Names normalised (numeric prefix stripped for matching),
then DB state cross-checked for each ambiguous entry.

---

## Migrations on disk but absent from prod ledger

### Applied in this audit session

| File | Risk | DB state before | Action | Outcome |
|------|------|-----------------|--------|---------|
| `075_additional_ticket_entries_running_total_key` | **DDL gap** — unique index `additional_ticket_entries_natural_key_idx` missing; duplicate running-total snapshots could silently accumulate and overcount tickets | Index absent; 0 current dups | Applied via MCP | Index confirmed present |
| `088_cl_final_tier_channel_backfill` | DML only — INSERT WHERE NOT EXISTS for 4TF26-ARSENAL-CL-FL 4TF channel sales | Event code exists (6 rows); `WHERE NOT EXISTS` guard means 0 rows inserted (sync had already written them) | Applied via MCP | In ledger; 0 new rows (idempotent) |
| `108_ironworks_spark_backfill_2` | DML only — DELETE null-thumbnail TikTok rows for Ironworks Spark event | 0 null-thumbnail rows (already cleaned by cron) | Applied via MCP | In ledger; 0 rows deleted (idempotent no-op) |

### Pre-history (applied before migration tracking started — no action needed)

These files predate the `supabase_migrations.schema_migrations` table being used.
All underlying schema objects (tables, columns) are confirmed present in prod.

| File | Object confirmed present |
|------|-------------------------|
| `001_add_snapshot_json_to_templates` | `campaign_templates.snapshot_json` ✓ |
| `002_user_facebook_tokens` | `user_facebook_tokens` table ✓ |
| `004_facebook_token_expires_at` | `user_facebook_tokens.expires_at` ✓ |
| `005_ad_plans` | `ad_plans` table ✓ |
| `006_event_favourite` | `event_favourite` column ✓ |
| `007_ad_plan_day_ticket_target` | `ad_plan_day_ticket_target` column ✓ |
| `008_event_key_moments` | `event_key_moments` table ✓ |
| `009_meta_fields` | `meta_fields` on campaigns ✓ |

### Name discrepancies — same content, different ledger name (no action needed)

Prod applied these migrations under slightly different names (e.g. without the
numeric prefix, or with a minor wording change). All underlying schema objects
confirmed present.

| Local file | Prod ledger name | Notes |
|------------|-----------------|-------|
| `037_share_insight_snapshots_nulls_not_distinct` | `037_share_snapshots_nulls_not_distinct` | Same SQL, minor name trim |
| `067_snapshot_build_version` | `share_insight_snapshots_build_version` + `active_creatives_snapshots_build_version` | Split into two entries; both `build_version` cols confirmed ✓ |
| `096_creative_tag_assignment_thumbnail_hash` | `099_creative_tag_assignment_thumbnail_hash` | Renumbered by CC |
| `114_asset_queue_umbrella_events` | (columns exist; applied via a combined migration) | `resolved_event_codes_multi` col + `matched_umbrella` enum value both ✓ |
| `116_asset_queue_multi_file_funnels` | `116_asset_queue_multi_file_umbrella_funnels` | Name extended; `asset_blob_urls`, `funnels` cols both ✓ |
| `118_event_mailchimp_tag` | `118_event_mailchimp_tag_no_expr_idx` + `119_mailchimp_tag_snapshots_unique_constraint` + `120_mailchimp_tag_snapshots_event_snapshot_at_unique` | Expression index was split out; `mailchimp_tag` col + `mailchimp_tag_snapshots` table both ✓ |

---

## Prod-only entries (in ledger, no local file)

These were applied directly via ops/CC without a corresponding file committed to
`supabase/migrations/`. This is expected for one-off fixes and seed data.

| Ledger name | Notes |
|-------------|-------|
| `021_client_billing_customization` | Client billing fields — applied at project setup |
| `070_meta_reconciliation_function` | Meta reconciliation RPC — applied by CC |
| `090_clients_meta_system_user_token` | Meta system user token on clients — applied by CC |
| `118_raise_campaign_assets_file_size_limit` | Storage bucket size limit increase |
| `119_mailchimp_tag_snapshots_unique_constraint` | Follow-up to local 118 (see above) |
| `120_mailchimp_tag_snapshots_event_snapshot_at_unique` | Follow-up to local 118 (see above) |
| `event_daily_ticket_history` | Per-day ticket history table — applied by CC |
| `042_d2c_encrypted_credentials` (×2) | Applied twice in P0 session; idempotent, cosmetic duplicate |
| `122_portal_timeout_covering_indexes` | From P0 PR #639 (not yet merged to main at audit time) |

---

## Final state

After applying the three missing migrations, re-running the diff yields no
remaining on-disk migrations with an unaccounted-for ledger entry. All residual
gaps are pre-history (schema objects confirmed present) or name-discrepancy
matches.

**One structural gap was closed:** `additional_ticket_entries_natural_key_idx`
is now present and enforcing running-total uniqueness. Without it, concurrent
syncs or reimports could silently accumulate duplicate rows and overstate ticket
counts in the per-event sidebar.

---

## Process recommendations

1. **Use `apply_migration` (or `supabase db push`) for every DDL change**, even
   one-liners. Never write directly to prod without a corresponding file on disk —
   it creates hidden state that only shows up when something breaks.
2. **Audit before every large feature push:** run `list_migrations` and diff
   against `ls supabase/migrations/` in CI or as a pre-deploy check.
3. **One file = one ledger entry:** avoid renaming files after the fact. The
   `037` / `067` / `116` / `118` discrepancies show that ad-hoc renames create
   false gaps in the diff that require manual reconstruction.
4. **Avoid applying the same migration twice** (042 was recorded twice in the
   P0 session). Always check `list_migrations` before `apply_migration` in an
   incident response.
