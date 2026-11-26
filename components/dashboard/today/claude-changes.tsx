/**
 * FC1's section on Today, "Claude's changes": one log of everything Claude
 * did today, newest first. M4a's render packages (RY2) and the Meta changes
 * (FC1, MB1) share it and its count; scheduled budget changes still waiting
 * sit above the log, soonest first, with " · {n} scheduled" beside the count
 * (MB2).
 *
 * Presentational: Today (claude-render-log.tsx) and the frames draw it.
 */

import type { ReactNode } from "react";

import { TodayRefusedRow, TodayRenderRow } from "@/components/render-templates/render-package-view";
import type { refusedTodayRow, todayRow } from "@/lib/render-templates/report";
import type { MetaLogRow } from "@/lib/mcp/today/log";
import { ClaudeMetaRow } from "./claude-meta-row";

export type ClaudeChangeEntry =
  | { kind: "package"; at: string; row: ReturnType<typeof todayRow>; open?: boolean }
  | { kind: "refused"; at: string; row: ReturnType<typeof refusedTodayRow> }
  | { kind: "meta"; at: string; row: MetaLogRow; openAsked?: boolean; confirmOpen?: boolean };

export function ClaudeChanges({
  title,
  count,
  waiting,
  entries,
  onUndo,
  onCancel,
  lead,
}: {
  title: string;
  count: string;
  waiting: MetaLogRow[];
  entries: ClaudeChangeEntry[];
  onUndo?: (key: string, confirmed: boolean) => Promise<unknown>;
  onCancel?: (id: string) => Promise<unknown>;
  /** Frames only: a caption above a group. */
  lead?: ReactNode;
}) {
  const sorted = [...entries].sort((x, y) => y.at.localeCompare(x.at));
  return (
    <section className="space-y-2" id="claude-changes">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </header>
      {lead}
      {waiting.length ? (
        <ul className="space-y-2">
          {waiting.map((row) => (
            <ClaudeMetaRow key={row.key} row={row} onUndo={onUndo} onCancel={onCancel} />
          ))}
        </ul>
      ) : null}
      <ul className="space-y-2">
        {sorted.map((e) =>
          e.kind === "package" ? (
            <TodayRenderRow key={e.row.id} row={e.row} open={e.open} />
          ) : e.kind === "refused" ? (
            <TodayRefusedRow key={e.row.id} row={e.row} />
          ) : (
            <ClaudeMetaRow key={e.row.key} row={e.row} openAsked={e.openAsked} confirmOpen={e.confirmOpen} onUndo={onUndo} onCancel={onCancel} />
          ),
        )}
      </ul>
    </section>
  );
}
