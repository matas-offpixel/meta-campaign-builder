"use client";

import { useState } from "react";

import { ClaimLadder, ReleasesPanel } from "@/components/dashboard/asset-bank/surface";
import { todayMark } from "@/lib/releases/london";
import { nextReleaseListAt } from "@/lib/releases/derived";
import { rowsFromReleases } from "@/lib/releases/view";
import { completeLadder, defaultLadder } from "@/lib/releases/ladder";
import { presentLadder } from "@/lib/releases/present";
import type { LadderRung, Release, ReleaseState } from "@/lib/releases/types";
import { isBackfilled, mountsReleases } from "@/lib/releases/visibility";
import { derivedProposals, nextRung, sellingFastDays, type DerivedContext } from "@/lib/ticket-warnings/next-rung";

export function LiveReleases({
  eventId,
  releases,
  ladder,
  now,
  status = "upcoming",
  counts = [],
  eventAt = null,
  artists = [],
  lastProposalAt = null,
}: {
  eventId: string;
  releases: Release[];
  ladder: LadderRung[];
  /** One instant from the server render. The timeline and the claims both use it. */
  now: string;
  status?: string;
  counts?: { at: string; sold: number }[];
  eventAt?: string | null;
  artists?: { name: string; addedAt: string }[];
  lastProposalAt?: string | null;
}) {
  const [rows, setRows] = useState(releases);
  const used = completeLadder(ladder);
  const context: DerivedContext = {
    counts,
    nextListAt: nextReleaseListAt(rows, now),
    eventAt,
    artists,
    lastProposalAt,
    sellingFastDays: sellingFastDays(used),
  };
  const view = rowsFromReleases(rows, used, now, context);
  const claims = [
    ...rows.filter((release) => !isBackfilled(release)).map((release) => {
      const rung = nextRung(release, used, rows, now, context);
      return {
        text: rung?.claim ?? release.name,
        chip: rung?.met ? "met" : "later",
        tone: (rung?.met ? "ok" : "dash") as "ok" | "dash",
      };
    }),
    ...derivedProposals(used, rows, now, context).map((proposal) => ({
      text: proposal.claim,
      chip: "proposed",
      tone: "warn" as const,
    })),
  ];

  async function post(body: Record<string, unknown>): Promise<{ ask?: boolean; release?: Release }> {
    const res = await fetch(`/api/events/${eventId}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  if (!mountsReleases(status)) return null;

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
      todayLabel={todayMark(now)}
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

export function LiveLadder({ rungs, clientName }: { rungs: LadderRung[]; clientName?: string }) {
  const shown = presentLadder(completeLadder(rungs), clientName);
  const seed = presentLadder(defaultLadder(), clientName);
  return <ClaimLadder live initial={shown.length ? shown : seed} resetTo={seed} />;
}
