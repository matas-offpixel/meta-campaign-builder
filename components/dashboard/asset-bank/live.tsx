"use client";

import { useState } from "react";

import { ClaimLadder, ReleasesPanel } from "@/components/dashboard/asset-bank/surface";
import { nextReleaseListAt } from "@/lib/releases/derived";
import { rowsFromReleases } from "@/lib/releases/view";
import { completeLadder, defaultLadder } from "@/lib/releases/ladder";
import { presentLadder } from "@/lib/releases/present";
import type { LadderRung, Release, ReleaseState } from "@/lib/releases/types";
import { mountsReleases } from "@/lib/releases/visibility";
import { claimPanel, derivedProposals, sellingFastDays, type DerivedContext, type RanRung } from "@/lib/ticket-warnings/next-rung";

export function LiveReleases({
  eventId,
  releases,
  ladder,
  status = "upcoming",
  counts = [],
  eventAt = null,
  artists = [],
  lastProposalAt = null,
  warnings = [],
}: {
  eventId: string;
  releases: Release[];
  ladder: LadderRung[];
  status?: string;
  counts?: { at: string; sold: number }[];
  eventAt?: string | null;
  artists?: { name: string; addedAt: string }[];
  lastProposalAt?: string | null;
  warnings?: RanRung[];
}) {
  const [rows, setRows] = useState(releases);
  const used = completeLadder(ladder);
  const now = new Date().toISOString();
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
    ...claimPanel(rows, used, now, context, warnings).map((row) => ({
      text: row.text,
      chip: row.chip,
      tone: row.tone,
      ...(row.needs ? { needs: row.needs } : {}),
    })),
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
