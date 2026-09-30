[Use Opus] — send after PR 1 (`cursor/creator-audience-create`) merges

# Push an audience into a live campaign's ad sets. PR 2 of 2. One PR, `cursor/live-adset-audience-push`, off fresh `main`. Open, don't merge.

Matas wants to add a new custom audience (pixel, customer list, or any existing one) to a campaign that is already running, without Ads Manager. Today the app's only live ad-set writes are `daily_budget` and `status: PAUSED` (`lib/optimisation/apply.ts`). Targeting has never been written to a live ad set from this app. This is a new write class and it gets its own gate.

## What Meta requires — read before designing

`POST /{adset_id}` with `targeting` **replaces the whole targeting object**. There is no "append one audience". So the write is read → merge → write-back, and the write-back must carry every field Meta returned — `geo_locations`, `age_min/max`, `custom_audiences`, `excluded_custom_audiences`, `flexible_spec`, `targeting_automation`, `publisher_platforms`, positions, everything — unchanged except the one list being edited. Dropping a field the app does not model is how an ad set silently loses its placements or its Advantage+ flag (#758's `targeting_automation` lesson). Read `targeting` as an opaque object, mutate only `custom_audiences` / `excluded_custom_audiences`, send it back whole.

Changing targeting on a delivering ad set **resets its learning phase**. The UI says so before the operator confirms.

## 1 — Gate

`OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED`, must be exactly `"true"`, default off, documented in CLAUDE.md alongside the other write gates. Off → the control is visible and disabled with the reason. Nothing else about the feature depends on it being on except the final POST.

## 2 — Surface

On the Campaign Library's Published tab, per published campaign: **Add audience to ad sets**. Opens the existing `CrossCampaignAdSetPicker` scoped to that campaign (it already reads live ad sets — reuse it, do not fork), then an audience picker (the account's custom audiences, including anything PR 1 just created), and **Include / Exclude**.

## 3 — Preflight, then write

For each chosen ad set: read `/{id}?fields=name,effective_status,targeting`. Show a diff per ad set — *"Lineup Direct: +DHB Pixel Purchase 180d (include) · 61 → 62 audiences"* — and refuse any ad set where the audience is already present, is `ARCHIVED`/`DELETED`, or where the read failed (same posture as #985: an unverified read is not a reason to write). Confirm → POST each ad set's full targeting with the one list changed. Every write goes through the Meta write ledger with `op_kind: "adset_targeting_update"` keyed on `{adset_id, audience_id, direction}` so a retry never double-applies. Record outcome per ad set; one failure does not roll back the others (they are independent and reversible), but the log names each.

Zero creative, campaign, or budget writes. No auto-anything — the operator picks ad sets, picks the audience, sees the diff, confirms.

## 4 — Reverse

The same control with **Remove** does the inverse read-merge-write. Ship it in this PR; a push without a pull is a one-way door.

## Guards

Migration only if the ledger table's `op_kind` is a CHECK constraint that needs the new value — if so, write it, Matas applies. `lib/optimisation/**`'s write set is untouched (#972's golden payloads stay green — this is a separate module, `lib/meta/adset-targeting-write.ts`). Do not touch `lib/tiktok/**`, `lib/google-ads/**`, `lib/google-search/**`. The `#969` launch-route write-set guard must not change — this feature does not run through the launch route.

## Test plan

Golden: a read targeting with 14 fields comes back with 14 fields and one longer `custom_audiences` list — assert deep-equality on everything but that list. Exclude path mutates only `excluded_custom_audiences`. Already-present audience → refused for that ad set, others proceed. Read fails → refused, no POST. Gate off → no POST, control disabled. Ledger: second run with the same triple is a no-op. Remove reverses a push exactly. One paused smoke test on a real paused ad set, before and after targeting read back and diffed — put both reads in the PR body.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
