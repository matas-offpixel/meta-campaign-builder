# scripts

One-off Node scripts for seeding and ingesting reference data into Supabase. All scripts use the service role key and are intended to be run locally by an operator, not from the app.

Usage pattern:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/<script>.mjs
```

Most seeders support `DRY_RUN=1` to log the rows they would write and exit without touching the DB.

---

## Seed runs (kept for traceability — append, do not rewrite)

### `seed-4thefans-wc26.mjs` — 2026-04-19

Seeded the **4theFans** client and the **World Cup 2026** group-stage FanPark event set under user `b3ee4e5c-44e6-4684-acf6-efefbecd5858` (hello@offpixel.co.uk).

- **Source:** MASTER tab of Matas's WC26 ad-pacing spreadsheet (not in repo). Capacities are Total Cap (venue cap × 3 group games) from MASTER!row 7. `budget_marketing` is Min Budget from MASTER!row 35 (current pace; ceiling is Max Budget in row 34, ~1.46× higher).

#### Client

| id                                     | name     | slug     | action  |
| -------------------------------------- | -------- | -------- | ------- |
| `37906506-56b7-4d58-ab62-1b042e2b561a` | 4theFans | 4thefans | created |

#### Events (15 inserted, 0 skipped)

| id                                     | event_code             | slug                              | capacity | budget_marketing |
| -------------------------------------- | ---------------------- | --------------------------------- | -------- | ---------------- |
| `f2f9d171-a1e8-43f0-aba7-bf47024b8cce` | WC26-Birmingham        | 4thefans-wc26-birmingham          | 4500     | 7687.50          |
| `4e7b5695-6c57-4462-b41b-188632e16dd4` | WC26-Bournemouth       | 4thefans-wc26-bournemouth         | 4050     | 6918.75          |
| `466c0859-eb00-4d05-9c95-450de6837d74` | WC26-Brighton          | 4thefans-wc26-brighton            | 15000    | 25625.00         |
| `2730cc1c-ead6-4692-bfa9-964c657ca6e0` | WC26-Bristol           | 4thefans-wc26-bristol             | 3960     | 6765.00          |
| `754939ca-2f8a-41c6-ac7e-0922675a31f4` | WC26-LONDON-KENTISH    | 4thefans-wc26-london-kentish      | 6900     | 11787.50         |
| `05226bb7-cec5-4916-9b6d-4bdcdca22758` | WC26-LONDON-SHEPHERDS  | 4thefans-wc26-london-shepherds    | 3015     | 5150.63          |
| `3cacb2ff-1a81-4306-bb42-952c7fd79969` | WC26-LONDON-SHOREDITCH | 4thefans-wc26-london-shoreditch   | 3120     | 5330.00          |
| `20ff1900-f50e-4673-8f30-794c8bb55c39` | WC26-LONDON-TOTTENHAM  | 4thefans-wc26-london-tottenham    | 3528     | 6027.00          |
| `0d13388d-d275-44c5-8bee-de3b8b85761a` | WC26-LEEDS             | 4thefans-wc26-leeds               | 5790     | 9891.25          |
| `4d313a04-1ab6-4b68-992b-760cf953dfc1` | WC26-MANCHESTER        | 4thefans-wc26-manchester          | 12000    | 20500.00         |
| `59b0dbaf-4b70-4f94-b79c-a82adf4c797e` | WC26-NEWCASTLE         | 4thefans-wc26-newcastle           | 6000     | 10250.00         |
| `755a97dc-45f4-48d4-8c60-6d38da129d82` | WC26-ABERDEEN          | 4thefans-wc26-aberdeen            | 3240     | 5535.00          |
| `4cdc68ab-2a97-40a8-b0c8-782c13f7eb12` | WC26-EDINBURGH         | 4thefans-wc26-edinburgh           | 3966     | 6775.25          |
| `a9373cf5-f43a-42f5-8ba3-7cecdf82ccee` | WC26-GLASGOW-SWG3      | 4thefans-wc26-glasgow-swg3        | 4080     | 6970.00          |
| `afe80561-3c21-4498-be2e-9e03876036e5` | WC26-GLASGOW-O2        | 4thefans-wc26-glasgow-o2          | 6750     | 11531.25         |

Note: London Shepherds' Min Budget is `5150.625` in source; `events.budget_marketing` is `numeric(12, 2)` so it's stored as `5150.63`.

#### Held back — flagged, NOT seeded

- **Margate (Drill Shed, intended `WC26-Margate`):** Max Budget and Min Budget both £0, no capacity in MASTER row 7. Confirm with Matas before inserting. Present as a commented-out row in the script — uncomment + re-run once resolved.

Ministry of Sound was originally on the held-back list but has been dropped entirely: it's externally promoted, not an Off Pixel campaign.

#### TODO — Shared-spend reconciliation (single follow-up slice)

Two architecturally identical problems, both flagged inline in the affected events' `notes` fields and to be solved together:

1. **Glasgow legacy spend.** Historical ad spend for both Glasgow venues ran under shared campaign names `[WC26-GLASGOW] TRAFFIC ADS / PRESALE / CONVERSION ADS / TEST / LPV` before the venues were split into `[WC26-GLASGOW-SWG3]` and `[WC26-GLASGOW-O2]`. The insights aggregator wraps `event_code` in brackets at query time (per migration 009 convention), so neither venue's report picks up the pre-split shared spend.
2. **London shared spend.** Ongoing shared spend for the 4 London venues (Kentish / Shepherds / Shoreditch / Tottenham) runs under a single `[WC26-LONDON]` campaign set. The bracket-wrap convention is significant — `[WC26-LONDON]` is a literal substring that does NOT collide with `[WC26-LONDON-KENTISH]` etc because of the closing bracket — so this shared spend lands in nobody's venue-specific report.

Both need a manual cost-allocation overlay per event. Out of scope for this seed.

#### Amendment — 2026-04-19 (post-seed)

- Dropped Ministry of Sound from the script (externally promoted).
- Added a London shared-spend note to the 4 London events. Patched live in DB via service role (the 4 London `events.notes` fields had the new sentence appended; the patch is idempotent — re-running it is a no-op). The script now applies the same note automatically on any future re-run.
