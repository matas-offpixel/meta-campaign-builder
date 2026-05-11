# Migrations Notes

## Versioning convention

Production Supabase tracks migrations by **timestamp-based versions** (`20260XXX_<name>`),
**not** the numeric filename prefix used in this folder. The numeric prefix (e.g. `001`, `068a`)
is a human-readability convention only — it has no effect on execution order in production.

## Intentional gaps

Migrations **021**, **043**, and **047** are missing. These are intentional gaps from
rolled-back early-development attempts. They are preserved as a historical record.
**Do NOT renumber** existing migrations to fill these gaps.

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
