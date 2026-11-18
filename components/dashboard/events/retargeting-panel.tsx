"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { REJECT_REASONS, appliesNow, panelText, rejectReasonsFor, stateText, type RejectReason } from "@/lib/onsale-refresh/line-states";
import type { PanelApply, PanelLine } from "@/lib/onsale-refresh/read";
import type { BudgetNote } from "@/lib/retargeting/moves";
import type { MissingLine, RetargetingView, RunningView, ShareOption, TierRow } from "@/lib/retargeting/plan";
import { BUDGET_KIND_LABEL, budgetHeader, endsLine, LAST_7_DAYS, NO_FIGURE, NO_PURCHASE_YET, pence, POOL_BEFORE_CREATE, POOL_BEFORE_CREATE_NARROW, runningLine, spentText, tierBudget } from "@/lib/retargeting/words";

/**
 * The Retargeting panel (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT3, RT4, RT5, RT8, RT9, RT10; frames RA, RB and RD). One per show, under the
 * on-sale refresh panel: headed "{code} · Retargeting", the Create line
 * with its 10 · 15 · 20 % choice (or the sentence that replaces it), and
 * one row per tier, hottest first. At 1280 the tiers are a table; at 393
 * (RT10) each tier is a card. Once it runs (RT3, RT5) the rows carry the
 * daily read's figures and a total row, and under them the read's Move or
 * Cut (Accept / Reject), its holds and RT6's next step. In Shadow the line
 * shows and Accept is disabled, as on the refresh panel. The words are the
 * record's.
 */

export type RetargetingActions = {
  onDecide?: (lineId: string, decision: "accept" | "reject", reason?: RejectReason, note?: string, choice?: { share?: number }) => void;
  onApply?: (opts: { retry: boolean; lineIds?: string[] }) => void;
  busy?: boolean;
  error?: string | null;
};

const k = panelText;

/** RT8's actions open the client page's customer-audience wizard with the role and this show chosen. */
export function wizardHref(clientId: string | null, eventId: string | null, role: "signups" | "buyers"): string {
  if (!clientId) return "#";
  const query = new URLSearchParams({ role, ...(eventId ? { event: eventId } : {}) });
  return `/clients/${clientId}/customer-audience?${query.toString()}`;
}

