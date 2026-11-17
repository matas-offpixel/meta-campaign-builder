/**
 * "What we're testing" on the client's share link, under the creative section
 * (docs/design-record/2026-11-16-creative-testing.html CT11, TT6, TF3; frame
 * TF-C). Figures only: each test's name and state, and its results and cost
 * per result. No spend share, spend, budgets, refresh lines, calling or notes.
 */

import { SHARE_TITLE, type ShareCard } from "@/lib/creative-tests/panel-view";

export function WhatWeAreTesting({ cards }: { cards: ShareCard[] }) {
  if (!cards.length) return null;
  return (
    <section className="mt-6 min-w-0" data-panel="what-we-are-testing">
      <h3 className="pb-2 text-sm font-medium">{SHARE_TITLE}</h3>
      <div className="space-y-4">
        {cards.map((card) => (
          <div key={card.id} className="rounded-lg border border-border bg-card px-4 py-3">
            <h4 className="text-sm font-medium">{card.name}</h4>
            <p className="pb-2 text-sm">{card.state}</p>
            {card.rows.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="py-1 pr-3 font-normal">{card.headers.variant}</th>
                    <th className="py-1 pr-3 text-right font-normal">{card.headers.results}</th>
                    <th className="py-1 text-right font-normal">{card.headers.cost}</th>
                  </tr>
                </thead>
                <tbody>
                  {card.rows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-1.5 pr-3">{row.label}</td>
                      {row.results == null ? (
                        <td colSpan={2} className="py-1.5 text-right text-muted-foreground">
                          {row.cost}
                        </td>
                      ) : (
                        <>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{row.results}</td>
                          <td className="py-1.5 text-right tabular-nums">{row.cost}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
