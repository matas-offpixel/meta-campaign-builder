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
import { clipBucket, clipStripState, roundStripState } from "@/lib/creative-lab/surface";

async function post(eventId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`/api/creative-lab/events/${eventId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}


export function CreativeLabCard({ lab, quoteMode = false }: { lab: CreativeLabCardData; quoteMode?: boolean }) {
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

  const rounds = [...lab.rounds].sort((a, b) => a.roundNo - b.roundNo);
  const newest = rounds.at(-1) ?? null;
  const running = newest?.status === "launched" ? newest : null;
  const waiting = lab.captions.some((caption) => caption.status === "proposed");
  const approved = lab.captions.some((caption) => caption.status === "approved");
  const next = labNextStep({
    lineupCount: lab.lineupRows.length,
    captionsWaiting: waiting,
    roundReady: approved && lab.clips.length > 0 && !running,
    runningRound: running?.roundNo ?? null,
    clipCount: lab.clips.length,
    judgedRound: newest?.status === "judged" ? newest.roundNo : null,
  });
  const working = lab.working;
  const cant = lab.clips.filter((clip) => clipBucket(clip) === "cant").length;
  const clipLines = clipStripState(lab.clips.length, cant);
  const roundLines = roundStripState(newest?.status);
  const starred = lab.lineupRows.some((row) => row.isHeadliner);
  const headlinerNote = lab.lineupRows.length === 0
    ? "Star the headliners once the lineup is in."
    : starred
      ? null
      : "Star the headliners.";

  return (
    <details className="rounded-lg border border-border bg-card" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Creative Lab</summary>
      <div className="space-y-6 border-t border-border px-4 py-4 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        <LabStrip
          eventId={lab.eventId}
          lineup={lab.lineupRows.length}
          clips={lab.clips.length}
          captions={lab.captions.length}
          round={newest?.roundNo ?? null}
          next={next}
          working={working}
          saleDatesMissing={lab.saleDatesMissing}
          states={{
            lineup: lab.lineupRows.length ? "on the bill" : "empty",
            lineupShort: lab.lineupRows.length ? "on bill" : "empty",
            clips: clipLines.line,
            clipsShort: clipLines.short,
            captions: waiting ? "need approval" : approved ? "approved" : "none yet",
            captionsShort: waiting ? "waiting" : approved ? "approved" : "none",
            round: roundLines.line,
            roundShort: roundLines.short,
          }}
        />
        {headlinerNote ? <p className="text-muted-foreground">{headlinerNote}</p> : null}
        <LabLineup eventId={lab.eventId} rows={lab.lineupRows} artists={lab.artists} adAccountId={lab.adAccountId} busy={busy} onSave={(body) => run(body)} />
        <LabClips lab={lab} busy={busy} onSave={(body) => run(body)} onError={setError} />
        <LabCaptions lab={lab} busy={busy} quoteMode={quoteMode} onSave={(body) => run(body)} />
        <LabRound lab={lab} busy={busy} onSave={(body) => run(body)} onLaunch={launchRound} />
      </div>
    </details>
  );
}
