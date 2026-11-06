"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LabCaptions } from "@/components/dashboard/events/creative-lab/captions";
import { LabClips } from "@/components/dashboard/events/creative-lab/clips";
import { LabLineup } from "@/components/dashboard/events/creative-lab/lineup";
import { LabRound } from "@/components/dashboard/events/creative-lab/round";
import { LabStrip } from "@/components/dashboard/events/creative-lab/strip";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { labNextStep } from "@/lib/creative-lab/lineup";

async function post(eventId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`/api/creative-lab/events/${eventId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}


export function CreativeLabCard({ lab }: { lab: CreativeLabCardData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const result = await post(lab.eventId, body);
      if (!result.ok) {
        setError(String(result.json.error || result.json.refused || "Request failed"));
        return result;
      }
      const caption = result.json.startingCaption as { ok?: boolean; errors?: { detail: string }[] } | null | undefined;
      if (caption && caption.ok === false) {
        setError(caption.errors?.map((item) => item.detail).join("; ") || "The starting caption did not pass.");
      }
      router.refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function launchRound(roundId: string) {
    const round = lab.rounds.find((item) => item.id === roundId);
    if (round?.status === "draft") {
      const approved = await run({ action: "approveRound", roundId });
      if (!approved?.ok) return;
    }
    const res = await fetch(`/api/creative-lab/rounds/${roundId}/launch`, { method: "POST" });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) setError(json.error || "Launch failed");
    router.refresh();
  }

  const running = lab.rounds.find((round) => round.ads.some((ad) => ad.metaAdId));
  const next = labNextStep({
    lineupCount: lab.lineupRows.length,
    unclearedWithClips: lab.lineupRows.some((row) => row.clipCount > 0 && !row.clearedAt),
    captionsWaiting: lab.captions.some((caption) => caption.status === "proposed"),
    roundReady: lab.captions.some((caption) => caption.status === "approved") && lab.clips.length > 0 && !running,
    runningRound: running?.roundNo ?? null,
    clipCount: lab.clips.length,
  });
  const working = lab.working;

  return (
    <details className="rounded-lg border border-border bg-card" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Creative Lab</summary>
      <div className="space-y-6 border-t border-border px-4 py-4 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        <LabStrip lineup={lab.lineupRows.length} clips={lab.clips.length} captions={lab.captions.length} round={lab.rounds[0]?.roundNo ?? null} next={next} working={working} />
        {!lab.facts || lab.facts.headliners.length === 0 ? <p>headliners not set</p> : null}
        <LabLineup eventId={lab.eventId} rows={lab.lineupRows} artists={lab.artists} adAccountId={lab.adAccountId} busy={busy} onSave={(body) => run(body)} />
        <LabClips lab={lab} busy={busy} onSave={(body) => run(body)} onError={setError} />
        <LabCaptions lab={lab} busy={busy} onSave={(body) => run(body)} />
        <LabRound lab={lab} busy={busy} onSave={(body) => run(body)} onLaunch={launchRound} />
      </div>
    </details>
  );
}
