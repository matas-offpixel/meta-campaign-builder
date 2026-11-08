"use client";

import { useState } from "react";

import { ClaimLadder, ReleasesPanel, type LadderRow } from "@/components/dashboard/asset-bank/surface";
import { rowsFromReleases } from "@/lib/releases/view";
import { defaultLadder } from "@/lib/releases/ladder";
import type { LadderRung, Release, ReleaseState } from "@/lib/releases/types";
import { nextRung } from "@/lib/ticket-warnings/next-rung";

export function LiveReleases({ eventId, releases, ladder }: { eventId: string; releases: Release[]; ladder: LadderRung[] }) {
  const [rows, setRows] = useState(releases);
  const used = ladder.length ? ladder : defaultLadder();
  const now = new Date().toISOString();
  const view = rowsFromReleases(rows, used, now);
  const claims = rows.map((release) => {
    const rung = nextRung(release, used, rows, now);
    return {
      text: rung?.claim ?? release.name,
      chip: rung?.met ? "met" : "later",
      tone: (rung?.met ? "ok" : "dash") as "ok" | "dash",
    };
  });

  async function post(body: Record<string, unknown>): Promise<{ ask?: boolean; release?: Release }> {
    const res = await fetch(`/api/events/${eventId}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  return (
    <ReleasesPanel
      kicker=""
      place=""
      headline={view.headline}
      headlineRest={view.headlineRest}
      narrowRest={view.headlineRest}
      rows={view.rows}
      claims={claims}
      claimSummary=""
      footnote="tap a state to set it"
      onState={async (id, state: ReleaseState, confirmed) => {
        const body = await post({ releaseId: id, state, confirmed });
        if (body.ask) return { ask: true };
        if (body.release) setRows((current) => current.map((release) => (release.id === id ? body.release! : release)));
      }}
      onCount={async (id, sold) => {
        const body = await post({ releaseId: id, sold });
        if (body.release) setRows((current) => current.map((release) => (release.id === id ? body.release! : release)));
      }}
    />
  );
}

function triggerLabel(rung: LadderRung): string {
  if (rung.triggerKind === "count_pct") return `Actual ${rung.triggerValue}% sold`;
  if (rung.triggerValue === "on_sale") return "Release list time passed · state on sale";
  if (rung.triggerValue === "selling_fast") return `Selling fast for ${rung.options.days ?? 7}+ days, no count`;
  if (rung.triggerValue === "final_x") return "State final X";
  if (rung.triggerValue === "sold_out") return "State sold out";
  if (rung.triggerKind === "page_remaining") return "The page shows remaining";
  return rung.claimTemplate;
}

export function LiveLadder({ rungs }: { rungs: LadderRung[] }) {
  const initial: LadderRow[] = rungs
    .filter((rung) => rung.triggerValue !== "roll_call")
    .map((rung) => ({ trigger: triggerLabel(rung), claim: rung.claimTemplate, narrow: true }));
  const seed: LadderRow[] = defaultLadder()
    .filter((rung) => rung.triggerValue !== "roll_call")
    .map((rung) => ({ trigger: triggerLabel(rung), claim: rung.claimTemplate, narrow: true }));
  return <ClaimLadder live initial={initial.length ? initial : seed} resetTo={seed} />;
}
