# Migrations Notes

## Versioning convention

Production Supabase tracks migrations by **timestamp-based versions** (`20260XXX_<name>`),
**not** the numeric filename prefix used in this folder. The numeric prefix (e.g. `001`, `068a`)
is a human-readability convention only — it has no effect on execution order in production.

## Intentional gaps

Migrations **021**, **043**, and **047** are missing. These are intentional gaps from
rolled-back early-development attempts. They are preserved as a historical record.
**Do NOT renumber** existing migrations to fill these gaps.

Migration **131** (`131_enable_pgcrypto_for_d2c_credentials`, prod timestamp
`20260701223108`) exists **only in the prod ledger** — it was applied directly
via the Supabase MCP on 2026-07-01 to enable pgcrypto in the `extensions`
schema and has no repo file. Do not reuse the number.

> **pgcrypto schema note (2026-07-04):** despite 131's name, pgcrypto now
> lives in **`public`** — the D2C direct-fire ops fix (2026-07-01 night)
> moved it after 131 installed it in `extensions`. It has occupied both
> schemas within one week. Any migration calling `pgp_sym_*` must work with
> EITHER placement (`set search_path = public, extensions` + unqualified
> calls — the migration 134 pattern). Never single-schema-qualify.

Migration **149** (`149_bm_page_task_audit.sql`) is recorded in the prod ledger
under the name **`148_bm_page_task_audit`** (timestamp `20260728205821`). Two
threads claimed 148 on the same evening — a thumbnail-hash index at 20:30 and
this one at 20:58 — and the file was renumbered to 149 afterwards so this folder
stays ordered. The ledger entry was left as applied, per the convention above
that the numeric prefix carries no execution meaning.

## 068a–e collision resolution (May 2026)

Five migration files previously had numeric collisions at prefixes `068` and `069`.
They were renamed with letter suffixes to preserve chronological order matching
their production timestamps:

| Filename | Production timestamp | Date |
|---|---|---|
| `068a_creative_tag_assignment_model_version.sql` | 20260502_… | May 02, 2026 |
| `068b_event_funnel_targets.sql` | 20260503_… | May 03, 2026 |
| `068c_meta_custom_audiences.sql` | 20260505_… | May 05, 2026 |
| `068d_ticket_sales_snapshots_fourthefans_source.sql` | 20260506_… | May 06, 2026 |
| `068e_creative_thumbnails_bucket.sql` | 20260508_… | May 08, 2026 |

## schema.sql

`supabase/schema.sql` is **auto-regenerated from production** via
`npx supabase db dump --schema public`. Do not hand-edit it.

If the filename order in this folder ever diverges from production timestamps after
a future addition, fix the filename prefix here — do not alter production.
