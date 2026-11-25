"use client";

import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { treeDate } from "@/lib/campaign-tree/tree";
import { frameWord, FRAME_WORDS } from "@/lib/campaign-tree/words";
import type { ReplicateChange, ReplicatePageQuestion } from "@/lib/replicate/replicate";
import { REPLICATE_WORDS, fillWords } from "@/lib/replicate/words";

/**
 * Replicate to event (R1; record 2026-11-24-campaign-creator-replicate, RC1 ·
 * RC2, frames RC-A and RC-B). Presentational: the dialog
 * (replicate-dialog.tsx) and the frames mount these with their data. Every
 * string comes from lib/replicate/words.ts, lib/campaign-tree/words.ts or the
 * server's rendered change rows.
 */

export interface ReplicatePickEvent {
  id: string;
  name: string | null;
  code: string | null;
  venue: string | null;
  eventDate: string | null;
  isSource: boolean;
}

function eventLine(e: ReplicatePickEvent): string {
  const parts = [e.venue, e.eventDate ? treeDate(e.eventDate) : null].filter(Boolean) as string[];
  if (e.isSource) parts.push(REPLICATE_WORDS["replicate.pick.source"]);
  return parts.join(" · ");
}

/** RC11: search matches the code or the name. */
export function matchesQuery(e: ReplicatePickEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [e.name, e.code].some((v) => (v ?? "").toLowerCase().includes(q));
}

/** RC11's empty and no-match lines, or null when there's a list to show. */
export function pickEmptyLine(input: { clientName: string | null; total: number; shown: number; query: string }): string | null {
  if (input.total === 0) return fillWords(REPLICATE_WORDS["replicate.pick.empty"], { client: input.clientName ?? "" });
  if (input.shown === 0) return fillWords(REPLICATE_WORDS["replicate.pick.no_match"], { query: input.query.trim() });
  return null;
}

export function ReplicatePickPanel({
  clientName,
  events,
  query,
  onQuery,
  picked,
  onPick,
  onCancel,
  onNext,
  busy = false,
  error = null,
  loaded = true,
}: {
  clientName: string | null;
  events: ReplicatePickEvent[];
  /** False while the list loads: no empty line yet. */
  loaded?: boolean;
  query: string;
  onQuery: (q: string) => void;
  picked: string | null;
  onPick: (id: string) => void;
  onCancel: () => void;
  onNext: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const shown = events.filter((e) => matchesQuery(e, query));
  const empty = loaded ? pickEmptyLine({ clientName, total: events.length, shown: shown.length, query }) : null;
  const pickedShown = shown.some((e) => e.id === picked);
  return (
    <div className="space-y-3" data-replicate-step="pick">
      <p className="text-sm font-medium text-foreground">{REPLICATE_WORDS["replicate.pick.question"]}</p>
      <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={REPLICATE_WORDS["replicate.pick.search"]}
          aria-label={REPLICATE_WORDS["replicate.pick.search"]}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      {clientName ? (
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {frameWord("upcoming", { client: clientName })}
        </p>
      ) : null}
      {empty ? <p className="text-[13px] text-muted-foreground" data-pick-empty="">{empty}</p> : null}
      <ul className={`divide-y divide-border rounded-md border border-border ${shown.length === 0 ? "hidden" : ""}`} role="listbox" aria-label={REPLICATE_WORDS["replicate.pick.question"]}>
        {shown.map((e) => {
          const on = picked === e.id;
          return (
            <li key={e.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => onPick(e.id)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3 ${
                  on ? "bg-primary-light" : "hover:bg-muted"
                }`}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="break-words text-sm font-semibold text-foreground">{e.name ?? e.code}</span>
                  {e.code ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{e.code}</span> : null}
                </span>
                <span className={`text-xs ${e.isSource ? "text-muted-foreground italic" : "text-muted-foreground"}`}>{eventLine(e)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {FRAME_WORDS.cancel}
        </Button>
        <Button size="sm" onClick={onNext} disabled={!picked || !pickedShown || busy}>
          {FRAME_WORDS.next}
        </Button>
      </div>
    </div>
  );
}

export interface ReplicateSummary {
  title: string;
  changesTitle: string;
  changes: ReplicateChange[];
  keptTitle: string;
  kept: string;
  pages: ReplicatePageQuestion[];
}

/** Each page question answered: Create draft turns on (RC2). */
export function pagesAnswered(pages: ReplicatePageQuestion[], answers: Record<string, "keep" | "change">): boolean {
  return pages.every((p) => answers[p.pageId] === "keep" || answers[p.pageId] === "change");
}

export function ReplicateSummaryPanel({
  summary,
  answers,
  onAnswer,
  onBack,
  onCreate,
  busy = false,
  error = null,
}: {
  summary: ReplicateSummary;
  answers: Record<string, "keep" | "change">;
  onAnswer: (pageId: string, answer: "keep" | "change") => void;
  onBack: () => void;
  onCreate: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const ready = pagesAnswered(summary.pages, answers);
  return (
    <div className="space-y-4" data-replicate-step="summary">
      <section className="space-y-1.5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{summary.changesTitle}</p>
        <dl className="divide-y divide-border rounded-md border border-border">
          {summary.changes.map((c) => (
            <div
              key={c.field}
              data-change={c.field}
              data-tone={c.tone}
              className={`grid grid-cols-[5.5rem_1fr] gap-3 px-3 py-2 text-[13px] ${c.tone === "not_set" ? "bg-warning/10" : ""}`}
            >
              <dt className={`font-medium ${c.tone === "not_set" ? "text-warning-foreground" : "text-muted-foreground"}`}>{c.label}</dt>
              <dd className={`min-w-0 break-words ${c.tone === "not_set" ? "font-medium text-warning-foreground" : "text-foreground"}`}>
                {c.value}
                {c.was ? <span className="text-muted-foreground"> {c.was}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-1">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{summary.keptTitle}</p>
        <p className="text-[13px] text-foreground">{summary.kept}</p>
      </section>
      {summary.pages.map((p) => (
        <section key={p.pageId} className="space-y-2 rounded-md border border-border-strong bg-card px-3 py-2.5" data-page-question={p.pageId}>
          <p className="text-[13px] font-semibold text-foreground">{p.question}</p>
          <div className="flex flex-wrap gap-2">
            {(["keep", "change"] as const).map((answer) => {
              const on = answers[p.pageId] === answer;
              return (
                <button
                  key={answer}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onAnswer(p.pageId, answer)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                    on ? "border-foreground bg-foreground text-background" : "border-border-strong text-foreground hover:bg-muted"
                  }`}
                >
                  {answer === "keep" ? p.keep : p.change}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
        <p className="text-xs text-muted-foreground">{REPLICATE_WORDS["replicate.create.note"]}</p>
        <div className="flex justify-end gap-2 sm:ml-auto">
          <Button variant="ghost" size="sm" onClick={onBack}>
            {FRAME_WORDS.back}
          </Button>
          <Button size="sm" onClick={onCreate} disabled={!ready || busy}>
            {REPLICATE_WORDS["replicate.create"]}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The dialog's frame: title, ✕, body. The live dialog puts it in <Dialog>; the frames draw it in place. */
export function ReplicateShell({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background p-5 shadow-md sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="dialog-title" className="min-w-0 break-words font-heading text-lg tracking-wide text-foreground">
          {title}
        </h2>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            ✕
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
