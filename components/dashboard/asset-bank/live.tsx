"use client";

import { useState } from "react";

import { ClaimLadder, ReleasesPanel, type LadderRow } from "@/components/dashboard/asset-bank/surface";
import { nextReleaseListAt } from "@/lib/releases/derived";
import { rowsFromReleases } from "@/lib/releases/view";
import { completeLadder, defaultLadder } from "@/lib/releases/ladder";
import type { LadderRung, Release, ReleaseState } from "@/lib/releases/types";
import { isBackfilled, mountsReleases } from "@/lib/releases/visibility";
import { derivedProposals, nextRung, sellingFastDays, type DerivedContext } from "@/lib/ticket-warnings/next-rung";

export function LiveReleases({
  eventId,
  releases,
  ladder,
  status = "upcoming",
  counts = [],
  eventAt = null,
  artists = [],
}: {
  eventId: string;
  releases: Release[];
  ladder: LadderRung[];
  status?: string;
  counts?: { at: string; sold: number }[];
  eventAt?: string | null;
  artists?: { name: string; addedAt: string }[];
}) {
  const [rows, setRows] = useState(releases);
  const used = completeLadder(ladder);
  const now = new Date().toISOString();
  const context: DerivedContext = {
    counts,
    nextListAt: nextReleaseListAt(rows, now),
    eventAt,
    artists,
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

function claimCell(rung: LadderRung): string {
  if (rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call") {
    return "\"{sold-out releases} RELEASE SOLD OUT\" / \"{live release's claim}\"";
  }
  return rung.claimTemplate;
}

function triggerLabel(rung: LadderRung): string {
  if (rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call") return "2+ releases sold out · 1 on sale or selling fast";
  if (rung.triggerKind === "velocity") return `Sold now − sold ${rung.options.windowDays ?? 14} days ago ≥ ${rung.options.threshold ?? rung.triggerValue}`;
  if (rung.triggerKind === "price_rise_date") return `Next release's list time within ${rung.options.days ?? 4} days`;
  if (rung.triggerKind === "countdown_pct") return `Days to show ≤ ${rung.options.days ?? 14} · and the % rung's trigger met`;
  if (rung.triggerKind === "lineup_add") return "A new row in the typed lineup";
  if (rung.triggerKind === "count_pct") return `Actual ${rung.triggerValue}% sold`;
  if (rung.triggerValue === "on_sale") return "Release list time passed · state on sale";
  if (rung.triggerValue === "selling_fast") return `Selling fast for ${rung.options.days ?? 7}+ days, no count`;
  if (rung.triggerValue === "final_x") return "State final X";
  if (rung.triggerValue === "sold_out") return "State sold out";
  if (rung.triggerKind === "page_remaining") return "The page shows remaining";
  return rung.claimTemplate;
}

export function LiveLadder({ rungs }: { rungs: LadderRung[] }) {
  const shown = completeLadder(rungs);
  const initial: LadderRow[] = shown.map((rung) => ({
    trigger: triggerLabel(rung),
    claim: claimCell(rung),
    accent: rung.triggerKind === "roll_call",
  }));
  const seed: LadderRow[] = defaultLadder().map((rung) => ({
    trigger: triggerLabel(rung),
    claim: claimCell(rung),
    accent: rung.triggerKind === "roll_call",
  }));
  return <ClaimLadder live initial={initial.length ? initial : seed} resetTo={seed} />;
}
