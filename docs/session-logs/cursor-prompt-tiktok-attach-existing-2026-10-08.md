# Cursor prompt — TikTok: add ad groups / ads to existing campaigns (2026-10-08)

Matas: "we need a function on the tiktok campaign creator that allows ad sets and/or ads added to existing campaigns — the same as we have for our meta campaign creator."

Meta parity reference: `wizardMode` attach_campaign / attach_adset / attach_all_adsets (lib/types.ts ~l.1254-1321), cross-campaign pickers, attach preflight doctrine (#1013/#1014: inspect only what the payload contains; refuse only on proof), conversion event inherited from the target (#1012), CBO detection (#605/#1010).

TikTok specifics that make this riskier than Meta: the TikTok launcher's failure path DELETES the campaign it created (`cleanupTikTokCampaign`, lib/tiktok/write/orchestrator.ts ~l.194-248) and clears tiktok_write_idempotency for the draft. In attach modes that path must never touch a campaign or ad group the run did not create.

Prompt text sent in chat 2026-10-08.
