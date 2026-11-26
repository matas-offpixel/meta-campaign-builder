"use client";

/**
 * One row of Claude's Meta changes on Today (FC1, MB1, MB2), drawn from
 * lib/mcp/today/log.ts's MetaLogRow. Every word comes from the row.
 *
 * The card is TD/FC1's: a 4 px left edge for its state (olive done, brick
 * failed, ochre waiting), a refused or skipped row muted at 70 %. Undo and
 * Cancel are Matas's own actions: Cancel runs at once (nothing has run), a
 * delete confirms once. 393: actions sit on their own line; long names wrap,
 * but an event code, "What Claude asked" and a date with its time stay whole
 * (design, 27 Nov; lib/mcp/today/keep-whole.ts).
 */

import { useState, useTransition } from "react";

import { keepWholeToday as k } from "@/lib/mcp/today/keep-whole";
import type { MetaLogRow } from "@/lib/mcp/today/log";

const LOG_ROW = "space-y-1 rounded-lg border border-border-strong border-l-4 bg-card px-3 py-2.5";
const EDGE: Record<MetaLogRow["edge"], string> = {
  done: "border-l-success",
  failed: "border-l-destructive",
  waiting: "border-l-warning",
  muted: "border-l-border-strong opacity-70",
};
const TONE: Record<NonNullable<MetaLogRow["outcome"]>["tone"], string> = {
  done: "text-success",
  failed: "text-destructive",
  refused: "text-destructive",
  muted: "text-muted-foreground",
};
const BUTTON = "rounded-md border border-border-strong px-2 py-1 text-xs disabled:opacity-50";

export function ClaudeMetaRow({
  row,
  openAsked = false,
  confirmOpen = false,
  onUndo,
  onCancel,
}: {
  row: MetaLogRow;
  /** Frames: What Claude asked opened. */
  openAsked?: boolean;
  /** Frames: the delete's confirm opened. */
  confirmOpen?: boolean;
  onUndo?: (key: string, confirmed: boolean) => Promise<unknown>;
  onCancel?: (id: string) => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(confirmOpen);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => void (await fn()));
  return (
    <li className={`${LOG_ROW} ${EDGE[row.edge]}`} data-row={row.key}>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{k(row.title)}</p>
      <p className="text-sm [overflow-wrap:anywhere]">{k(row.change)}</p>
      {row.approved ? (
        <details open={openAsked} className="text-xs">
          <summary className="cursor-pointer list-none text-muted-foreground">
            {k(row.approved)} · <span className="whitespace-nowrap underline underline-offset-2">{row.asked}</span>
          </summary>
          <div className="mt-1 space-y-1 rounded-md bg-muted p-2 [overflow-wrap:anywhere]">
            {row.askedQ ? <p>{k(row.askedQ)}</p> : null}
            {row.askedA ? <p>{k(row.askedA)}</p> : null}
          </div>
        </details>
      ) : null}
      {row.ran ? <p className="text-xs text-muted-foreground">{k(row.ran)}</p> : null}
      {row.scheduled ? <p className="text-xs font-medium text-warning-foreground">{k(row.scheduled)}</p> : null}
      {row.cancel ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" className={BUTTON} disabled={pending || !onCancel} onClick={() => onCancel && run(() => onCancel(row.key.replace(/^scheduled:/, "")))}>
            {row.cancel.label}
          </button>
          <span className="text-muted-foreground">{row.cancel.note}</span>
        </div>
      ) : null}
      {row.cancelled ? <p className="text-xs text-muted-foreground">{k(row.cancelled)}</p> : null}
      {row.outcome ? <p className={`text-xs ${TONE[row.outcome.tone]} [overflow-wrap:anywhere]`}>{k(row.outcome.text)}</p> : null}
      {row.note ? <p className="text-xs text-muted-foreground">{k(row.note)}</p> : null}
      {row.undo && !confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className={BUTTON}
            disabled={pending || !onUndo}
            onClick={() => {
              if (row.undo?.confirm) setConfirming(true);
              else if (onUndo) run(() => onUndo(row.key, false));
            }}
          >
            {row.undo.label}
          </button>
          <span className="text-muted-foreground">{row.undo.line}</span>
        </div>
      ) : null}
      {row.undo?.confirm && confirming ? (
        <div className="space-y-2 rounded-md border border-border-strong p-2 text-xs">
          <p>{row.undo.confirm.question}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={pending} onClick={() => setConfirming(false)}>
              {row.undo.confirm.cancel}
            </button>
            <button type="button" className={`${BUTTON} border-destructive text-destructive`} disabled={pending || !onUndo} onClick={() => onUndo && run(() => onUndo(row.key, true))}>
              {row.undo.confirm.button}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
