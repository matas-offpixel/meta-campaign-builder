# Cursor prompt: Creative Lab learning layer, cross-client and self-optimising (2026-11-06)

Matas: every build should be self-learning and optimising across all ad accounts and ads. The Lab should pull top-performing captions as suggestions per event, plus creative learnings (AI tags, hooks, types, how many creatives is best), visible while building ads, the way he draws on learnings across clients. Operator-only: cross-client information is for his eyes only.

What exists (6 Nov):
- ad_daily_insights: 64,550 rows, 10,534 Meta ads, 1 Jun → 5 Nov 2026.
- creative_tag_assignments: 33,314 rows over 8 dimensions (asset_type, headline_tactic, hook_tactic, intended_audience, messaging_angle, offer_type, seasonality, visual_format), plus caption_style.
- tag_performance: 420 rows (client → vertical → all shrinkage).
- creative_scores: 11,780 rows. launched_ads: 6,439 rows.
- Ad copy (body/headline) is read in lib/reporting/active-creatives-fetch.ts but not stored as its own column. Burned-in overlay text isn't captured anywhere.

```
[Use Opus] REVIEW ONLY first. Do not create a branch or edit files.

Goal: a learning layer that makes the Creative Lab draw on every ad account the way Matas does: proven captions as starting points, creative patterns that win, and how many creatives an ad set should carry. It's visible while building, keeps improving from Lab results, and is operator-only.

Read: lib/learning/** (joins, shrink, read, refresh jobs), lib/ad-daily-insights/**, lib/intelligence/auto-tagger.ts (dimensions, vision input), lib/reporting/active-creatives-fetch.ts (headline/body extraction) and the active_creatives_snapshots payload, launched_ads + campaign_drafts creatives (captions), the creative_lab_* tables and writer.ts, lib/auth (operator session, allowlist) and the client portal / share / /admin routes.

Proposed:
1. Copy library (copy_performance or similar):
   - one row per distinct copy unit (primary text, headline, and later the burned-in overlay) per ad, from the snapshots payload + campaign_drafts captions + Lab captions;
   - normalised: names, dates, venues and prices replaced by placeholders ({artist}, {date}, {venue}, {city}, {price}), so a line from one client becomes a template for another;
   - joined to ad_daily_insights for results and cost per result by stage (registration / ticket sale, via the existing stage logic) and scored as an index against the client's own benchmark (not absolute £, which differs by client and city), with the tag_performance shrinkage.
   - Refreshed in learning-refresh.
2. Overlay text: extend the auto-tagger's vision pass to record on-screen text (an on_screen_text field, overlay vs scene, like M4's overlay check) so burned-in captions from past ads join the library. Cost per ad, and backfill size for the 10.5k ads.
3. Lab writer: generateCaptions takes the top proven templates for the event's stage + vertical (and this client first) as extra few-shot, re-fills placeholders from this event's facts, and runs them through the same validator. Mix: e.g. 2 of n are adapted proven lines and the rest new angles (explore/exploit); say what ratio and why. Proven suggestions also appear in the card as "Proven elsewhere" chips, with the index and n.
4. Creative insights panel in the Lab (and on the campaign drawer while building), from tag_performance + creative_scores:
   - best hook_tactic / visual_format / asset_type / messaging_angle for this client, then the vertical, then all, with n and confidence;
   - "creatives per ad set": ad set cost per result by number of active ads (ad_daily_insights grouped by adset_id and day), shown as a simple curve with the sweet spot and n;
   - hide anything below a minimum n.
5. Self-learning loop: Lab round verdicts (creative_lab_round_ads) write into the same learnings (caption_style, proven templates), so winners rise and losers drop on the next refresh, without manual steps.
6. Operator-only:
   - every cross-client reader lives behind the operator session + allowlist;
   - never imported by /share, /l/, the client portal or /admin/[clientSlug];
   - client names appear only for Matas;
   - a guard test greps those route trees for imports of the cross-client readers, like the existing client-status guard;
   - archived clients stay excluded as today.

Report:
(1) where ad copy can be read for the 10.5k ads (snapshot payload coverage %, launched drafts), and what's missing;
(2) the normalisation approach and its failure cases;
(3) the scoring maths (index vs benchmark, shrinkage, minimum n) on real numbers: the top 5 primary-text templates for ticket-sale stage across all clients, read-only;
(4) the creatives-per-ad-set curve from real data, read-only;
(5) the auto-tagger extension cost and backfill plan;
(6) the privacy guard design;
(7) size and split.
Then stop.
```
