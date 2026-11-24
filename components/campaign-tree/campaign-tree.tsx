"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AudienceStageSheet } from "@/components/campaign-tree/audience-stage-sheet";
import { CampaignTreeView, adsManagerCampaignHref, campaignMenuItems } from "@/components/campaign-tree/campaign-tree-view";
import { ReplicateDialog } from "@/components/replicate/replicate-dialog";
import { isTreeStage, stageAccount, stageSheetCampaigns, type TreeStage, type TreeView } from "@/lib/campaign-tree/tree";
import { duplicateCampaign } from "@/lib/db/drafts";
import { createClient } from "@/lib/supabase/client";

/**
 * The live campaign tree on the event's Campaigns tab (R7). Reads
 * GET /api/events/[id]/campaign-tree. "Add creatives to…" opens the
 * bulk-attach flow for the stage (/events/[id]/bulk-attach?stage=…), which
 * ends in the stage sheet; "Add audience to…" opens the sheet here. A
 * campaign's ⋯ menu carries Replicate to event… (RC1) above Duplicate.
 */

interface TreeResponse {
  eventId: string;
  eventCode: string | null;
  view: TreeView;
  metaRead: boolean;
  audienceWritesEnabled: boolean;
  error?: string;
}

export function CampaignTree({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [data, setData] = useState<TreeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [audienceStage, setAudienceStage] = useState<TreeStage | null>(null);
  const [replicateDraft, setReplicateDraft] = useState<string | null>(null);
  const params = useSearchParams();
  const [handOffDone, setHandOffDone] = useState(false);
  // The library's "Add audience to…" lands here: ?add=audience&stage=on_sale.
  const handOffStage = params.get("stage");
  const openStage: TreeStage | null =
    audienceStage ?? (!handOffDone && params.get("add") === "audience" && isTreeStage(handOffStage) ? handOffStage : null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${encodeURIComponent(eventId)}/campaign-tree`)
      .then(async (res) => {
        const json = (await res.json()) as TreeResponse;
        if (cancelled) return;
        if (!res.ok || json.error) setFailed(true);
        else {
          setFailed(false);
          setData(json);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, reload]);

  const duplicate = useCallback(
    async (draftId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const copy = await duplicateCampaign(draftId, user.id, eventId);
      if (copy) router.push(`/campaign/${copy.id}`);
    },
    [eventId, router],
  );

  if (failed || !data || data.view.stages.every((s) => s.campaigns.length === 0)) return null;

  const onAction = (stage: TreeStage, kind: "creatives" | "audience") => {
    if (kind === "audience") {
      setAudienceStage(stage);
      return;
    }
    const account = stageAccount(stageSheetCampaigns(data.view, stage));
    const qs = new URLSearchParams({ stage, ...(account ? { adAccountId: account } : {}) });
    router.push(`/events/${eventId}/bulk-attach?${qs.toString()}`);
  };

  return (
    <div className="mb-5">
      <CampaignTreeView
        view={data.view}
        onAction={onAction}
        menuFor={(c) =>
          campaignMenuItems(c, {
            onReplicate: (row) => setReplicateDraft(row.draftId),
            onDuplicate: (row) => row.draftId && void duplicate(row.draftId),
            onEdit: (row) => row.draftId && router.push(`/campaign/${row.draftId}`),
            adsManagerHref: adsManagerCampaignHref,
          })
        }
      />
      {openStage ? (
        <AudienceStageSheet
          eventId={eventId}
          stage={openStage}
          campaigns={stageSheetCampaigns(data.view, openStage)}
          writesEnabled={data.audienceWritesEnabled}
          onClose={() => {
            setAudienceStage(null);
            setHandOffDone(true);
          }}
          onDone={() => setReload((n) => n + 1)}
        />
      ) : null}
      {replicateDraft ? (
        <ReplicateDialog
          draftId={replicateDraft}
          open
          onClose={() => setReplicateDraft(null)}
          onDuplicate={() => void duplicate(replicateDraft)}
        />
      ) : null}
    </div>
  );
}
