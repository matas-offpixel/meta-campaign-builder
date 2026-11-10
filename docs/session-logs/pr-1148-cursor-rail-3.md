# Session log

## PR

- **Number:** 1148
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1148
- **Branch:** `cursor/rail-3`

## Summary

The campaign rail leads with Best copy shapes from copy_features, collapsed by ads_hash, and Copy lines stays empty with the R22 sentence until a line runs in two shows. TikTok platform rows use all three thin floors, and the drawer state is framed at 1176.

## Scope / files

- `lib/insights-rail/model.ts` — shapes, copy lines, TikTok thin test
- `lib/learning/copy/score.ts`, `lib/learning/copy-features.ts` — ads_hash
- `supabase/migrations/223_copy_features_ads_hash.sql` — nullable column, not applied
- `components/insights-rail/` — facets, sub-line, drawer scrim, IR9 Today stand-in
- `components/dashboard/events/creative-lab/captions.tsx` — the R22 sentence on the writer
- `scripts/plan-frames/rail-fixtures.ts`, `rail-ids.ts`, `rail-shots.mjs` — IR4, IR9

## Validation

- [x] rail model, rail-frames, rail-sources, copy-features, cross-client guard
- [ ] `npm run build`
- [x] frames IR3, IR4, IR9 from two matching Ubuntu runs (IR pair 42724782279 / 42724790431; CL pair 42724797545 / 42724804814; CL5 re-pair 42725690535 / 42725699885)
- [x] fail-round pair, both 0: IR 42799008506 / 42799014065, CL 42799018587 / 42799023023

## Notes

Migration 223 sha256 `185ac37939387812cbd1a36f3ee2f1439d1f9e6b0075db08118354e5d20412bf`. Not applied.

R13 sorts cheapest first, so IR4's result names the 0.65 opener, not the figure's 4+ line sentence. That sentence is what the 0.75 row says when it is the winner. The figure's "1 emoji" and "Urgency scarcity" rows are the record's placeholders; the fixture uses the stored bands "1–2 emoji" and "Countdown scarcity". The scope toggle stays on This client while the section reads All clients. The confidence line says "all clients", and the sheet uses the same words in place of "All". IR3 did not move.

Design fail round: the R22 sentence sits under the writer's Write button, labelled Proven elsewhere. The drawer hides its collapsed edge tab while open.
