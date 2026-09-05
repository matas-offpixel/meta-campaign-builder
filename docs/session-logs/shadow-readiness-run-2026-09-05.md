# Shadow readiness overnight — 2026-09-05

Unattended stacked run. One PR per step. Decision logic stays in `evaluate.ts`. No Meta writes. Gates unchanged.

## Status

| Step | Branch | PR | State |
|---|---|---|---|
| 1 cooldown-only-after-change | `cursor/shadow-cooldown-only-after-change` | [#887](https://github.com/matas-offpixel/meta-campaign-builder/pull/887) | opened |
| 2 named skips | `cursor/shadow-named-skips` | [#888](https://github.com/matas-offpixel/meta-campaign-builder/pull/888) | opened (stacked on #887) |
| 3 conversion-metric audit | `cursor/shadow-conversion-metric-audit` | [#889](https://github.com/matas-offpixel/meta-campaign-builder/pull/889) | opened (off main) |
| 4 Live-readiness report | `cursor/shadow-live-readiness-report` | [#890](https://github.com/matas-offpixel/meta-campaign-builder/pull/890) | opened (off main) |

## What each changed

### #887 — cooldown only after a change
Cooldown reads the last `scale_up` / `scale_down` / `pause` decision, not the last row of any kind. `maintain` / `skip_*` / `insufficient_conversions` / `metric_unavailable` never start or extend cooldown. Unlocks the six silent conversion campaigns on the next tick with no data migration.

### #888 — named skips + maintain encoding
`mode=none` or zero enabled rules → one campaign-level `skip_no_rules` per tick (no per-ad-set rows, no insights fetch, no Slack). New ladders emit action `maintain` for the hold band; evaluate still accepts legacy `decrease_budget`/`increase_budget` with `actionValue` 0.

### #889 — conversion-metric audit
Read-only last-7d insights with `META_ACCESS_TOKEN`. Token could read. **No resolver mapping change.** See table below.

### #890 — Live-readiness report
`scripts/shadow-readiness-report.mjs` → `docs/session-logs/shadow-readiness-2026-09-05.md`. Generated **before** two post-merge ticks of #887–#889; says so.

## PR 3 action_type table

Resolver cpr: `offsite_conversion.fb_pixel_complete_registration`, `onsite_conversion.complete_registration`, `complete_registration`.
Resolver cpa: `offsite_conversion.fb_pixel_purchase`, `onsite_conversion.purchase`, `purchase`.

### Woraklis — Signup (`120250261231790708`, cpr)

Ad sets listed: 12.

| source | action_type | count_or_adsets | in_resolver |
|---|---|---:|:---:|
| actions | post_engagement | 4383 | no |
| actions | page_engagement | 4383 | no |
| actions | video_view | 3395 | no |
| actions | link_click | 707 | no |
| actions | landing_page_view | 547 | no |
| actions | omni_landing_page_view | 547 | no |
| actions | post_interaction_net | 283 | no |
| actions | post_interaction_gross | 281 | no |
| actions | offsite_complete_registration_add_meta_leads | 177 | no |
| actions | omni_complete_registration | 177 | no |
| actions | offsite_conversion.fb_pixel_complete_registration | 177 | yes |
| actions | complete_registration | 177 | yes |
| actions | offsite_complete_registration_add_20_s_calls | 177 | no |
| actions | post_reaction | 159 | no |
| actions | onsite_conversion.post_net_like | 158 | no |
| actions | post | 90 | no |
| actions | onsite_conversion.post_save | 31 | no |
| actions | onsite_conversion.post_net_save | 30 | no |
| actions | onsite_conversion.post_unsave | 1 | no |
| actions | comment | 1 | no |
| actions | onsite_conversion.post_net_comment | 1 | no |
| actions | onsite_conversion.post_unlike | 1 | no |
| cost_per_action_type | offsite_complete_registration_add_meta_leads | 11 adsets | no |
| cost_per_action_type | offsite_complete_registration_add_20_s_calls | 11 adsets | no |
| cost_per_action_type | video_view | 11 adsets | no |
| cost_per_action_type | link_click | 11 adsets | no |
| cost_per_action_type | post_interaction_gross | 11 adsets | no |
| cost_per_action_type | post_engagement | 11 adsets | no |
| cost_per_action_type | omni_complete_registration | 11 adsets | no |
| cost_per_action_type | page_engagement | 11 adsets | no |
| cost_per_action_type | complete_registration | 11 adsets | yes |
| cost_per_action_type | omni_landing_page_view | 11 adsets | no |
| cost_per_action_type | landing_page_view | 11 adsets | no |

### D.O.D - Signup (`120251576269510755`, cpr)

19 ad sets, all `CAMPAIGN_PAUSED`. No `actions[]` / `cost_per_action_type[]` in last_7d. Meta name on this id is `[NX26-FOLMAOUR] FOLMAOUR - Signup`. Live `[NX26-DOD] DOD - Signup` is `120251562676280755` (draft still points at the FOLMAOUR id).

### APPETITE — Purchase Ads (`52512868723907`, cpa)

| source | action_type | count_or_adsets | in_resolver |
|---|---|---:|:---:|
| actions | page_engagement | 2668 | no |
| actions | post_engagement | 2666 | no |
| actions | video_view | 2645 | no |
| actions | link_click | 11 | no |
| actions | post_interaction_gross | 10 | no |
| actions | post_interaction_net | 10 | no |
| actions | post_reaction | 8 | no |
| actions | onsite_conversion.post_net_like | 8 | no |
| actions | like | 2 | no |
| actions | landing_page_view | 1 | no |
| actions | omni_landing_page_view | 1 | no |
| actions | post | 1 | no |
| actions | comment | 1 | no |
| actions | onsite_conversion.post_net_comment | 1 | no |
| cost_per_action_type | video_view | 3 adsets | no |
| cost_per_action_type | post_engagement | 3 adsets | no |
| cost_per_action_type | page_engagement | 3 adsets | no |
| cost_per_action_type | link_click | 2 adsets | no |
| cost_per_action_type | like | 2 adsets | no |
| cost_per_action_type | post_interaction_gross | 2 adsets | no |
| cost_per_action_type | omni_landing_page_view | 1 adsets | no |
| cost_per_action_type | landing_page_view | 1 adsets | no |

Zero purchase types. Meta name on this id is `[IRW0004] Camelphat — Awareness`. Live `[IRW0005] APPETITE - ON SALE` is `52517716665907` (has `purchase` in cost — resolver already lists it). Draft is also `mode=none`.

### DJ EZ Signup `120251362539090755`

0 ad sets. Campaign `ARCHIVED`.

### DJ EZ Signup `120251365378580755`

16 ad sets, all PAUSED / CAMPAIGN_PAUSED. Empty last_7d insights.

## PR 4 report

See [shadow-readiness-2026-09-05.md](./shadow-readiness-2026-09-05.md). Snapshot: DJ EZ Traffic 72 decisions / 98.6% metric coverage / 70.8% would-change / largest +30%. Mall Grab and APPETITE are `mode=none`. Conversion campaigns have almost no readings in the existing window because #875 no-op maintains started the 168h cooldown (fixed by #887, not yet ticked).

## Recommendation

**Arm DJ EZ Traffic (`120251587949320755`, draft `da6fbec3-1b21-4340-95a7-0a97c948409b`) Live first.** It is the only armed campaign that already produces `lpv_cost:24h` readings and budget-change proposals (50 scale_up / 20 maintain / 1 scale_down / 1 insufficient_conversions in 7d). Rules are present (`mode=benchmarks`, one enabled rule). Last CHANGE was ~4h ago, so the first Live ticks may `skip_recent_touch` until the 24h cooldown ends — that is expected, not a blocker.

Do not arm conversion campaigns Live until #887 has ticked at least twice and Woraklis shows numeric `cpr` rows (the data is on Meta now; the last stored decisions predate it). Do not arm Mall Grab or APPETITE until rules / Meta ids are fixed.

No Live flips and no env changes were made by this run.

## UNVERIFIED

- Whether #887 / #888 / #889 have merged, and whether two post-merge ticks have run. This report was generated before that.
- Whether the operator will set `optimisation_automation_live` and `ENABLE_OPTIMISATION_WRITES=1` — this run did not touch either.
- Whether the FOLMAOUR Meta id on the DOD draft was a rename, a reuse, or a paste error. Live DOD Signup id `120251562676280755` was observed on the ad account; the draft was not edited.
- Whether APPETITE ON SALE `52517716665907` is the campaign the draft *should* point at. Observed only; draft not edited.
- Whether DJ EZ Traffic's +30% proposals are within the operator's intended daily ceiling once Live writes start. Shadow only.
