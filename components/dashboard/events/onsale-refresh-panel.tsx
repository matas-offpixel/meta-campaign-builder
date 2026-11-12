"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { PanelLine, PanelProposal } from "@/lib/onsale-refresh/read";
import { dayMonth, shortDay, weekLabel } from "@/lib/onsale-refresh/schedule";

/**
 * The Refresh panel (R4, F1 at 1280, F2 at 393), read-only in P1: the
 * latest proposal per campaign, every line marked Shadow, Accept and
 * Reject drawn but disabled, Apply accepted (0) disabled. The words are
 * the record's. P2 wires the clicks.
 */

const KIND_LABEL: Record<PanelLine["kind"], string> = {
  add_creative: "Add",
  claim_ready: "Claim",
  pause_creative: "Pause",
  bring_back_audience: "Bring back",
  missing_default: "Missing default",
  drop_audience: "Drop",
  move_budget: "Move",
};

const CREATIVE_KINDS = new Set<PanelLine["kind"]>(["add_creative", "claim_ready", "pause_creative"]);

function nextLine(proposal: PanelProposal, wide: boolean): string {
  const parts: string[] = [];
  const cycleWord = proposal.nextCycleKind ? `${proposal.nextCycleKind} cycle` : "cycle refresh";
  if (proposal.nextCheck) {
    const kind = proposal.nextCheck === proposal.nextCycle ? cycleWord : "budget and audiences";
    parts.push(wide ? `${shortDay(proposal.nextCheck)} (${kind})` : shortDay(proposal.nextCheck));
  }
  if (wide && proposal.nextCycle && proposal.nextCycle !== proposal.nextCheck) parts.push(`${shortDay(proposal.nextCycle)} (${cycleWord})`);
  return parts.length ? ` · next: ${parts.join(" · ")}` : "";
}

/** The wide and the narrow wording of one line; the viewport picks (sm: 640px). */
function Wide({ wide, narrow }: { wide: string; narrow: string }) {
  if (wide === narrow) return <>{wide}</>;
  return (
    <>
      <span className="hidden sm:inline">{wide}</span>
      <span className="sm:hidden">{narrow}</span>
    </>
  );
}

