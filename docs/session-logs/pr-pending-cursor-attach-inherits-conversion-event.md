# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/attach-inherits-conversion-event`

## Summary

Attach mode was reading `OUTCOME_SALES` as purchase, so new ad sets under a signup campaign optimised for Website purchase. The picker and the launch now take the internal objective from the live ad sets' conversion event, the same vote the importer already uses.

## Scope / files

- `GET /api/meta/campaigns` and `fetchCampaignById` request `adsets.limit(50){promoted_object,optimization_goal}` and resolve the chip from that vote
- `attach_campaign` builds new ad sets with the voted objective and, when the draft has no pixel, the most common `pixel_id`
- A draft whose objective does not match a selected campaign is refused before any create, naming the conversion event
- `attach_adset` and `attach_all_adsets` still add ads only; mixed campaigns are still not blocked against each other

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] Picker on Electric Studios shows Signup for the three DAN SHAKE rows (`120250922487440239`, `120250922677510239`, `120250922654820239`)

## Notes

Fixture `lib/meta/__fixtures__/attach-objective/120250922487440239.json`: objective `OUTCOME_SALES`, 6 ad sets, all `COMPLETE_REGISTRATION`, pixel `2261755947685271`.
