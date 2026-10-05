# Session log

## PR

- **Number:** 1012
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1012
- **Branch:** `cursor/attach-inherits-conversion-event`

## Summary

Attach mode was reading `OUTCOME_SALES` as purchase, so new ad sets under a signup campaign optimised for Website purchase. The picker and the launch now take the internal objective from the live ad sets' conversion event, the same vote the importer already uses.

## Scope / files

- `GET /api/meta/campaigns` and `fetchCampaignById` request `adsets.limit(50){promoted_object,optimization_goal}` and resolve the chip from that vote
- `attach_campaign` builds new ad sets with the voted objective and, when the draft has no pixel, the most common `pixel_id`
- A single selected campaign is refused when its voted objective differs from the draft. Two or more campaigns are not: each ad set uses that campaign's own event, and Review lists them (`Name → event`)
- The campaign list asks for ad sets only when the attach picker sends `withAdSets=1`. A Graph "reduce the amount of data" error retries that page without the edge
- `attach_adset` and `attach_all_adsets` still add ads only

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] Picker on Electric Studios shows Signup for the three DAN SHAKE rows (`120250922487440239`, `120250922677510239`, `120250922654820239`)

## Notes

Fixture `lib/meta/__fixtures__/attach-objective/120250922487440239.json`: objective `OUTCOME_SALES`, 6 ad sets, all `COMPLETE_REGISTRATION`, pixel `2261755947685271`.

Drafts saved before this deploy against a signup campaign stored the old objective-only mapping, so the snapshot says purchase while the live vote is registration. Launch then returns 409: objective changed since you picked it (snapshot: "purchase", live: "registration"). The campaign did not change in Ads Manager. Re-open the Campaign step and re-select it.
