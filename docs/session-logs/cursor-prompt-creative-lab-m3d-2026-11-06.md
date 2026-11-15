# Cursor prompt: Creative Lab M3d, artist set-up gaps found on the first real artist (2026-11-06)

```
[Use Opus] BUILD Creative Lab M3d: two artist set-up gaps found while setting up Enzo Siragusa. Branch cursor/creative-lab-m3d off fresh main (after #1085). One PR. Production database rule as before: no DDL or writes from the branch. Migration 202 is written, not applied.

=== 1. Artist Page picker has no options ===
- The card's Artist Page dropdown only lists the saved id, because Page options load from a round's ad account and a new artist has no round.
- Load options from the event's client ad account (clients.meta_ad_account_id, else the event's) through the same pages source the wizard uses. Show the Page name with the id.
- On choosing a Page, resolve its connected Instagram account the way the wizard does. Show the account name and id.
- Saving must never clear an existing instagram_actor_id unless a different Page is chosen. Test: Save with the Page unchanged keeps instagram_actor_id.

=== 2. Past appearances the client didn't run ===
- "Back in Southampton" is true for Enzo Siragusa (Matas confirmed), but the show was for another promoter, so no event of this client holds it.
- Migration 202: creative_lab_artists.played_cities text[] not null default '{}', with a comment: cities the artist has played before, confirmed by the operator, any promoter.
- The past/city check passes when the city is in the speaking artist's played_cities, or a past client event holds it (the current rule).
- Card: an editable "Played before (cities)" field on the artist row.
- Tests both ways.

=== VERIFY ===
npm test, tsc + ESLint on touched files, npm run build. Read-only: the validator result for Enzo's starting caption with played_cities ['Southampton'] (simulated, not written) → ok. Push once. Report SHA, PR. Stop.
```
