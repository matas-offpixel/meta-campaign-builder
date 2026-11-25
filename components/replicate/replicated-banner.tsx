import { replicatedDraftLine, type ReplicateProvenance } from "@/lib/replicate/replicate";
import { createClient } from "@/lib/supabase/server";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * RC2: a replicated draft opens with "Replicated from {source name}, {date}.
 * Launch runs the checks first." Renders nothing for any other draft. Reads
 * the draft's `replicatedFrom` through the operator's session.
 */
export async function ReplicatedBanner({ draftId }: { draftId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_drafts")
    .select("replicatedFrom:draft_json->replicatedFrom")
    .eq("id", draftId)
    .maybeSingle();
  const provenance = (data as { replicatedFrom?: ReplicateProvenance | null } | null)?.replicatedFrom;
  if (!provenance?.sourceName || !provenance.at) return null;
  return (
    <div data-replicated-from="" className={`border-b border-border bg-muted/40 px-6 py-2 ${VIZ_TYPE.label} text-foreground`}>
      {replicatedDraftLine(provenance)}
    </div>
  );
}
