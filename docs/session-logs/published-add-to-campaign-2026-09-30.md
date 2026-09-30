[Use Opus]

# "Add to campaign" on a published campaign — one click into the bulk-attach wizard's Selected campaign block with the campaign already chosen. One PR, `cursor/published-add-creatives`, off fresh `main`. Open, don't merge.

Matas: *"rather than me having to duplicate a published campaign and reload it and go through steps to add to existing ad sets, just have the function in the published campaign already."* Then: *"add to campaigns even"* and, pointing at the wizard's Selected campaign block (chip + two mode cards): *"if we can have this section on that view it would save me effort."*

## What exists
- Published row (`components/library/library-rows.tsx` / `campaign-library.tsx`) has Add audience to ad sets (#989) and Relaunch.
- `app/(dashboard)/clients/[id]/bulk-attach/{page,wizard}.tsx` takes a pre-filled context via `?queueId=` (#583/#590). Reuse that mechanism.
- The wizard already renders the **Selected campaign** block: campaign chip (name · objective · status · id · raw objective) and two mode cards — *Create new ad set* (`attach_campaign`) / *Attach ads to all existing ad sets* (`attach_all_adsets`).

## Build
1. One button on the Published row: **Add to campaign**. Enabled when the draft has `metaCampaignId` and `settings.clientId`; otherwise disabled with the reason.
2. Handoff: `/clients/{clientId}/bulk-attach?campaignId={metaCampaignId}&draftId={draft.id}`. `page.tsx` builds a campaign context the way `queueId` does: one `ExistingMetaCampaignSnapshot` from a live `fetchCampaignById` (archived → refused with the #985 message), copy/CTA/URL/page+IG identity pre-filled from the published draft's first creative, no assets pre-filled.
3. The wizard opens on the existing Selected campaign block with the chip populated and both mode cards present and unselected. The operator picks; the flow proceeds as today for that mode. Campaign locked; more campaigns addable. Do not build a second copy of the block.
4. The attach draft is its own row as today; link back via `sourceDraftId` if the field exists for queue handoffs, else add it optional in `draft_json`.

## Guards
No migration. No change to `app/api/meta/launch-campaign/route.ts`. Relaunch and Duplicate unchanged. #969 write-set guard unchanged. Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`.

## Test plan
Row enablement; handoff href; `page.tsx` context (live objective, copy/CTA/URL/identity from first creative, no assets); archived → refused; `queueId` handoff unchanged; opened from the row → Selected campaign block rendered with the chip from the live read and both cards unselected; launch payload for each mode identical to a manual attach for the same inputs (golden).

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
