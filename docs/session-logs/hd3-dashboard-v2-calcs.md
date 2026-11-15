# Session log — HD3, dashboard v2 server calcs

## PR

- **Branch:** `cc/dashboard-v2-calcs` (Claude Code)
- **Record:** `docs/design-record/2026-11-13-dashboard-v2.html` (D2, D4, D5, D6, D10, D12, D13, HD3)

## Design rulings (14 Nov, recorded here)

1. **The 8 unruled figures: the server is right.** D4's window is two consecutive counts for one show, and All shows takes each show's value for the day from that show's own window. Logged as "the model drops windows by end day; corrected": 2–5 Oct, 56.82 tickets a day, £0.99 per ticket. They're tagged ALL in the table below.
2. **Reference library: PASS, client-wide across venues** (Matas, 14 Nov). It holds all of Electric's finished shows that meet D10, Sheffield included. A show is in only if:
   - it has counts on both sides of D−21 and D−7, so both interpolate (a show with no count before an interpolation point is out until it has one);
   - it didn't reach its allocation before D−7.

   That gives 6 shows: DJ EZ ×3.3231, Modern Funktion ×4.5167, Folamour ×2.2291, Girls Don't Sync ×1.8082, Sheffield Fever 105 ×3.2500, AZYR ×2.9511 (final 9 Nov, 1,309). The average is **×3.0130**, so the cases read "Like your average finish (×3.01, 6 shows)" and "Like your best finish (×4.52, Modern Funktion)". The labels are built from the data, and the note under them lists the six shows. Per-event reference shows (the edit page) still override the library for that event.

   Folamour's lift uses the 26 Oct final (1,292) as the show-day value: (1,292 − 1,202) ÷ 7 = 12.857 a day, over (1,202 − 1,121.25) ÷ 14 = 5.768 a day, giving ×2.229. Enzo is out.
