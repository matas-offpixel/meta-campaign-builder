# Shadow Live-readiness — 2026-09-05

Read-only. No Live flips. No env changes.

PRs #887 / #888 / #889 have **not** had two post-merge ticks. This report is generated from the decisions that already exist and says so.

Generated at 2026-09-05T00:10:44.787Z from `campaign_automation_decisions` (last 7d) and armed `campaign_drafts`.

| Campaign | decisions | actions | metric coverage | would-change | largest change | cooldown | verdict |
|---|---:|---|---:|---:|---|---|---|
| [20261204CSA] Woraklis — Signup (`120250261231790708`) | 12 | maintain:12 | 0.0% | 0.0% | none | no CHANGE in window | **not enough evidence** — under 20% of decisions carried a metric reading |
| [IRW0005] APPETITE — Purchase Ads (`52512868723907`) | 14 | maintain:14 | 0.0% | 0.0% | none | no CHANGE in window | **rules misconfigured** — optimisation mode is none |
| [NX25-DJ EZ] DJ EZ - NEWCASTLE - Purchase (`120251664639430755`) | 1 | metric_unavailable:1 | 0.0% | 0.0% | none | no CHANGE in window | **not enough evidence** — fewer than two ticks with rows in the last 7d |
| [NX25-DJ EZ] DJ EZ - NEWCASTLE - Traffic (Copy) (`120251587949320755`) | 72 | scale_up:50, maintain:20, insufficient_conversions:1, scale_down:1 | 98.6% | 70.8% | scale_up +30% (300→390 pence) at 2026-09-03T20:02:12.778246+00:00 | in cooldown (4.1h / 24h) | **ready** — rules present, majority of rows have a reading, and the loop has proposed budget changes |
| [NX26-DOD] D.O.D - Signup (`120251576269510755`) | 38 | maintain:38 | 0.0% | 0.0% | none | no CHANGE in window | **not enough evidence** — under 20% of decisions carried a metric reading |
| [NX26-DOD] DOD - Signup - Artist (`120251586482660755`) | 35 | maintain:34, scale_down:1 | 5.7% | 2.9% | scale_down -25% (1500→1125 pence) at 2026-09-02T16:03:26.88329+00:00 | in cooldown (56.1h / 168h) | **not enough evidence** — under 20% of decisions carried a metric reading |
| DJ EZ - NEWCASTLE - Signup (`120251365378580755`) | 32 | maintain:32 | 0.0% | 0.0% | none | no CHANGE in window | **not enough evidence** — under 20% of decisions carried a metric reading |
| DJ EZ - NEWCASTLE - Signup (`120251362539090755`) | 0 | — | 0% | 0% | none | no CHANGE in window | **not enough evidence** — fewer than two ticks with rows in the last 7d |
| IPC - NEWCASTLE - SIGNUP v4 (`120251199401080755`) | 50 | maintain:50 | 0.0% | 0.0% | none | no CHANGE in window | **not enough evidence** — under 20% of decisions carried a metric reading |
| Mall Grab - Sheffield - Traffic (`120249856769020239`) | 45 | maintain:45 | 42.2% | 0.0% | none | no CHANGE in window | **rules misconfigured** — optimisation mode is none |

## Per campaign

### [20261204CSA] Woraklis — Signup

- draft `0c6681a7-f499-4021-8277-a66883e437b7` · Meta `120250261231790708` · registration · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 2
- first/last row: 2026-09-03T16:01:14.925653+00:00 → 2026-09-04T08:01:05.50935+00:00
- last CHANGE: none in window (—); cooldown floor 168h

### [IRW0005] APPETITE — Purchase Ads

- draft `a269b592-144a-4969-a69a-464725d41857` · Meta `52512868723907` · purchase · mode=none · enabled_rules=0 · Live=false
- ticks (distinct UTC hours with a row): 2
- first/last row: 2026-09-01T20:01:34.483646+00:00 → 2026-09-03T00:03:46.890646+00:00
- last CHANGE: none in window (—); cooldown floor 168h

### [NX25-DJ EZ] DJ EZ - NEWCASTLE - Purchase

- draft `fa5bf52c-b70c-4d52-bedc-fe4e4cba687a` · Meta `120251664639430755` · purchase · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 1
- first/last row: 2026-09-03T16:01:24.62965+00:00 → 2026-09-03T16:01:24.62965+00:00
- last CHANGE: none in window (—); cooldown floor 168h

### [NX25-DJ EZ] DJ EZ - NEWCASTLE - Traffic (Copy)

- draft `da6fbec3-1b21-4340-95a7-0a97c948409b` · Meta `120251587949320755` · traffic · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 9
- first/last row: 2026-08-29T08:03:14.986599+00:00 → 2026-09-04T20:03:36.121494+00:00
- last CHANGE: 2026-09-04T20:03:36.121494+00:00 (4.1h ago); cooldown floor 24h

### [NX26-DOD] D.O.D - Signup

- draft `8cec8da7-da0a-4748-97e1-c4c08da8dc44` · Meta `120251576269510755` · registration · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 2
- first/last row: 2026-09-01T20:01:40.066695+00:00 → 2026-09-03T00:03:57.855965+00:00
- last CHANGE: none in window (—); cooldown floor 168h

### [NX26-DOD] DOD - Signup - Artist

- draft `645ed600-6863-4175-af9a-2a7234b0e7b1` · Meta `120251586482660755` · registration · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 5
- first/last row: 2026-08-29T16:01:06.855831+00:00 → 2026-09-02T16:03:26.88329+00:00
- last CHANGE: 2026-09-02T16:03:26.88329+00:00 (56.1h ago); cooldown floor 168h

### DJ EZ - NEWCASTLE - Signup

- draft `0cbc9f71-658f-498a-a6e3-0100d4e75b08` · Meta `120251365378580755` · registration · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 2
- first/last row: 2026-09-01T20:00:34.844176+00:00 → 2026-09-02T20:02:00.302289+00:00
- last CHANGE: none in window (—); cooldown floor 168h

### DJ EZ - NEWCASTLE - Signup

- draft `24915e55-bdfe-4918-a8fe-d4609896c728` · Meta `120251362539090755` · registration · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 0
- first/last row: — → —
- last CHANGE: none in window (—); cooldown floor 168h

### IPC - NEWCASTLE - SIGNUP v4

- draft `faf11b6f-bf7f-4ad8-9f4e-61bae0e2261c` · Meta `120251199401080755` · registration · mode=benchmarks · enabled_rules=1 · Live=false
- ticks (distinct UTC hours with a row): 5
- first/last row: 2026-08-29T20:02:56.644427+00:00 → 2026-09-03T04:03:28.179246+00:00
- last CHANGE: none in window (—); cooldown floor 168h

### Mall Grab - Sheffield - Traffic

- draft `22c669f1-46b3-42dd-87aa-89e1a257e485` · Meta `120249856769020239` · traffic · mode=none · enabled_rules=0 · Live=false
- ticks (distinct UTC hours with a row): 8
- first/last row: 2026-09-01T20:01:21.738588+00:00 → 2026-09-05T00:02:06.764066+00:00
- last CHANGE: none in window (—); cooldown floor 24h

## Recommendation

Arm **[NX25-DJ EZ] DJ EZ - NEWCASTLE - Traffic (Copy)** Live first. Rules present, majority of rows have a reading, and the loop has proposed budget changes. Last CHANGE is ~4h ago, so the first Live ticks may `skip_recent_touch` until the 24h cooldown ends. This run did not flip Live or change `ENABLE_OPTIMISATION_*`.