function Missing({ line, clientId, eventId, narrow = false }: { line: MissingLine; clientId: string | null; eventId: string | null; narrow?: boolean }) {
  return (
    <p className={`mt-0.5 text-xs ${line.muted ? "text-muted-foreground" : "text-destructive"}`} data-missing data-tone={line.muted ? "muted" : "brick"}>
      {k(narrow ? line.narrow : line.text)}
      {line.actions.map((action, index) => (
        <span key={action.label}>
          {index === 0 ? " " : " · "}
          <Link href={wizardHref(clientId, eventId, action.role)} className="underline underline-offset-2">
            {action.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

const figure = (value: string | number | null, format?: (v: number) => string) => (value == null ? NO_FIGURE : typeof value === "number" ? (format ? format(value) : String(value)) : value);

/** RT3: 7-day cost per attributed purchase; spend with no purchase reads "No purchase yet". */
const costText = (row: TierRow) => (row.cost != null ? pence(row.cost) : row.spendMinor ? NO_PURCHASE_YET : NO_FIGURE);

function TierTable({ rows, budgets, clientId, eventId, created, total }: { rows: TierRow[]; budgets: (row: TierRow) => number; clientId: string | null; eventId: string | null; created: boolean; total?: RunningView["total"] }) {
  return (
    <table className="mt-3 hidden w-full table-fixed border-collapse text-xs sm:table" data-tiers>
      <colgroup>
        <col className="w-[9%]" />
        <col className="w-[31%]" />
        <col className="w-[11%]" />
        <col className="w-[8%]" />
        <col className="w-[13%]" />
        <col className="w-[10%]" />
        <col className="w-[10%]" />
        <col className="w-[8%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="py-1.5 pr-2 font-medium">Tier</th>
          <th className="py-1.5 pr-2 font-medium">Audiences</th>
          <th className="py-1.5 pr-2 font-medium">Pool</th>
          <th className="py-1.5 pr-2 font-medium">Frequency</th>
          <th className="py-1.5 pr-2 font-medium">Leaves out</th>
          <th className="py-1.5 pr-2 font-medium">Budget</th>
          <th className="py-1.5 pr-2 font-medium">Cost per attributed purchase</th>
          <th className="py-1.5 font-medium">Purchases</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.tier} className="border-b border-border/60 align-top" data-tier={row.tier}>
            <td className="py-2 pr-2 font-medium">{row.label}</td>
            <td className="py-2 pr-2">
              {row.audiences.map((line) => (
                <p key={line}>{k(line)}</p>
              ))}
              {row.missing.map((line) => (
                <Missing key={line.text} line={line} clientId={clientId} eventId={eventId} />
              ))}
            </td>
            <td className="py-2 pr-2 tabular-nums" data-pool>{created ? figure(row.pool) : POOL_BEFORE_CREATE}</td>
            <td className={`py-2 pr-2 tabular-nums ${row.frequency != null && row.frequency >= 4 ? "text-destructive" : ""}`}>{figure(row.frequency, (v) => v.toFixed(1))}</td>
            <td className="py-2 pr-2">{row.leavesOut || NO_FIGURE}</td>
            <td className="py-2 pr-2 tabular-nums">{k(tierBudget(budgets(row)))}</td>
            <td className="py-2 pr-2 tabular-nums">{k(costText(row))}</td>
            <td className="py-2 tabular-nums">{figure(row.purchases)}</td>
          </tr>
        ))}
        {total ? (
          <tr className="align-top text-muted-foreground" data-total>
            <td className="py-2 pr-2">{LAST_7_DAYS}</td>
            <td className="py-2 pr-2 tabular-nums">{k(spentText(total.spentMinor))}</td>
            <td />
            <td />
            <td />
            <td className="py-2 pr-2 tabular-nums">{k(tierBudget(total.budgetMinor))}</td>
            <td className="py-2 pr-2 tabular-nums">{total.cost == null ? (total.spentMinor ? NO_PURCHASE_YET : NO_FIGURE) : k(pence(total.cost))}</td>
            <td className="py-2 tabular-nums">{total.purchases}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function TierCards({ rows, budgets, clientId, eventId, created }: { rows: TierRow[]; budgets: (row: TierRow) => number; clientId: string | null; eventId: string | null; created: boolean }) {
  return (
    <ul className="mt-3 space-y-2 sm:hidden" data-tier-cards>
      {rows.map((row) => {
        const running = row.cost != null || row.frequency != null;
        const pool = created ? `Pool ${row.pool == null ? NO_FIGURE : row.pool.replace(/^Below/, "below")}` : POOL_BEFORE_CREATE_NARROW;
        return (
          <li key={row.tier} className="rounded border border-border/70 p-3 text-xs" data-tier={row.tier}>
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{row.label}</span>
              <span className="tabular-nums">{k(tierBudget(budgets(row)))}</span>
            </p>
            {running ? (
              <>
                <p className="mt-0.5">{row.cost == null ? k(costText(row)) : k(`${pence(row.cost)} per attributed purchase · ${row.purchases ?? 0}`)}</p>
                <p className={`mt-0.5 ${row.frequency != null && row.frequency >= 4 ? "text-destructive" : ""}`}>{k(`${pool} · frequency ${row.frequency == null ? NO_FIGURE : row.frequency.toFixed(1)}`)}</p>
                {row.leavesOut ? <p className="mt-0.5">Leaves out {row.leavesOut.replace(/^Buyers$/, "buyers")}</p> : null}
              </>
            ) : (
              <p className="mt-0.5 text-muted-foreground">{k(row.leavesOut ? `${pool} · leaves out ${row.leavesOut}` : pool)}</p>
            )}
            {row.audiencesNarrow ? <p className="mt-0.5 text-muted-foreground">{k(row.audiencesNarrow)}</p> : null}
            {row.missing.map((line) => (
              <Missing key={line.text} line={line} clientId={clientId} eventId={eventId} narrow />
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** RT5: a budget line's kind, from its write (Move or Cut). */
function budgetLabel(line: PanelLine): string {
  return line.writeKind === "retargeting_cut" ? BUDGET_KIND_LABEL.cut : BUDGET_KIND_LABEL.move;
}

/**
 * RT5 / RT10: one Move, Cut or Hold, stacked as on the refresh panel — the
 * kind above the target, then the evidence and the write. A Move or Cut has
 * Accept and Reject (to the right at 1280, under the evidence on a phone);
 * a Hold has nothing to accept.
 */
function BudgetCard({ label, title, detail, narrow, writeText, line, shadow, apply, actions, titleWideOnly = false }: { label: string; title: string; detail: string; narrow: string; writeText: string | null; line?: PanelLine; shadow: boolean; apply?: PanelApply; actions: RetargetingActions; /** A Hold's phone line already names the tier (RT5). */ titleWideOnly?: boolean }) {
  const [picking, setPicking] = useState(false);
  const state = line?.state ?? null;
  const decidable = Boolean(apply && apply.mode === "live" && line && (state === "to_review" || state === "accepted" || state === "rejected"));
  const busy = Boolean(actions.busy);
  const shadowTitle = shadow ? "Shadow: nothing here can be applied yet" : undefined;
  const blocked = line?.blockedReason ?? null;
  return (
    <div className="mt-2 rounded border border-border/70 p-3" data-budget-line={label.toLowerCase()} data-line-state={state ?? undefined}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
            <span className={`text-sm font-medium ${titleWideOnly ? "hidden sm:inline" : ""}`}>{k(title)}</span>
          </p>
          <p className="mt-0.5 hidden text-xs sm:block">{k(detail)}</p>
          <p className="mt-0.5 text-xs sm:hidden">{k(narrow)}</p>
          {writeText ? <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{k(writeText)}</p> : null}
          {blocked ? <p className="mt-0.5 text-xs text-muted-foreground">{k(blocked)}</p> : null}
          {line && state !== "to_review" ? (
            <p className={`mt-0.5 text-xs ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`} data-line-state={state ?? undefined}>
              {k(stateText(state!, line.reason ?? null))}
            </p>
          ) : null}
        </div>
        {line && state !== "applied" && state !== "applying" && state !== "expired" ? (
          <div className="flex shrink-0 gap-2" role="group" aria-label="Accept or reject">
            <Button type="button" size="sm" variant={state === "accepted" ? "primary" : "outline"} aria-pressed={state === "accepted"} disabled={!decidable || busy || (state !== "accepted" && Boolean(blocked))} title={shadowTitle} onClick={() => actions.onDecide?.(line.id, "accept")}>
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant={state === "rejected" ? "secondary" : "ghost"}
              aria-pressed={state === "rejected"}
              disabled={!decidable || busy}
              title={shadowTitle}
              onClick={() => {
                if (state === "rejected") actions.onDecide?.(line.id, "reject");
                else setPicking(!picking);
              }}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </div>
      {picking && line ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-reasons>
          {rejectReasonsFor(line.kind).map((reason) => (
            <Button
              key={reason}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPicking(false);
                actions.onDecide?.(line.id, "reject", reason);
              }}
            >
              {REJECT_REASONS[reason]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HoldCard({ hold, shadow, actions }: { hold: BudgetNote; shadow: boolean; actions: RetargetingActions }) {
  return <BudgetCard label={hold.label} title={hold.title} detail={hold.detail} narrow={hold.narrow} writeText={null} shadow={shadow} actions={actions} titleWideOnly />;
}

function ShareChoice({ options, picked, onPick, disabled }: { options: ShareOption[]; picked: number; onPick: (share: number) => void; disabled: boolean }) {
  return (
    <span className="inline-flex gap-0.5 align-baseline" role="radiogroup" aria-label="Share of current daily spend">
      {options.map((option) => (
        <button
          key={option.share}
          type="button"
          role="radio"
          aria-checked={option.share === picked}
          disabled={disabled}
          onClick={() => onPick(option.share)}
          className={`rounded border px-1 font-mono text-[11px] ${option.share === picked ? "border-foreground bg-foreground text-background" : "border-border text-foreground"} disabled:cursor-default`}
        >
          {option.share} %
        </button>
      ))}
    </span>
  );
}

function CreateCard({ view, line, shadow, apply, actions, share, setShare }: { view: RetargetingView; line: PanelLine | null; shadow: boolean; apply?: PanelApply; actions: RetargetingActions; share: number; setShare: (share: number) => void }) {
  const [picking, setPicking] = useState(false);
  const create = view.create!;
  const option = create.options.find((row) => row.share === share) ?? create.options[0]!;
  const state = line?.state ?? "to_review";
  const decidable = Boolean(apply && apply.mode === "live" && line && (state === "to_review" || state === "accepted" || state === "rejected"));
  const blocked = line?.blockedReason ?? option.blocked;
  const busy = Boolean(actions.busy);
  const shadowTitle = shadow ? "Shadow: nothing here can be applied yet" : undefined;
  const lineText = option.line.replace(`${budgetHeader(option.totalMinor, share)} · `, "");
  return (
    <div className="mt-2 rounded border border-border/70 p-3" data-create data-line-state={state}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Create</span>
            <span className="text-sm font-medium">{create.title}</span>
          </p>
          <p className="mt-0.5 text-xs">
            {k(`${pence(option.totalMinor, { minor: true })} a day · `)}
            <ShareChoice options={create.options} picked={share} onPick={setShare} disabled={shadow || state === "applied" || state === "applying"} />
            <span className="hidden sm:inline">{k(` of current daily spend · ${lineText}`)}</span>
          </p>
          <p className="mt-0.5 text-xs sm:hidden">{k(option.split)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{k(option.hold)}</p>
          {create.legacy.map((text) => (
            <p key={text} className="mt-0.5 text-xs text-muted-foreground" data-legacy>
              {k(text)}
            </p>
          ))}
          <p className="mt-0.5 hidden text-xs sm:block">{create.writeText}</p>
          {blocked ? <p className="mt-0.5 text-xs text-muted-foreground">{k(blocked)}</p> : null}
          {state !== "to_review" ? (
            <p className={`mt-0.5 text-xs ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`} data-line-state={state}>
              {k(stateText(state, line?.reason ?? null))}
            </p>
          ) : null}
        </div>
        {state === "applied" || state === "applying" || state === "expired" ? null : (
          <div className="flex shrink-0 gap-2" role="group" aria-label="Accept or reject">
            <Button type="button" size="sm" variant={state === "accepted" ? "primary" : "outline"} aria-pressed={state === "accepted"} disabled={!decidable || busy || (state !== "accepted" && Boolean(blocked))} title={shadowTitle} onClick={() => line && actions.onDecide?.(line.id, "accept", undefined, undefined, { share })}>
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant={state === "rejected" ? "secondary" : "ghost"}
              aria-pressed={state === "rejected"}
              disabled={!decidable || busy}
              title={shadowTitle}
              onClick={() => {
                if (!line) return;
                if (state === "rejected") actions.onDecide?.(line.id, "reject");
                else setPicking(!picking);
              }}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
      {picking && line ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-reasons>
          {rejectReasonsFor(line.kind).map((reason) => (
            <Button
              key={reason}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPicking(false);
                actions.onDecide?.(line.id, "reject", reason);
              }}
            >
              {REJECT_REASONS[reason]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type RetargetingPanelViewProps = {
  view: RetargetingView;
  /** The Create line, when one is stored. */
  line?: PanelLine | null;
  /** RT5: the read's Move or Cut, when one is stored. */
  budgetLines?: PanelLine[];
  clientId?: string | null;
  /** The show, for RT8's wizard links. */
  eventId?: string | null;
  /** The gates (live controls). Absent = read-only (the frames). */
  apply?: PanelApply;
  mode?: "shadow" | "live";
  actions?: RetargetingActions;
};

export function RetargetingPanelView({ view, line = null, budgetLines = [], clientId = null, eventId = null, apply, mode, actions = {} }: RetargetingPanelViewProps) {
  // RT3: before Apply the tiers' audiences don't exist, so the pool is "Known after create".
  const created = view.state === "running";
  const create = view.create;
  const [share, setShare] = useState<number>(line?.share ?? create?.defaultShare ?? 10);
  const shadow = apply ? apply.mode === "shadow" : (mode ?? "shadow") === "shadow";
  const option = create?.options.find((row) => row.share === share) ?? null;
  const budgets = (row: TierRow) => (option ? option.tiers[row.tier] : row.budgetMinor);
  const stored = [...(line ? [line] : []), ...budgetLines];
  const acceptedLines = apply ? stored.filter((row) => appliesNow({ kind: row.kind, state: row.state, writeKind: row.writeKind ?? null }, apply)) : [];
  const failedLines = apply ? stored.filter((row) => row.state === "failed" && appliesNow({ kind: row.kind, state: "accepted", writeKind: row.writeKind ?? null }, apply)) : [];
  const accepted = acceptedLines.length;
  const retry = failedLines.length;
  const running = view.running;
  return (
    <section id="retargeting" className="rounded-md border border-border bg-card p-4" data-retargeting={view.state} data-mode={shadow ? "shadow" : "live"}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{view.title}</p>
          {view.running ? (
            <>
              <p className="text-xs text-muted-foreground">{k(budgetHeader(view.running.totalMinor, view.running.share))}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{k(runningLine(view.running.since, view.running.showDay))}</p>
              <p className="text-xs text-muted-foreground sm:hidden">{k(`${endsLine(view.running.showDay)}${view.signal ? ` · ${view.signal.narrow}` : ""}`)}</p>
            </>
          ) : null}
          {view.signal && view.running ? <p className="hidden text-xs text-muted-foreground sm:block">{k(view.signal.wide)}</p> : null}
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs">{shadow ? "Shadow" : "Live"}</span>
      </div>

      {view.notProposed ? (
        <p className="mt-2 text-xs text-muted-foreground" data-not-proposed={view.state}>
          {k(view.notProposed)}
        </p>
      ) : null}

      {create ? <CreateCard view={view} line={line} shadow={shadow} apply={apply} actions={actions} share={share} setShare={setShare} /> : null}

      {view.tiers.length ? (
        <>
          <TierTable rows={view.tiers} budgets={budgets} clientId={clientId} eventId={eventId} created={created} total={running?.total ?? null} />
          <TierCards rows={view.tiers} budgets={budgets} clientId={clientId} eventId={eventId} created={created} />
          {view.notes.map((note) => (
            <Missing key={note.text} line={note} clientId={clientId} eventId={eventId} />
          ))}
        </>
      ) : null}

      {running?.off ? (
        <p className="mt-2 text-xs text-destructive" data-retargeting-off>
          {k(running.off)}
        </p>
      ) : null}
      {running?.holds?.map((hold) => <HoldCard key={hold.tier} hold={hold} shadow={shadow} actions={actions} />)}
      {budgetLines.map((row) => (
        <BudgetCard key={row.id} label={budgetLabel(row)} title={row.title} detail={row.detail} narrow={row.narrow?.detail ?? row.detail} writeText={row.writeText} line={row} shadow={shadow} apply={apply} actions={actions} />
      ))}
      {running?.note ? (
        <p className="mt-2 text-xs text-muted-foreground" data-no-move>
          {k(running.note)}
        </p>
      ) : null}
      {running?.nextStep ? (
        <p className="mt-3 hidden border-t border-border pt-2 text-xs text-muted-foreground sm:block" data-next-step>
          {k(running.nextStep)}
        </p>
      ) : null}

      {apply && stored.length ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-end">
          {actions.error ? <p className="text-xs text-destructive">{actions.error}</p> : null}
          <div className="flex shrink-0 gap-2">
            {retry ? (
              <Button type="button" size="sm" variant="outline" disabled={shadow || Boolean(actions.busy)} onClick={() => actions.onApply?.({ retry: true, lineIds: failedLines.map((row) => row.id) })}>
                {`Retry failed (${retry})`}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={shadow || accepted === 0 || Boolean(actions.busy)} onClick={() => actions.onApply?.({ retry: false, lineIds: acceptedLines.map((row) => row.id) })}>
              {actions.busy ? "Applying…" : `Apply accepted (${accepted})`}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
