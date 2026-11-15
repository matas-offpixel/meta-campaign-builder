# Cursor prompt: Creative Lab learning layer, rulings + PR 1 (copy capture) (2026-11-06)

Rulings on Cursor's learning-layer review (6 Nov):
1. Copy capture: build the per-ad copy table, filled by a batched read-only `GET /?ids=` of each ad's creative (body, title, every asset_feed_spec variant, effective_object_story_id) inside the ad-daily-insights cron for new ads, plus a backfill script (dry-run default, --apply). Lab ads write their copy at launch. Snapshots and drafts are the fallback only. Migration approved (written, Claude applies).
2. Scoring: benchmark against the event's own stage cost per result (client fallback when the event has under 10 results). n counts events, not ads. "Proven" = 2+ events with a shrunk index ≤ 0.9 against the event.
3. Writer mix is adaptive: 1 proven line when a round has ≤4 captions, 2 at 6+, only lines that pass the bar, otherwise none.
4. Creatives per ad set: no sweet spot in the data, so the panel says so. It leads with "Meta spent on X of the Y ads in this ad set", draws a bucket only at ≥20 ad sets and ≥30 results, and says "no ad count beats another" when the within-ad-set indexes sit within ±0.15.
5. Panel on the campaign drawer: approved, read-only display. Matas wants the learnings visible while building ads.
6. Cross-client reuse: close reuse (an adapted line) only when the line is proven at the same client or at 2+ clients. Otherwise style-only examples with forced rewording, so another client's recognisable line never lands in a different client's public ad. Matas can relax this later.
7. Privacy design approved as proposed: no-read RLS, a server-only cross-client module behind requireOperator(), client names only for Matas, the import-graph guard test, archived clients excluded at refresh and at read.
8. Overlay text: fold on_screen_text into the existing tagger call, behind its own killswitch, with a dry-run backfill. Video frame sampling is phase 2.
9. Order as proposed: 1 → 2 → (3 ∥ 4) → 5.
10. Separate fix, its own prompt later: 25% of ad-days (16,319) resolve to no client, so no learning job sees them.

```
[Use Opus] BUILD learning layer PR 1: per-ad copy capture. Branch cursor/learning-copy-capture off fresh main. Check `gh pr list --search "copy"` first. One PR. Follow your learning-layer review §1 and the rulings in docs/session-logs/cursor-prompt-creative-lab-learning-pr1-2026-11-06.md.

Production database rule: previews use the production Supabase. No DDL or writes from the branch. The migration is written, not applied.

- Migration: an ad_copy table:
  - columns: meta_ad_id (pk), ad_account_id, creative_id, bodies text[], titles text[], descriptions text[], link_caption, call_to_action, effective_object_story_id, source ('graph' | 'lab' | 'snapshot' | 'draft'), fetched_at;
  - RLS with no authenticated read (service role only), because rows hold client ad text.
- Capture inside the ad-daily-insights cron:
  - for ads seen in the run that have no ad_copy row (or a row older than 30 days), batch `GET /?ids=…&fields=creative{body,title,object_story_spec,asset_feed_spec,effective_object_story_id,call_to_action_type}`, at most 50 ids a call;
  - count the calls in meta_calls;
  - a rate-limited account is skipped and reported, like today;
  - read-only.
- Lab launch writes ad_copy (source 'lab') from the caption it sent.
- Snapshot and draft copy only fill gaps (source 'snapshot' / 'draft'), and never overwrite a graph row.
- scripts/backfill-ad-copy.mts: dry-run by default (counts per account and expected calls), --apply writes, --account to scope it.
- Its own killswitch, ENABLE_AD_COPY_CAPTURE ("1"), added to CLAUDE.md.
- Tests:
  - batching at 50;
  - asset_feed_spec variants all captured;
  - existing-post ads keep effective_object_story_id;
  - no overwrite of graph rows by fallbacks;
  - killswitch;
  - a Lab launch writes copy.

VERIFY: npm test, tsc + ESLint on touched files, npm run build. Backfill dry-run against prod: ads to fill, calls per account, total. Push once. Report SHA, PR. Stop.
```

PR 2 (library + normaliser + cross-client module + guard), PR 3 (insights panel, Lab + drawer), PR 4 (writer + chips + verdict feedback) and PR 5 (tagger overlay text) follow, each from the review's section 7.
