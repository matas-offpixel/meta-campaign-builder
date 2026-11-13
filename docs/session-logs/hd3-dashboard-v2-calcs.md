# Session log — HD3, dashboard v2 server calcs

## PR

- **Branch:** `cc/dashboard-v2-calcs` (Claude Code)
- **Record:** `docs/design-record/2026-11-13-dashboard-v2.html` (D2, D4, D5, D6, D10, D12, D13, HD3)

## Parity with the model, 12 Nov data (full table)

Produced by `PARITY_OUT=… node --conditions react-server --experimental-strip-types --test lib/dashboard/__tests__/sales-calc-parity.test.ts`.
The model's calcs (artifact 1WbbWGeA1hvTfx7dkS9duj, page v13) are ported in `lib/dashboard/__tests__/sales-calc-model-reference.ts`
and run on the same rows as the server calc (`fixtures/sales-12-nov.json`, read from prod on 13 Nov, reads only; counts = the model's
Internal Counts CSV v6 and reference CSV; signups = the model's CIRQLIN rollups by its slug list). The fixture's Meta spend per show
matches the model's `meta_daily` SQL run on 13 Nov to the penny (asserted).

Rules: D12 all channels · D13a since-launch CPT capped at latest count · D13b straddling window pro-rated · D13c daily £/registration
only inside the signup window · D6 projection capped at allocation · D10 library cases · ALL (not ruled; see PR body).
Part B adds: COUNT (the live Internal Counts differ from the CSV on a day the figure depends on) · D8 paid only · FINAL (latest count on or after show day).

7338 figures compared; 7195 match; 143 differ, each by a rule.

| Show | Figure | Model | Server | Rule |
|---|---|---|---|---|
| NX26-EED | spend, all channels · since launch | 2753.69 | 2767.29 | D12 |
| NX26-EED | cost per ticket, all channels · since launch | 1.59 | 1.60 | D12 |
| NX26-IPC | spend, all channels · since launch | 2613.68 | 2631.85 | D12 |
| NX26-IPC | cost per ticket, all channels · since launch | 1.43 | 1.44 | D12 |
| NX26-GLOBAL | spend, all channels · since launch | 3854.28 | 4220.45 | D12 |
| NX26-ROBBIEDOHERTY | spend, all channels · since launch | 2220.57 | 2220.75 | D12 |
| NX26-ROBBIEDOHERTY | cost per ticket, all channels · since launch | 4.47 | 4.47 | D12 |
| NX26-LOCKLEAD | spend, all channels · since launch | 1506.80 | 1518.80 | D12 |
| NX26-LOCKLEAD | cost per ticket, all channels · since launch | 4.05 | 4.08 | D12 |
| All shows | spend, all channels · since launch | 16736.19 | 16780.14 | D12 |
| All shows | cost per ticket, all channels · since launch | 1.96 | 1.97 | D12 |
| NX26-EED | spend, all channels · 30 days | 59.43 | 73.03 | D12 |
| NX26-EED | cost per ticket, all channels · 30 days | 0.09 | 0.11 | D12 |
| NX26-IPC | spend, all channels · 30 days | 70.81 | 88.98 | D12 |
| NX26-IPC | cost per ticket, all channels · 30 days | 0.26 | 0.33 | D12 |
| NX26-GLOBAL | spend, all channels · 30 days | 1641.28 | 2007.45 | D12 |
| NX26-ROBBIEDOHERTY | spend, all channels · 30 days | 984.03 | 984.21 | D12 |
| NX26-ROBBIEDOHERTY | cost per ticket, all channels · 30 days | 4.19 | 4.19 | D12 |
| NX26-LOCKLEAD | spend, all channels · 30 days | 1506.80 | 1518.80 | D12 |
| All shows | spend, all channels · 30 days | 4642.73 | 4686.68 | D12 |
| All shows | cost per ticket, all channels · 30 days | 0.89 | 0.90 | D12 |
| NX26-EED | spend, all channels · 14 days | 28.52 | 41.22 | D12 |
| NX26-EED | cost per ticket, all channels · 14 days | 0.06 | 0.09 | D12 |
| NX26-IPC | spend, all channels · 14 days | 40.05 | 56.02 | D12 |
| NX26-IPC | cost per ticket, all channels · 14 days | 0.59 | 0.82 | D12 |
| NX26-GLOBAL | spend, all channels · 14 days | 550.05 | 696.14 | D12 |
| NX26-ROBBIEDOHERTY | spend, all channels · 14 days | 465.08 | 465.26 | D12 |
| NX26-ROBBIEDOHERTY | cost per ticket, all channels · 14 days | 2.98 | 2.98 | D12 |
| NX26-LOCKLEAD | spend, all channels · 14 days | 1446.63 | 1450.62 | D12 |
| All shows | spend, all channels · 14 days | 3343.68 | 3376.52 | D12 |
| All shows | cost per ticket, all channels · 14 days | 0.71 | 0.73 | D12 |
| NX26-EED | spend, all channels · 7 days | 13.26 | 22.66 | D12 |
| NX26-EED | cost per ticket, all channels · 7 days | 0.04 | 0.07 | D12 |
| NX26-IPC | spend, all channels · 7 days | 25.11 | 33.72 | D12 |
| NX26-IPC | cost per ticket, all channels · 7 days | 0.84 | 1.12 | D12 |
| NX26-GLOBAL | spend, all channels · 7 days | 233.55 | 271.34 | D12 |
| NX26-ROBBIEDOHERTY | spend, all channels · 7 days | 228.32 | 228.50 | D12 |
| NX26-ROBBIEDOHERTY | cost per ticket, all channels · 7 days | 2.72 | 2.72 | D12 |
| All shows | spend, all channels · 7 days | 822.30 | 840.49 | D12 |
| All shows | cost per ticket, all channels · 7 days | 0.95 | 0.97 | D12 |
| NX26-EED | spend, all channels · 3 days | 5.15 | 10.48 | D12 |
| NX26-EED | cost per ticket, all channels · 3 days | 0.03 | 0.06 | D12 |
| NX26-IPC | spend, all channels · 3 days | 15.28 | 18.96 | D12 |
| NX26-IPC | cost per ticket, all channels · 3 days | 0.51 | 0.63 | D12 |
| NX26-GLOBAL | spend, all channels · 3 days | 96.25 | 112.94 | D12 |
| NX26-ROBBIEDOHERTY | spend, all channels · 3 days | 91.38 | 91.56 | D12 |
| NX26-ROBBIEDOHERTY | cost per ticket, all channels · 3 days | 2.86 | 2.86 | D12 |
| All shows | spend, all channels · 3 days | 314.50 | 323.69 | D12 |
| All shows | cost per ticket, all channels · 3 days | 0.88 | 0.90 | D12 |
| NX26-EED | spend, all channels · yesterday | 1.10 | 2.68 | D12 |
| NX26-EED | cost per ticket, all channels · yesterday | 0.02 | 0.06 | D12 |
| NX26-IPC | spend, all channels · yesterday | 3.82 | 5.30 | D12 |
| NX26-IPC | cost per ticket, all channels · yesterday | 0.27 | 0.38 | D12 |
| NX26-GLOBAL | spend, all channels · yesterday | 24.78 | 29.62 | D12 |
| NX26-ROBBIEDOHERTY | spend, all channels · yesterday | 29.97 | 30.15 | D12 |
| NX26-ROBBIEDOHERTY | cost per ticket, all channels · yesterday | 5.00 | 5.02 | D12 |
| All shows | spend, all channels · yesterday | 99.28 | 102.52 | D12 |
| All shows | cost per ticket, all channels · yesterday | 0.95 | 0.98 | D12 |
| All shows | daily £ per registration 2026-08-18 | 27.89 | 0 | D13c |
| All shows | daily £ per registration 2026-08-19 | 31.29 | 0 | D13c |
| All shows | daily £ per registration 2026-08-24 | 0.50 | 0 | D13c |
| All shows | daily £ per registration 2026-08-25 | 0.57 | 0 | D13c |
| All shows | daily £ per registration 2026-08-26 | 0.61 | 0.18 | D13c |
| All shows | daily £ per registration 2026-08-27 | 0.67 | 0.35 | D13c |
| All shows | daily £ per registration 2026-08-28 | 0.93 | 0.52 | D13c |
| All shows | daily £ per registration 2026-08-29 | 1.01 | 0.59 | D13c |
| All shows | daily £ per registration 2026-08-30 | 1.08 | 0.60 | D13c |
| All shows | daily £ per registration 2026-08-31 | 0.91 | 0.54 | D13c |
| All shows | daily £ per registration 2026-09-01 | 1.13 | 0.63 | D13c |
| All shows | daily £ per registration 2026-09-02 | 1.33 | 0.68 | D13c |
| All shows | daily £ per registration 2026-09-03 | 0.38 | 0.20 | D13c |
| All shows | daily £ per registration 2026-09-04 | 0.88 | 0.26 | D13c |
| All shows | daily £ per registration 2026-09-05 | 2.85 | 1.76 | D13c |
| All shows | daily £ per registration 2026-09-06 | 2.71 | 1.74 | D13c |
| All shows | daily £ per registration 2026-09-07 | 2.61 | 1.70 | D13c |
| All shows | daily £ per registration 2026-09-08 | 1.68 | 1.22 | D13c |
| All shows | daily £ per registration 2026-09-09 | 1.07 | 0.82 | D13c |
| All shows | daily £ per registration 2026-09-10 | 2.20 | 1.33 | D13c |
| All shows | daily £ per registration 2026-09-11 | 3.59 | 2.35 | D13c |
| All shows | daily £ per registration 2026-09-12 | 3.77 | 2.96 | D13c |
| All shows | daily £ per registration 2026-09-13 | 4.94 | 2.79 | D13c |
| All shows | daily £ per registration 2026-09-14 | 5.52 | 2.08 | D13c |
| All shows | daily £ per registration 2026-09-15 | 4.88 | 1.93 | D13c |
| All shows | daily £ per registration 2026-09-16 | 5.18 | 1.76 | D13c |
| All shows | daily £ per registration 2026-09-17 | 5.64 | 1.24 | D13c |
| All shows | daily £ per registration 2026-09-18 | 3.27 | 0.54 | D13c |
| All shows | daily £ per registration 2026-09-19 | 1.05 | 0.57 | D13c |
| All shows | daily £ per registration 2026-09-20 | 1.00 | 0.62 | D13c |
| All shows | daily £ per registration 2026-09-21 | 0.27 | 0.16 | D13c |
| All shows | daily £ per registration 2026-09-22 | 0.58 | 0.32 | D13c |
| All shows | daily £ per registration 2026-09-23 | 0.57 | 0.53 | D13c |
| All shows | daily £ per registration 2026-09-24 | 1.04 | 1.01 | D13c |
| All shows | daily £ per registration 2026-09-25 | 1.01 | 0.98 | D13c |
| All shows | daily £ per registration 2026-09-26 | 1.45 | 1.27 | D13c |
| All shows | daily £ per registration 2026-09-27 | 1.74 | 1.44 | D13c |
| All shows | daily £ per registration 2026-09-28 | 1.77 | 1.56 | D13c |
| All shows | daily £ per registration 2026-09-29 | 1.91 | 1.62 | D13c |
| All shows | daily £ per registration 2026-09-30 | 1.12 | 0.94 | D13c |
| All shows | daily £ per registration 2026-10-01 | 1.89 | 1.77 | D13c |
| All shows | daily tickets a day 2026-10-02 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-02 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-02 | 2.22 | 1.56 | D13c |
| All shows | daily tickets a day 2026-10-03 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-03 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-03 | 2.48 | 2.04 | D13c |
| All shows | daily tickets a day 2026-10-04 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-04 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-04 | 2.92 | 2.38 | D13c |
| All shows | daily tickets a day 2026-10-05 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-05 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-05 | 2.73 | 2.16 | D13c |
| All shows | daily £ per registration 2026-10-06 | 6.03 | 4.18 | D13c |
| All shows | daily £ per registration 2026-10-07 | 7.02 | 4.36 | D13c |
| All shows | daily £ per registration 2026-10-08 | 18.27 | 8.34 | D13c |
| All shows | daily £ per registration 2026-10-27 | 113.90 | 0 | D13c |
| All shows | daily £ per registration 2026-10-29 | 0.90 | 0.24 | D13c |
| All shows | daily £ per registration 2026-10-30 | 4.44 | 1.35 | D13c |
| All shows | daily £ per registration 2026-10-31 | 7.29 | 3.06 | D13c |
| All shows | daily £ per registration 2026-11-01 | 11.21 | 3.68 | D13c |
| All shows | daily £ per registration 2026-11-02 | 5.58 | 2.06 | D13c |
| All shows | daily £ per registration 2026-11-03 | 6.09 | 3.34 | D13c |
| All shows | daily £ per registration 2026-11-04 | 8.42 | 6.03 | D13c |
| All shows | daily £ per registration 2026-11-05 | 9.62 | 6.76 | D13c |
| All shows | daily £ per registration 2026-11-06 | 17.43 | 10.32 | D13c |
| NX27-JULIANFIJMA | holds | 2266 | 2000 | D6 |
| NX27-JULIANFIJMA | case 2 (model: like Enzo; server: average finish) | 2285 | 2000 | D10 |
| NX27-JULIANFIJMA | case 3 (model: like DJ EZ; server: best finish) | 2482 | 2000 | D10 |
| NX26-IPC | case 2 (model: like Enzo; server: average finish) | 1873 | 1934 | D10 |
| NX26-IPC | case 3 (model: like DJ EZ; server: best finish) | 1936 | 1972 | D10 |
| NX26-EED | case 2 (model: like Enzo; server: average finish) | 1784 | 1876 | D10 |
| NX26-EED | case 3 (model: like DJ EZ; server: best finish) | 1879 | 1932 | D10 |
| NX26-LOCKLEAD | case 2 (model: like Enzo; server: average finish) | 1112 | 1462 | D10 |
| NX26-LOCKLEAD | case 3 (model: like DJ EZ; server: best finish) | 1473 | 1677 | D10 |
| NX26-ROBBIEDOHERTY | case 2 (model: like Enzo; server: average finish) | 694 | 866 | D10 |
| NX26-ROBBIEDOHERTY | case 3 (model: like DJ EZ; server: best finish) | 872 | 972 | D10 |
| NX26-SCHAK | holds | 2035 | 2000 | D6 |
| NX26-SCHAK | case 2 (model: like Enzo; server: average finish) | 2041 | 2000 | D10 |
| NX26-SCHAK | case 3 (model: like DJ EZ; server: best finish) | 2109 | 2000 | D10 |
| NX26-RUDIMENTAL | case 2 (model: like Enzo; server: average finish) | 874 | 946 | D10 |
| NX26-RUDIMENTAL | case 3 (model: like DJ EZ; server: best finish) | 948 | 990 | D10 |
| NX26-DOD | case 2 (model: like Enzo; server: average finish) | 1059 | 1137 | D10 |
| NX26-DOD | case 3 (model: like DJ EZ; server: best finish) | 1140 | 1185 | D10 |
| Library | Enzo lift (the model's case 2) | 1.20 | — | D10 |

Part B, the server on the live Internal Counts against the model on its CSV: 241 figures compared; 212 match; 29 differ, each by a rule.

| Show | Figure | Model (CSV) | Server (prod) | Rule |
|---|---|---|---|---|
| NX26-IPC | count 2026-10-15 (not in the CSV) | — | 1584 | COUNT |
| NX26-IPC | count 2026-10-21 (not in prod) | 1673 | — | COUNT |
| NX26-EED | count 2026-10-15 (not in the CSV) | — | 1099 | COUNT |
| NX26-EED | count 2026-10-21 (not in prod) | 1172 | — | COUNT |
| NX26-FOLAMOUR | count 2026-10-15 (not in the CSV) | — | 1200 | COUNT |
| NX26-FOLAMOUR | count 2026-10-21 (not in prod) | 1250 | — | COUNT |
| NX26-FOLAMOUR | count 2026-10-27 (a repeat of the last count: the ingest writes none) | 1292 | — | COUNT |
| NX26-FOLAMOUR | count 2026-10-28 (a repeat of the last count: the ingest writes none) | 1292 | — | COUNT |
| NX26-FOLAMOUR | count 2026-10-29 (a repeat of the last count: the ingest writes none) | 1292 | — | COUNT |
| NX26-FOLAMOUR | count 2026-10-30 (a repeat of the last count: the ingest writes none) | 1292 | — | COUNT |
| NX26-FOLAMOUR | count 2026-11-02 (a repeat of the last count: the ingest writes none) | 1292 | — | COUNT |
| NX26-FOLAMOUR | count 2026-11-03 (a repeat of the last count: the ingest writes none) | 1292 | — | COUNT |
| NX26-ROBBIEDOHERTY | count 2026-10-15 (not in the CSV) | — | 268 | COUNT |
| NX26-ROBBIEDOHERTY | count 2026-10-21 (not in prod) | 294 | — | COUNT |
| NX26-SCHAK | count 2026-09-22 (not in prod) | 0 | — | COUNT |
| NX26-SCHAK | count 2026-10-15 (not in the CSV) | — | 1723 | COUNT |
| NX26-SCHAK | count 2026-10-21 (not in prod) | 1778 | — | COUNT |
| NX26-AZYR | count 2026-10-15 (not in the CSV) | — | 856 | COUNT |
| NX26-AZYR | count 2026-10-21 (not in prod) | 897 | — | COUNT |
| NX26-MF | count 2026-10-15 (not in the CSV) | — | 895 | COUNT |
| NX26-DJEZ | count 2026-10-01 (paid; 137 comps) | 365 | 228 | D8 |
| NX26-DJEZ | count 2026-10-05 (paid; 218 comps) (not in the CSV) | — | 305 | COUNT |
| NX26-RUDIMENTAL | count 2026-10-01 | 438 | 277 | COUNT |
| NX26-RUDIMENTAL | count 2026-10-05 (not in the CSV) | — | 438 | COUNT |
| NX26-RUDIMENTAL | count 2026-10-15 (not in the CSV) | — | 536 | COUNT |
| NX26-RUDIMENTAL | count 2026-10-21 (not in prod) | 578 | — | COUNT |
| NX26-DOD | count 2026-10-15 (not in the CSV) | — | 778 | COUNT |
| NX26-DOD | count 2026-10-21 (not in prod) | 814 | — | COUNT |
| NX26-FOLAMOUR | final count (model: show-day count; server: latest on or after show day) | 1268 | 1292 | FINAL |