3. **Fix, D13c:** outside the signup window the daily £ per registration is empty (null), not £0.00, and a day with no spend is empty too. All shows has no one signup window (each show's closes at its own on-sale), so its daily figure is always empty; its period figure stays windowed per show.
   - The 58 All-shows rows now read "→ —".
   - 18 single-show days the model drew as £0.00 (signups on a day with no spend) now read "→ —".
   - **The chart** (`components/dashboard/sales/sales-chart.tsx`, Rule 3 waived by Matas, 14 Nov): each series is drawn as its unbroken runs (`metricRuns`), one polyline per run. An empty day breaks the line: no bridge and no £0. A lone day shows as a dot.

## Parity with the model, 12 Nov data (full table)

Produced by `PARITY_OUT=… node --conditions react-server --experimental-strip-types --test lib/dashboard/__tests__/sales-calc-parity.test.ts`.
The model's calcs (artifact 1WbbWGeA1hvTfx7dkS9duj, page v13) are ported in `lib/dashboard/__tests__/sales-calc-model-reference.ts` and run on the same rows as the server calc (`fixtures/sales-12-nov.json`, read from prod on 13 Nov, reads only, show names and counts only). The fixture's Meta spend per show matches the model's `meta_daily` SQL run on 13 Nov to the penny (asserted).

Part A, calc logic: both sides read the model's CSV counts. Part B: the server reads the live Internal Counts.
Rules: D12 all channels · D13a since-launch CPT capped at the latest count · D13b straddling window pro-rated · D13c daily £/registration empty outside the signup window · D6 projection capped at allocation · D10 library cases (the model's Enzo / DJ EZ against the 6-show client library) · ALL the model drops windows by end day; corrected · COUNT the live counts differ from the CSV on a day the figure depends on · D8 paid only · FINAL latest count on or after show day.

7338 figures compared; 7177 match; 161 differ, each by a rule.

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
| NX26-ROBBIEDOHERTY | daily £ per registration 2026-09-22 | 0 | — | D13c |
| NX26-ROBBIEDOHERTY | daily £ per registration 2026-09-23 | 0 | — | D13c |
| NX26-ROBBIEDOHERTY | daily £ per registration 2026-09-24 | 0 | — | D13c |
| NX26-ROBBIEDOHERTY | daily £ per registration 2026-09-30 | 0 | — | D13c |
| NX26-DOD | daily £ per registration 2026-08-18 | 0 | — | D13c |
| NX26-DOD | daily £ per registration 2026-08-19 | 0 | — | D13c |
| NX26-DOD | daily £ per registration 2026-08-24 | 0 | — | D13c |
| NX26-DOD | daily £ per registration 2026-08-25 | 0 | — | D13c |
| NX26-LOCKLEAD | daily £ per registration 2026-10-27 | 0 | — | D13c |
| NX26-RUDIMENTAL | daily £ per registration 2026-09-18 | 0 | — | D13c |
| NX26-RUDIMENTAL | daily £ per registration 2026-09-19 | 0 | — | D13c |
| NX26-RUDIMENTAL | daily £ per registration 2026-09-21 | 0 | — | D13c |
| NX26-RUDIMENTAL | daily £ per registration 2026-09-22 | 0 | — | D13c |
| NX26-SCHAK | daily £ per registration 2026-09-03 | 0 | — | D13c |
| NX26-SCHAK | daily £ per registration 2026-09-04 | 0 | — | D13c |
| NX26-SCHAK | daily £ per registration 2026-09-05 | 0 | — | D13c |
| NX26-SCHAK | daily £ per registration 2026-09-06 | 0 | — | D13c |
| NX26-SCHAK | daily £ per registration 2026-09-07 | 0 | — | D13c |
| All shows | daily £ per registration 2026-08-18 | 27.89 | — | D13c |
| All shows | daily £ per registration 2026-08-19 | 31.29 | — | D13c |
| All shows | daily £ per registration 2026-08-24 | 0.50 | — | D13c |
| All shows | daily £ per registration 2026-08-25 | 0.57 | — | D13c |
| All shows | daily £ per registration 2026-08-26 | 0.61 | — | D13c |
| All shows | daily £ per registration 2026-08-27 | 0.67 | — | D13c |
| All shows | daily £ per registration 2026-08-28 | 0.93 | — | D13c |
| All shows | daily £ per registration 2026-08-29 | 1.01 | — | D13c |
| All shows | daily £ per registration 2026-08-30 | 1.08 | — | D13c |
| All shows | daily £ per registration 2026-08-31 | 0.91 | — | D13c |
| All shows | daily £ per registration 2026-09-01 | 1.13 | — | D13c |
| All shows | daily £ per registration 2026-09-02 | 1.33 | — | D13c |
| All shows | daily £ per registration 2026-09-03 | 0.38 | — | D13c |
| All shows | daily £ per registration 2026-09-04 | 0.88 | — | D13c |
| All shows | daily £ per registration 2026-09-05 | 2.85 | — | D13c |
| All shows | daily £ per registration 2026-09-06 | 2.71 | — | D13c |
| All shows | daily £ per registration 2026-09-07 | 2.61 | — | D13c |
| All shows | daily £ per registration 2026-09-08 | 1.68 | — | D13c |
| All shows | daily £ per registration 2026-09-09 | 1.07 | — | D13c |
| All shows | daily £ per registration 2026-09-10 | 2.20 | — | D13c |
| All shows | daily £ per registration 2026-09-11 | 3.59 | — | D13c |
| All shows | daily £ per registration 2026-09-12 | 3.77 | — | D13c |
| All shows | daily £ per registration 2026-09-13 | 4.94 | — | D13c |
| All shows | daily £ per registration 2026-09-14 | 5.52 | — | D13c |
| All shows | daily £ per registration 2026-09-15 | 4.88 | — | D13c |
| All shows | daily £ per registration 2026-09-16 | 5.18 | — | D13c |
| All shows | daily £ per registration 2026-09-17 | 5.64 | — | D13c |
| All shows | daily £ per registration 2026-09-18 | 3.27 | — | D13c |
| All shows | daily £ per registration 2026-09-19 | 1.05 | — | D13c |
| All shows | daily £ per registration 2026-09-20 | 1.00 | — | D13c |
| All shows | daily £ per registration 2026-09-21 | 0.27 | — | D13c |
| All shows | daily £ per registration 2026-09-22 | 0.58 | — | D13c |
| All shows | daily £ per registration 2026-09-23 | 0.57 | — | D13c |
| All shows | daily £ per registration 2026-09-24 | 1.04 | — | D13c |
| All shows | daily £ per registration 2026-09-25 | 1.01 | — | D13c |
| All shows | daily £ per registration 2026-09-26 | 1.45 | — | D13c |
| All shows | daily £ per registration 2026-09-27 | 1.74 | — | D13c |
| All shows | daily £ per registration 2026-09-28 | 1.77 | — | D13c |
| All shows | daily £ per registration 2026-09-29 | 1.91 | — | D13c |
| All shows | daily £ per registration 2026-09-30 | 1.12 | — | D13c |
| All shows | daily £ per registration 2026-10-01 | 1.89 | — | D13c |
| All shows | daily tickets a day 2026-10-02 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-02 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-02 | 2.22 | — | D13c |
| All shows | daily tickets a day 2026-10-03 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-03 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-03 | 2.48 | — | D13c |
| All shows | daily tickets a day 2026-10-04 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-04 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-04 | 2.92 | — | D13c |
| All shows | daily tickets a day 2026-10-05 | 51.25 | 56.82 | ALL |
| All shows | daily cost per ticket 2026-10-05 | 0.47 | 0.99 | ALL |
| All shows | daily £ per registration 2026-10-05 | 2.73 | — | D13c |
| All shows | daily £ per registration 2026-10-06 | 6.03 | — | D13c |
| All shows | daily £ per registration 2026-10-07 | 7.02 | — | D13c |
| All shows | daily £ per registration 2026-10-08 | 18.27 | — | D13c |
| All shows | daily £ per registration 2026-10-27 | 113.90 | — | D13c |
| All shows | daily £ per registration 2026-10-29 | 0.90 | — | D13c |
| All shows | daily £ per registration 2026-10-30 | 4.44 | — | D13c |
| All shows | daily £ per registration 2026-10-31 | 7.29 | — | D13c |
| All shows | daily £ per registration 2026-11-01 | 11.21 | — | D13c |
| All shows | daily £ per registration 2026-11-02 | 5.58 | — | D13c |
| All shows | daily £ per registration 2026-11-03 | 6.09 | — | D13c |
| All shows | daily £ per registration 2026-11-04 | 8.42 | — | D13c |
| All shows | daily £ per registration 2026-11-05 | 9.62 | — | D13c |
| All shows | daily £ per registration 2026-11-06 | 17.43 | — | D13c |
| NX27-JULIANFIJMA | holds | 2266 | 2000 | D6 |
| NX27-JULIANFIJMA | case 2 (model: like Enzo; server: average finish) | 2285 | 2000 | D10 |
| NX27-JULIANFIJMA | case 3 (model: like DJ EZ; server: best finish) | 2482 | 2000 | D10 |
| NX26-IPC | case 2 (model: like Enzo; server: average finish) | 1873 | 1927 | D10 |
| NX26-IPC | case 3 (model: like DJ EZ; server: best finish) | 1936 | 1972 | D10 |
| NX26-EED | case 2 (model: like Enzo; server: average finish) | 1784 | 1865 | D10 |
| NX26-EED | case 3 (model: like DJ EZ; server: best finish) | 1879 | 1932 | D10 |
| NX26-LOCKLEAD | case 2 (model: like Enzo; server: average finish) | 1112 | 1421 | D10 |
| NX26-LOCKLEAD | case 3 (model: like DJ EZ; server: best finish) | 1473 | 1677 | D10 |
| NX26-ROBBIEDOHERTY | case 2 (model: like Enzo; server: average finish) | 694 | 846 | D10 |
| NX26-ROBBIEDOHERTY | case 3 (model: like DJ EZ; server: best finish) | 872 | 972 | D10 |
| NX26-SCHAK | holds | 2035 | 2000 | D6 |
| NX26-SCHAK | case 2 (model: like Enzo; server: average finish) | 2041 | 2000 | D10 |
| NX26-SCHAK | case 3 (model: like DJ EZ; server: best finish) | 2109 | 2000 | D10 |
| NX26-RUDIMENTAL | case 2 (model: like Enzo; server: average finish) | 874 | 937 | D10 |
| NX26-RUDIMENTAL | case 3 (model: like DJ EZ; server: best finish) | 948 | 990 | D10 |
| NX26-DOD | case 2 (model: like Enzo; server: average finish) | 1059 | 1128 | D10 |
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
