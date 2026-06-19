# Session log — default-on-reg-cpr-pills

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/default-on-reg-cpr-pills`

## Summary

Registrations + CPR pills on the `LegacyTrendChart` defaulted to OFF on initial
mount, requiring a manual click every time the team opened a tagged event's chart.
This PR auto-enables both pills the first time mailchimp snapshot data becomes
available for the chart — which is the primary metric the team wants to see at a
glance. `BrandCampaignTrendChart` (IRWOHD path) already defaulted these pills ON
and is unchanged.

## Scope / files

- `components/dashboard/events/event-trend-chart.tsx` — single-change: added
  `didAutoEnableMailchimp` state + "adjust state in render" guard that adds
  `"registrations"` and `"cpr"` to `active` the first time `mailchimpSnapshots`
  arrives with data. Uses the React 19 pattern from
  https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  to avoid the project's `react-hooks/set-state-in-effect` lint rule.

## Validation

- [x] `npm run build` — clean
- [x] `npx eslint` on changed file — 0 errors (2 pre-existing warnings in
      unchanged lines)

## Notes

- Once `didAutoEnableMailchimp` is set to `true`, user toggle-offs are respected:
  the auto-enable never fires again for that component mount.
- Events without any mailchimp snapshots are unaffected — `hasMailchimpData`
  stays `false` and the condition is never entered.
- Remounting the component (navigate away + back) resets to default state, which
  is the expected behavior.
