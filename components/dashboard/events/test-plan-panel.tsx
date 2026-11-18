"use client";

/**
 * The event page's Test plan panel (docs/design-record/2026-11-16-creative-testing.html
 * CT9, as TT6 and TF3 re-rule it; frames TF-A, TF-B, TT-D). Read-only here:
 * calling, Promote and Pause arrive with the refresh lines.
 *
 * 1280: one card per test. The open card shows its state, the budget line and
 * the table with spend share first (a bar with a line at 60 % and a faint one
 * at 10 %, the leader olive), then spend, results and cost per result, sorted
 * by share. Folded cards are one line.
 * 393: the state above rows of "{share} % of spend · {variant} · £{cost} per
 * {result} · {results}" (TF3), muted rows as TT-D words them.
 */

import { useEffect, useState } from "react";

import { PANEL_TITLE, type PanelCard, type PanelRow, type PanelView } from "@/lib/creative-tests/panel-view";

function ShareBar({ row }: { row: PanelRow }) {
  const width = row.share == null ? 0 : Math.max(0, Math.min(100, row.share * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2.5 w-28 shrink-0 rounded-sm bg-foreground/10" aria-hidden>
        <div className={`absolute inset-y-0 left-0 rounded-sm ${row.leader ? "bg-success" : "bg-foreground/45"}`} style={{ width: `${width}%` }} />
        <div className="absolute inset-y-[-3px] left-[60%] w-px bg-foreground" />
        <div className="absolute inset-y-[-3px] left-[10%] w-px bg-foreground/30" />
      </div>
      <span className="tabular-nums">{row.sharePct != null ? `${row.sharePct} %` : "—"}</span>
    </div>
  );
}

function Card({ card }: { card: PanelCard }) {
  if (!card.open) {
    return <p className="border-t border-border py-2 text-sm text-muted-foreground">{card.folded}</p>;
  }
  return (
    <div className="space-y-3 border-t border-border py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-sm font-medium">{card.name}</h4>
        <p className="text-sm max-sm:w-full">{card.state}</p>
      </div>
      {/* VP6 / VP7: a pair's span line and sign-off lines, at 1280 only. */}
      {card.spanLine ? <p className="text-xs text-muted-foreground max-sm:hidden">{card.spanLine}</p> : null}
      {card.approvalLines.map((line) => (
        <p key={line} className="text-xs text-muted-foreground max-sm:hidden">
          {line}
        </p>
      ))}
      {card.budgetLine ? (
        <>
          <p className="text-xs text-muted-foreground max-sm:hidden">{card.budgetLine}</p>
          <p className="text-xs text-muted-foreground sm:hidden">{card.budgetLineShort}</p>
        </>
      ) : null}
      <table className="w-full text-sm max-sm:hidden">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="py-1 pr-3 font-normal">Variant</th>
            <th className="py-1 pr-3 font-normal">Spend share</th>
            <th className="py-1 pr-3 text-right font-normal">Spend</th>
            <th className="py-1 pr-3 text-right font-normal">{card.headers.results}</th>
            <th className="py-1 font-normal">{card.headers.cost}</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-1.5 pr-3">{row.label}</td>
              <td className="py-1.5 pr-3">{row.muted ? <span className="text-muted-foreground">—</span> : <ShareBar row={row} />}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{row.spend}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{row.results}</td>
              <td className={`py-1.5 ${row.muted ? "text-destructive" : row.judged ? "tabular-nums" : "text-muted-foreground"}`}>{row.cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-1 text-sm sm:hidden">
        {card.rows.map((row) => (
          <li key={row.id} className={row.muted ? "text-destructive" : row.judged ? "" : "text-muted-foreground"}>
            {row.phone}
          </li>
        ))}
      </ul>
      {card.pause ? (
        <div className="rounded border border-border bg-background/40 px-3 py-2 text-sm">
          <p>{card.pause.title}</p>
          <p className="text-xs text-muted-foreground">{card.pause.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

export function TestPlanPanelView({ view }: { view: PanelView }) {
  if (!view.cards.length) return null;
  return (
    <section id="test-plan" className="rounded-lg border border-border bg-card px-4 py-3" data-panel="test-plan">
      <h3 className="pb-1 text-sm font-medium">{PANEL_TITLE}</h3>
      {view.cards.map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </section>
  );
}

/** The live panel: reads GET /api/events/{id}/creative-tests and draws nothing for an event with no plan. */
export function TestPlanPanel({ eventId }: { eventId: string }) {
  const [view, setView] = useState<PanelView | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/events/${eventId}/creative-tests`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { view?: PanelView } | null) => {
        if (live && json?.view) setView(json.view);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [eventId]);
  return view ? <TestPlanPanelView view={view} /> : null;
}
