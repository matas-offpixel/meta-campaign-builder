"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FUNNEL_STAGE_PRESETS } from "@/lib/audiences/funnel-presets";
import { FUNNEL_STAGE_LABELS } from "@/lib/audiences/metadata";
import type { FunnelStage } from "@/lib/types/audience";

export function AudienceListActions({
  clientId,
  draftAudienceIds,
  writesEnabled,
}: {
  clientId: string;
  draftAudienceIds: string[];
  writesEnabled: boolean;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  async function createAllDrafts() {
    setCreating(true);
    await fetch("/api/audiences/batch-write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audienceIds: draftAudienceIds }),
    });
    router.refresh();
    setCreating(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {writesEnabled && draftAudienceIds.length > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void createAllDrafts()}
          disabled={creating}
        >
          {creating ? "Creating..." : `Create all drafts (${draftAudienceIds.length})`}
        </Button>
      )}
      <Button type="button" onClick={() => setModalOpen(true)}>
        BUILD FUNNEL STACK
      </Button>
      <Link
        href={`/audiences/${clientId}/bulk`}
        className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-card"
      >
        Bulk video stack
      </Link>
      <Link
        href={`/audiences/${clientId}/new`}
        className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-card"
      >
        New audience
      </Link>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-heading text-2xl tracking-wide">
                  Build funnel stack
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a signed-off preset bundle, then fill sources before
                  saving or writing to Meta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              >
                Close
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {(["top_of_funnel", "mid_funnel", "bottom_funnel"] as FunnelStage[]).map(
                (stage) => (
                  <Link
                    key={stage}
                    href={`/audiences/${clientId}/new?presetBundle=${stage}`}
                    className="rounded-md border border-border bg-background p-4 hover:border-primary/50 hover:bg-primary/5"
                  >
                    <p className="font-heading text-lg tracking-wide">
                      {FUNNEL_STAGE_LABELS[stage]}
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {FUNNEL_STAGE_PRESETS[stage].length}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {descriptionForStage(stage)}
                    </p>
                  </Link>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function descriptionForStage(stage: FunnelStage) {
  if (stage === "top_of_funnel") {
    return "Broad engagement, followers, video views and PageView pools.";
  }
  if (stage === "mid_funnel") {
    return "Recent engagement, high-intent viewers and site content visitors.";
  }
  return "Hot engagement, 95% viewers and checkout intent audiences.";
}