function LineRow({ line, shadow }: { line: PanelLine; shadow: boolean }) {
  const disabled = shadow || line.state !== "to_review";
  return (
    <li className="rounded border border-border/70 p-3" data-kind={line.kind}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[line.kind]}</span>
            <span className="break-words text-sm font-medium">{line.title}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Wide wide={line.detail} narrow={line.narrow.detail} />
          </p>
          <p className="mt-0.5 hidden text-xs sm:block">{line.writeText}</p>
          {line.narrow.writeText ? <p className="mt-0.5 text-xs sm:hidden">{line.narrow.writeText}</p> : null}
          {line.blockedReason ? <p className="mt-0.5 text-xs text-destructive">{line.blockedReason}</p> : null}
          {line.state !== "to_review" ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {line.state === "expired" ? "Expired" : line.state[0]!.toUpperCase() + line.state.slice(1)}
              {line.reason ? ` — ${line.reason}` : ""}
            </p>
          ) : null}
        </div>
        {line.supply ? (
          <Link href="#lab-round" className="shrink-0 text-xs underline underline-offset-2">
            Open Lab
          </Link>
        ) : (
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="outline" disabled={disabled || Boolean(line.blockedReason)} title={shadow ? "Shadow: nothing here can be applied yet" : undefined}>
              Accept
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} title={shadow ? "Shadow: nothing here can be applied yet" : undefined}>
              Reject
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** "No pauses: … Watch: name · detail." wide; "No pauses · Watch: name · spend · results" at 393 (F2's wording). */
function Watch({ label, items, note }: { label: string; items: { title: string; detail: string; narrow?: string }[]; note: string }) {
  if (!note && !items.length) return null;
  const shortNote = note.split(/[:.]/)[0] ?? "";
  const wide = `${note ? `${note} ` : ""}${items.length ? `${label}: ${items.map((item) => `${item.title} · ${item.detail}`).join("; ")}.` : ""}`.trim();
  const narrow = [shortNote, items.length ? `${label}: ${items.map((item) => item.narrow ?? `${item.title} · ${item.detail.split(" · ").slice(0, 2).join(" · ")}`).join("; ")}` : ""].filter(Boolean).join(" · ");
  return (
    <p className="text-xs text-muted-foreground">
      <Wide wide={wide} narrow={narrow} />
    </p>
  );
}

export type OnSaleRefreshPanelViewProps = {
  eventId: string;
  proposals: PanelProposal[];
};

/** The panel from data; the viewport decides the wide or the narrow wording. Nothing here fetches. */
export function OnSaleRefreshPanelView({ eventId, proposals }: OnSaleRefreshPanelViewProps) {
  if (!proposals.length) {
    return (
      <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4">
        <p className="text-sm font-medium">On-sale refresh</p>
        <p className="mt-1 text-xs text-muted-foreground">No proposal yet. The first one comes on the next cycle Monday, ready by 08:00.</p>
      </section>
    );
  }
  const head = proposals[0]!;
  const shadow = head.mode === "shadow";
  const accepted = proposals.flatMap((p) => p.lines).filter((line) => line.state === "accepted").length;
  return (
    <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4" data-mode={head.mode}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">On-sale refresh · {weekLabel(head.cycleMonday)}</p>
          <p className="text-xs text-muted-foreground">
            Data to {shortDay(head.windowEnd)}
            <Wide wide={nextLine(head, true)} narrow={nextLine(head, false)} />
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs">{shadow ? "Shadow" : "Live"}</span>
      </div>

      {head.blockers.length ? (
        <div className="mb-3 rounded border border-dashed border-border p-3">
          <p className="text-xs font-medium">Before it can move money</p>
          <ul className="mt-1 space-y-1">
            {head.blockers.map((blocker) => (
              <li key={blocker.kind} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-baseline sm:justify-between">
                <span>
                  <Wide wide={blocker.text} narrow={blocker.text.replace("This event has no marketing budget, so nothing", "No marketing budget: nothing")} />
                </span>
                <Link href={`/events/${eventId}/edit`} className="shrink-0 underline underline-offset-2">
                  {blocker.action}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-3">
        <p className="text-xs font-medium">Objective</p>
        <p className="text-xs">{head.why.objective}</p>
        <p className="text-xs text-muted-foreground">
          <Wide wide={head.why.purchase} narrow={head.why.purchaseNarrow || head.why.purchase} />
          <span className="hidden sm:inline"> {head.why.moves}</span>
        </p>
        {head.why.ticketing ? <p className="text-xs text-muted-foreground">{head.why.ticketing}</p> : null}
      </div>

      {proposals.map((proposal) => {
        const creatives = proposal.lines.filter((line) => CREATIVE_KINDS.has(line.kind));
        const audiences = proposal.lines.filter((line) => !CREATIVE_KINDS.has(line.kind));
        return (
          <div key={proposal.id} className="mb-3 border-t border-border pt-3">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              <p className="text-sm font-medium">{proposal.campaignKey}</p>
              {proposal.campaignSummary ? (
                <p className="text-xs text-muted-foreground">
                  <Wide wide={proposal.campaignSummary} narrow={proposal.campaignSummary.split(" · ").slice(1).join(" · ")} />
                </p>
              ) : null}
            </div>
            {proposal.notEnoughData ? <p className="mt-1 text-xs text-destructive">{proposal.notEnoughData}</p> : null}

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Creatives</p>
            {creatives.length ? (
              <ul className="mt-1 space-y-2">
                {creatives.map((line) => (
                  <LineRow key={line.id} line={line} shadow={shadow} />
                ))}
              </ul>
            ) : null}
            {creatives.some((line) => line.kind === "add_creative") && proposal.notes.adds ? <p className="mt-1 text-xs text-muted-foreground">{proposal.notes.adds}</p> : null}
            <div className="mt-2">
              <Watch label="Watch" items={proposal.watch.creatives} note={proposal.notes.pauses} />
            </div>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Audiences</p>
            {audiences.length ? (
              <ul className="mt-1 space-y-2">
                {audiences.map((line) => (
                  <LineRow key={line.id} line={line} shadow={shadow} />
                ))}
              </ul>
            ) : null}
            <div className="mt-2">
              <Watch label="Watch" items={proposal.watch.audiences} note={proposal.notes.drops} />
            </div>
          </div>
        );
      })}

      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {shadow ? <Wide wide="Shadow: nothing here can be applied yet. Each line is checked against next week's data." narrow="Shadow: nothing applies yet." /> : "Outcomes are checked after the next full week."}
        </p>
        <Button type="button" size="sm" disabled={shadow || accepted === 0}>
          Apply accepted ({accepted})
        </Button>
      </div>
    </section>
  );
}

/** The live panel: fetches the event's proposals through the session route. */
export function OnSaleRefreshPanel({ eventId }: { eventId: string }) {
  const [proposals, setProposals] = useState<PanelProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/onsale-refresh`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { proposals: PanelProposal[] };
        if (!cancelled) setProposals(body.proposals ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  if (error) {
    return (
      <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4 text-xs text-destructive">
        On-sale refresh: {error}
      </section>
    );
  }
  if (!proposals) {
    return (
      <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
        On-sale refresh…
      </section>
    );
  }
  return <OnSaleRefreshPanelView eventId={eventId} proposals={proposals} />;
}

export { dayMonth as refreshDayMonth };
