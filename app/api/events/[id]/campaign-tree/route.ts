import { NextResponse } from "next/server";

import { loadCampaignTree, type GraphCampaign, type TreeDb, type TreeGraph } from "@/lib/campaign-tree/load";
import { graphGetWithToken } from "@/lib/meta/client";
import { adsetTargetingWritesEnabled } from "@/lib/meta/adset-targeting-write";
import { treeAddWritesEnabled } from "@/lib/campaign-tree/switch";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/campaign-tree
 *
 * The event's campaign tree (R7, RC6): stages → campaigns → ad sets →
 * additions, plus the two write switches the stage sheets show: audience
 * (OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED) and creatives
 * (OFFPIXEL_META_TREE_ADD_WRITES_ENABLED).
 * Session auth; owner RLS scopes the drafts, launched ad sets and additions.
 * Meta is read only: one batched GET per ≤ 50 campaigns, never a write.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let graph: TreeGraph | null = null;
  try {
    const { token } = await resolveServerMetaToken(supabase, user.id);
    graph = {
      async readCampaigns(ids) {
        const out = new Map<string, GraphCampaign>();
        for (let i = 0; i < ids.length; i += 50) {
          const batch = ids.slice(i, i + 50);
          const res = await graphGetWithToken<Record<string, GraphCampaign>>(
            "/",
            {
              ids: batch.join(","),
              fields: "name,effective_status,objective,account_id,adsets.limit(200){id,name,effective_status}",
            },
            token,
          );
          for (const [key, value] of Object.entries(res ?? {})) if (value?.id) out.set(key, value);
        }
        return out;
      },
    };
  } catch {
    graph = null;
  }

  try {
    const tree = await loadCampaignTree(supabase as unknown as TreeDb, graph, id);
    if (!tree) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    console.log(`[campaign-tree] event=${id} campaigns=${tree.campaigns.length} meta_read=${tree.metaRead} meta_calls=${tree.metaCalls}`);
    return NextResponse.json({
      eventId: tree.event.id,
      eventCode: tree.event.event_code,
      view: tree.view,
      metaRead: tree.metaRead,
      audienceWritesEnabled: adsetTargetingWritesEnabled(),
      creativeWritesEnabled: treeAddWritesEnabled(),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
