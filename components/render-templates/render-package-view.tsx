"use client";

/**
 * M4a's Lab surfaces, presentational (RT1 picker, RT2 rows) and Today's log
 * rows (RY2). The live panel (render-package-panel.tsx), Today and the
 * frames (app/(dev)/frames/render-package) all draw these, from the views
 * in lib/render-templates. Every word comes from those views.
 *
 * 393: cards stack one per row; a need's state drops under its label; a
 * file name breaks only after "__"; row actions sit on their own line.
 * Colour never carries meaning alone: each state is its word.
 */

import type { RecipeCard } from "@/lib/render-templates/package-view";
import type { renderRowView, todayRow, refusedTodayRow } from "@/lib/render-templates/report";
import { M4_WORDS } from "@/lib/render-templates/words";

type RowView = ReturnType<typeof renderRowView>;
type TodayRowView = ReturnType<typeof todayRow>;
type RefusedRowView = ReturnType<typeof refusedTodayRow>;

const tone = {
  ready: "text-success",
  short: "text-warning-foreground",
  none: "text-warning-foreground",
  missing: "text-destructive",
} as const;

export function RecipeCardView({ card, busy, started, onRender }: { card: RecipeCard; busy?: boolean; started?: string | null; onRender?: () => void }) {
  const muted = !card.built;
  return (
    <section className={`rounded-lg border border-border p-4 ${muted ? "bg-muted/40 opacity-70" : "bg-card"}`}>
      {card.muted ? <p className="mb-2 text-xs text-muted-foreground">{card.muted}</p> : null}
      <h4 className="text-base font-semibold">{card.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{card.what}</p>
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">{M4_WORDS["m4.owner.label"]}</span> · {card.owner}
      </p>
      <h5 className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{M4_WORDS["m4.needs"]}</h5>
      <ul className="mt-1 divide-y divide-border">
        {card.needs.map((need) => (
          <li key={need.key} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span className="min-w-0">
              <span className="text-sm">{need.label}</span>
              {need.detail ? <span className="ml-2 text-xs text-muted-foreground">{need.detail}</span> : null}
            </span>
            <span className="shrink-0 text-sm">
              <span className={tone[need.state]}>{need.stateWord}</span>
              {need.pick && !muted ? (
                <>
                  {" · "}
                  <a className="underline underline-offset-2" href={need.pick}>
                    {M4_WORDS["m4.need.pick"]}
                  </a>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {card.button ? (
        <div className="mt-4">
          <button
            type="button"
            disabled={!card.ready || busy}
            onClick={onRender}
            className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            {card.button}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">{card.under}</p>
          {!card.ready ? <p className="mt-1 text-xs text-warning-foreground">{M4_WORDS["m4.render.blocked"]}</p> : null}
          {started ? <p className="mt-1 text-xs">{started}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function RenderPackagePicker({
  header,
  cards,
  busy,
  started,
  error,
  onRender,
}: {
  header: { title: string; forLine: string; rights: string };
  cards: RecipeCard[];
  busy?: boolean;
  started?: string | null;
  error?: string | null;
  onRender?: () => void;
}) {
  return (
    <div className="space-y-3" id="lab-render-package">
      <div>
        <h3 className="text-lg font-semibold">{header.title}</h3>
        <p className="text-sm">{header.forLine}</p>
        <p className="text-xs text-muted-foreground">{header.rights}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {cards.map((card) => (
          <RecipeCardView key={card.recipe} card={card} busy={busy} started={card.built ? started : null} onRender={card.built ? onRender : undefined} />
        ))}
      </div>
    </div>
  );
}

export function RenderRowsList({ rows, onRetry, onRerender, busyId }: { rows: RowView[]; onRetry?: (id: string) => void; onRerender?: (id: string) => void; busyId?: string | null }) {
  return (
    <div className="space-y-2" id="lab-renders">
      <h3 className="text-lg font-semibold">{M4_WORDS["m4.rows.title"]}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1 p-3">
            <p className="font-mono text-xs leading-relaxed">
              {row.nameParts.map((part, i) => (
                <span key={i} className="whitespace-nowrap">
                  {part}
                  <wbr />
                </span>
              ))}
            </p>
            {row.meta ? <p className="text-xs text-muted-foreground">{row.meta}</p> : null}
            <p className="text-xs">
              <span className={`mr-1 inline-block rounded-full border px-2 py-0.5 ${row.why ? "border-border-strong" : "border-success text-success"}`}>{row.badge}</span>
              {row.why ? <span className="text-muted-foreground">{row.why}</span> : null}
            </p>
            {row.checks ? <p className={`text-xs ${row.checks.tone === "olive" ? "text-success" : "text-destructive"}`}>{row.checks.text}</p> : null}
            {row.rendering ? <p className="text-xs text-muted-foreground">{row.rendering}</p> : null}
            {row.renderFailed ? <p className="text-xs text-destructive">{row.renderFailed}</p> : null}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
              {row.rerender ? (
                <button type="button" className="rounded-md border border-border-strong px-2 py-1" disabled={busyId === row.id} onClick={() => onRerender?.(row.id)}>
                  {row.rerender}
                </button>
              ) : null}
              {row.retry ? (
                <button type="button" className="rounded-md border border-border-strong px-2 py-1" disabled={busyId === row.id} onClick={() => onRetry?.(row.id)}>
                  {row.retry}
                </button>
              ) : null}
              {row.drive ? (
                <a className="underline underline-offset-2" href={row.drive.href} target="_blank" rel="noreferrer">
                  {row.drive.text}
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** RY2: a package in Today's log (FC1's row: no Approve or Reject, the no-Undo line). */
export function TodayRenderRow({ row, open = false }: { row: TodayRowView; open?: boolean }) {
  return (
    <li className="space-y-1 p-3">
      <p className="text-sm font-medium">{row.title}</p>
      <p className="text-sm">{row.change}</p>
      <details open={open} className="text-xs">
        <summary className="cursor-pointer list-none text-muted-foreground">
          {row.approved} · <span className="underline underline-offset-2">{row.asked}</span>
        </summary>
        <div className="mt-1 space-y-1 rounded-md bg-muted p-2">
          {row.askedQ ? <p>{row.askedQ}</p> : null}
          {row.askedA ? <p>{row.askedA}</p> : null}
        </div>
      </details>
      {row.rendering ? <p className="text-xs">{row.rendering}</p> : null}
      {row.done ? <p className="text-xs text-success">{row.done}</p> : null}
      {row.failed ? <p className="text-xs text-destructive">{row.failed}</p> : null}
      {row.openLab ? (
        <p className="text-xs">
          <a className="underline underline-offset-2" href={row.openLab.href}>
            {row.openLab.text}
          </a>
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{row.noUndo}</p>
    </li>
  );
}

export function TodayRefusedRow({ row }: { row: RefusedRowView }) {
  return (
    <li className="space-y-1 p-3 opacity-70">
      <p className="text-sm font-medium">{row.title}</p>
      <p className="text-sm">{row.change}</p>
      <p className="text-xs text-destructive">{row.refused}</p>
    </li>
  );
}

export type TodayLogEntry = { kind: "package"; row: TodayRowView; open?: boolean } | { kind: "refused"; row: RefusedRowView };

/** FC1's section, as far as M4a fills it: the render packages and their refusals, newest first. */
export function TodayClaudeLog({ title, count, entries }: { title: string; count: string; entries: TodayLogEntry[] }) {
  return (
    <section className="rounded-lg border border-border bg-card" id="claude-changes">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </header>
      <ul className="divide-y divide-border">
        {entries.map((e) => (e.kind === "package" ? <TodayRenderRow key={e.row.id} row={e.row} open={e.open} /> : <TodayRefusedRow key={e.row.id} row={e.row} />))}
      </ul>
    </section>
  );
}
