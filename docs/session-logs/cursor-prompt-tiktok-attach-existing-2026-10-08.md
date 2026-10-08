# Cursor prompt — TikTok: add ad groups / ads to existing campaigns (2026-10-08)

Matas: "we need a function on the tiktok campaign creator that allows ad sets and/or ads added to existing campaigns — the same as we have for our meta campaign creator."

Meta parity reference: `wizardMode` attach_campaign / attach_adset / attach_all_adsets (lib/types.ts ~l.1254-1321), cross-campaign pickers, attach preflight doctrine (#1013/#1014: inspect only what the payload contains; refuse only on proof), conversion event inherited from the target (#1012), CBO detection (#605/#1010).

TikTok specifics that make this riskier than Meta: the TikTok launcher's failure path DELETES the campaign it created (`cleanupTikTokCampaign`, lib/tiktok/write/orchestrator.ts ~l.194-248) and clears tiktok_write_idempotency for the draft. In attach modes that path must never touch a campaign or ad group the run did not create.

Prompt text sent in chat 2026-10-08.

## Review round 1 (#1036, head c2c4844) — not merged
No SQL migration (the "migration" is `migrate-draft.ts`). New mode verified byte-identical against main with the PR's golden file; no campaign status/delete reachable in attach mode; killswitch, launchPaused DISABLE, attach-targets auth all OK.
- B1: rollback deletes ledger-reused ids. `withTikTokWriteIdempotency` returns an earlier `op_result_id` on a hit (idempotency.ts:58-60); attach-orchestrator.ts:112/132 pushes it into the "created" lists; loose ads have no target guard (l.225). Relaunching a published draft into the same target (server has no publishedIds check) + any later failure = DELETE of a live earlier ad/ad group. The rollback test's "earlier" row uses a different payload hash, so it never exercises a hit.
- S1 retry after failed delete returns stale ids; S2 snapshot fallback proceeds (Smart+ parent not provable); S3 silent skips at plan.ts:431/585; S4 draft Smart+ not blocked in ads-only modes; N3 ads-only payloads built from `draft` not `adDraft`.
Round-2 prompt sent in chat 2026-10-08.
