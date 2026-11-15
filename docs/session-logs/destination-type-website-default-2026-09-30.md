[Use Opus]

# Website ads are launching as Facebook-event ads. Client-visible. Fix the default, stop the whole-ad-set downgrade, and backfill the live ad sets. Two PRs, sequenced; open both as drafts.

Matas, from Ads Manager on `[DHB26-DUBAI] TRAFFIC`, ad *Video – DHB* under *DHB Primary 2*: Destination radio reads **Facebook event** with an empty event field; preview carries a link description *"DHB Tickets Dubai 2026 – Party"* never entered in the launcher; the ad's link goes to the website. *"We cannot be launching ads that cannot be tweaked without changing the destination from event to website. On sale / traffic / awareness needs to be website by default. The ads need to be exactly as on launcher. Clients have questioned this already."*

## Root cause, in the repo

`lib/meta/adset.ts:742` `resolveAdSetDestinationType`: `"WEBSITE"` for `traffic`/`registration` only (#770); `undefined` for `purchase`, `initiate_checkout`, `awareness`, `engagement`; and `undefined` for traffic/registration too when **any** assigned creative is `existing_post` (#777, subcode 1815676). With the field omitted and the Page holding an upcoming event, Meta classifies every ad in the ad set as an event ad — the radio, and the event name as link description. The app never sends that description (`creative.ts:405,674,852` only carry `creative.description`). #777 chose the wrong side: one boost silently turned every website ad beside it into an event ad.

## PR A — `cursor/destination-type-website-default`
1. `WEBSITE` default for `traffic`, `registration`, `purchase`, `initiate_checkout`. For `awareness`/`engagement`: test live whether Meta accepts it (create paused, read back, delete); set it if yes, leave unset with the error if no.
2. Boosts no longer downgrade the ad set. Test live whether a boost carrying #983's `call_to_action.value.link` is accepted in a WEBSITE ad set. Yes → delete #777's branch. No → boosts without a URL get their own ad set with the field unset; never the whole ad set.
3. Preflight: refuse a `new`-creative ad into an ad set whose resolved `destination_type` is not `WEBSITE` on a website-bound objective; name the ad set.
4. Importer carries `destination_type`; missing → new default + `dropped[]` `destination_type_defaulted`.
Guards: no migration; zero new write helpers (#969); no TikTok/optimisation/Google changes. Tests: golden per objective; §2 outcome; preflight; DHB relaunch payload.

## PR B — `cursor/backfill-adset-destination` (after A)
Reuse #989's read-merge-write module and gate for **Set website destination** on the Published row's ad-set picker: read `destination_type,effective_status,campaign_id`, write `{ destination_type: "WEBSITE" }` only, ledger `adset_destination_update`, same refusals. Verify live that Meta accepts the update on a running ad set; if not, list the ad sets needing a manual switch (published website-objective drafts × live read). Migration for the ledger CHECK op_kind, numbered after `main`'s highest, Matas applies.

## Both
No Meta token → mark each of the three live checks unmade; no assumptions substituted. Full `npm test`, `npm run build`, check-run conclusions in the thread.
