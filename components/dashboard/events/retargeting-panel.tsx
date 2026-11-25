"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { REJECT_REASONS, appliesNow, panelText, rejectReasonsFor, stateText, type RejectReason } from "@/lib/onsale-refresh/line-states";
import type { PanelApply, PanelLine } from "@/lib/onsale-refresh/read";
import { keepWhole } from "@/lib/retargeting/keep-whole";
import type { ArmView, MissingLine, RetargetingView, TestView, TierRow } from "@/lib/retargeting/plan";
import { armTierNarrow, budgetHeader, createHead, LAST_7_DAYS, POOLED_TITLE, spentText, endsLine, NO_FIGURE, pence, POOL_BEFORE_CREATE, POOL_BEFORE_CREATE_NARROW, runningLine, tierBudget } from "@/lib/retargeting/words";

/**
 * The Retargeting panel (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT3, RT4, RT8, RT10; -2.html RT11, RT13–RT16; frames RB and RD).
 * One per show, under the on-sale refresh panel: headed "{code} ·
 * Retargeting", the Create line at today's share (RT11; the 10 · 15 · 20 %
 * choice is withdrawn), or the sentence that replaces it, and
 * one row per tier, hottest first. At 1280 the tiers are a table; at 393
 * (RT10) each tier is a card. In Shadow the line shows and Accept is
 * disabled, as on the refresh panel. The words are the record's.
 */

export type RetargetingActions = {
  onDecide?: (lineId: string, decision: "accept" | "reject", reason?: RejectReason, note?: string, choice?: { share?: number }) => void;
  onApply?: (opts: { retry: boolean; lineIds?: string[] }) => void;
  busy?: boolean;
  error?: string | null;
};

/** Figures grouped, dates kept together, and each number kept with its unit (keep-whole.ts). */
const k = (text: string) => keepWhole(panelText(text));

/** RT8's actions open the client page's customer-audience wizard with the role and this show chosen. */
export function wizardHref(clientId: string | null, eventId: string | null, role: "signups" | "buyers"): string {
  if (!clientId) return "#";
  const query = new URLSearchParams({ role, ...(eventId ? { event: eventId } : {}) });
  return `/clients/${clientId}/customer-audience?${query.toString()}`;
}

function Missing({ line, clientId, eventId, narrow = false }: { line: MissingLine; clientId: string | null; eventId: string | null; narrow?: boolean }) {
  return (
    <p className={`mt-0.5 text-xs ${line.ochre ? "text-amber-700 dark:text-amber-300" : line.muted ? "text-muted-foreground" : "text-destructive"}`} data-missing data-tone={line.ochre ? "ochre" : line.muted ? "muted" : "brick"}>
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

/** A stored reason's first line follows the state word; any later line (Meta's words) sits underneath. */
function StateText({ state, reason }: { state: Parameters<typeof stateText>[0]; reason: string | null }) {
  const [first, ...rest] = (reason ?? "").split("\n");
  return (
    <>
      {k(stateText(state, first || null))}
      {rest.map((text) => (
        <span key={text} className="block" data-reason-under>
          {k(text)}
        </span>
      ))}
    </>
  );
}

const figure = (value: string | number | null, format?: (v: number) => string) => (value == null ? NO_FIGURE : typeof value === "number" ? (format ? format(value) : String(value)) : value);

function TierTable({ rows, budgets, clientId, eventId, created }: { rows: TierRow[]; budgets: (row: TierRow) => number; clientId: string | null; eventId: string | null; created: boolean }) {
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
              {row.links?.wide.map((line) => (
                <p key={line} className="text-muted-foreground" data-links>
                  {k(line)}
                </p>
              ))}
              {row.missing.map((line) => (
                <Missing key={line.text} line={line} clientId={clientId} eventId={eventId} />
              ))}
            </td>
            <td className="py-2 pr-2 tabular-nums" data-pool>{created ? k(figure(row.pool)) : POOL_BEFORE_CREATE}</td>
            <td className={`py-2 pr-2 tabular-nums ${row.frequency != null && row.frequency >= 4 ? "text-destructive" : ""}`}>{figure(row.frequency, (v) => v.toFixed(1))}</td>
            <td className="py-2 pr-2">{row.leavesOut ? k(row.leavesOut) : NO_FIGURE}</td>
            <td className="py-2 pr-2 tabular-nums">{k(tierBudget(budgets(row)))}</td>
            <td className="py-2 pr-2 tabular-nums">{row.cost == null ? NO_FIGURE : k(pence(row.cost))}</td>
            <td className="py-2 tabular-nums">{k(figure(row.purchases))}</td>
          </tr>
        ))}
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
                <p className="mt-0.5">{row.cost == null ? NO_FIGURE : k(`${pence(row.cost)} per attributed purchase · ${row.purchases ?? 0}`)}</p>
                <p className={`mt-0.5 ${row.frequency != null && row.frequency >= 4 ? "text-destructive" : ""}`}>{k(`${pool} · frequency ${row.frequency == null ? NO_FIGURE : row.frequency.toFixed(1)}`)}</p>
                {row.leavesOut ? <p className="mt-0.5">{k(`Leaves out ${row.leavesOut.replace(/^Buyers$/, "buyers")}`)}</p> : null}
              </>
            ) : (
              <p className="mt-0.5 text-muted-foreground">{k(row.leavesOut ? `${pool} · leaves out ${row.leavesOut}` : pool)}</p>
            )}
            {row.audiencesNarrow ? <p className="mt-0.5 text-muted-foreground">{k(row.audiencesNarrow)}</p> : null}
            {row.links?.narrow.map((line) => (
              <p key={line} className="mt-0.5 text-muted-foreground" data-links>
                {k(line)}
              </p>
            ))}
            {row.missing.map((line) => (
              <Missing key={line.text} line={line} clientId={clientId} eventId={eventId} narrow />
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function CreateCard({ view, line, shadow, apply, actions, share }: { view: RetargetingView; line: PanelLine | null; shadow: boolean; apply?: PanelApply; actions: RetargetingActions; share: number }) {
  const [picking, setPicking] = useState(false);
  const create = view.create!;
  const option = create.options.find((row) => row.share === share) ?? create.options[0]!;
  const state = line?.state ?? "to_review";
  const decidable = Boolean(apply && apply.mode === "live" && line && (state === "to_review" || state === "accepted" || state === "rejected"));
  const blocked = line?.blockedReason ?? option.blocked;
  const busy = Boolean(actions.busy);
  const shadowTitle = shadow ? "Shadow: nothing here can be applied yet" : undefined;
  return (
    <div className="mt-2 rounded border border-border/70 p-3" data-create data-line-state={state}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Create</span>
            <span className="text-sm font-medium">{create.title}</span>
          </p>
          {/* RT11: today's share, no choice. */}
          <p className="mt-0.5 hidden text-xs sm:block">{k(option.line)}</p>
          <p className="mt-0.5 text-xs sm:hidden">{k(createHead(option.totalMinor, option.share, option.stretch ?? null))}</p>
          <p className="mt-0.5 text-xs sm:hidden">{k(option.split)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{k(option.hold)}</p>
          {create.eachArm ? <p className="mt-0.5 text-xs text-muted-foreground" data-each-arm>{k(create.eachArm)}</p> : null}
          {create.tooSmall ? <p className="mt-0.5 text-xs text-muted-foreground" data-too-small>{k(create.tooSmall)}</p> : null}
          {create.startsLine ? <p className="mt-0.5 text-xs text-muted-foreground" data-test-starts>{k(create.startsLine)}</p> : null}
          {create.legacy.map((text) => (
            <p key={text} className="mt-0.5 text-xs text-muted-foreground" data-legacy>
              {k(text)}
            </p>
          ))}
          <p className="mt-0.5 hidden text-xs sm:block">{create.writeText}</p>
          {blocked ? <p className="mt-0.5 text-xs text-muted-foreground">{k(blocked)}</p> : null}
          {state !== "to_review" ? (
            <p className={`mt-0.5 text-xs ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`} data-line-state={state}>
              <StateText state={state} reason={line?.reason ?? null} />
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

/** RT17: one arm's table (1280): Tier, Audiences, Pool, Frequency, Budget, Cost per attributed purchase, Purchases, and its total row. */
function ArmTable({ arm }: { arm: ArmView }) {
  return (
    <div className="mt-3 hidden sm:block" data-arm={arm.arm}>
      <p className="text-xs font-medium">{arm.label}</p>
      <table className="mt-1 w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-[10%]" />
          <col className="w-[38%]" />
          <col className="w-[13%]" />
          <col className="w-[9%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">Tier</th>
            <th className="py-1.5 pr-2 font-medium">Audiences</th>
            <th className="py-1.5 pr-2 font-medium">Pool</th>
            <th className="py-1.5 pr-2 font-medium">Frequency</th>
            <th className="py-1.5 pr-2 font-medium">Budget</th>
            <th className="py-1.5 pr-2 font-medium">Cost per attributed purchase</th>
            <th className="py-1.5 font-medium">Purchases</th>
          </tr>
        </thead>
        <tbody>
          {arm.rows.map((row) => (
            <tr key={row.tier} className="border-b border-border/60 align-top" data-tier={row.tier}>
              <td className="py-2 pr-2 font-medium">{row.label}</td>
              <td className="py-2 pr-2">
                {row.audiences.map((line) => (
                  <p key={line}>{k(line)}</p>
                ))}
              </td>
              <td className="py-2 pr-2 tabular-nums">{k(figure(row.pool))}</td>
              <td className={`py-2 pr-2 tabular-nums ${row.frequency != null && row.frequency >= 4 ? "text-destructive" : ""}`}>{figure(row.frequency, (v) => v.toFixed(1))}</td>
              <td className="py-2 pr-2 tabular-nums">{k(tierBudget(row.budgetMinor))}</td>
              <td className="py-2 pr-2 tabular-nums">{row.cost == null ? NO_FIGURE : k(pence(row.cost))}</td>
              <td className="py-2 tabular-nums">{k(figure(row.purchases))}</td>
            </tr>
          ))}
          <tr className="align-top text-muted-foreground" data-total>
            <td className="py-2 pr-2">{LAST_7_DAYS}</td>
            <td className="py-2 pr-2 tabular-nums">{k(spentText(arm.total.spentMinor))}</td>
            <td />
            <td />
            <td className="py-2 pr-2 tabular-nums">{k(tierBudget(arm.total.budgetMinor))}</td>
            <td className="py-2 pr-2 tabular-nums">{arm.total.cost == null ? NO_FIGURE : k(pence(arm.total.cost))}</td>
            <td className="py-2 tabular-nums">{arm.total.purchases}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** RT17 at 393: each arm one card, headed by the arm and its budget. */
function ArmCard({ arm }: { arm: ArmView }) {
  return (
    <div className="mt-2 rounded border border-border/70 p-3 text-xs sm:hidden" data-arm-card={arm.arm}>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{arm.label}</span>
        <span className="tabular-nums">{k(tierBudget(arm.total.budgetMinor))}</span>
      </p>
      <p className="mt-0.5">{arm.total.cost == null ? NO_FIGURE : k(`${pence(arm.total.cost)} per attributed purchase · ${arm.total.purchases}`)}</p>
      {arm.rows.map((row) => (
        <p key={row.tier} className="mt-0.5 text-muted-foreground">
          {k(armTierNarrow({ tier: row.tier, budgetMinor: row.budgetMinor, cost: row.cost, purchases: row.purchases, frequency: row.frequency }))}
        </p>
      ))}
    </div>
  );
}

/** RT17: the pooled block, "The test, every show". */
function Pooled({ test }: { test: TestView }) {
  if (!test.pooled) return null;
  return (
    <div className="mt-3" data-pooled>
      <p className="text-xs font-medium sm:block">
        {POOLED_TITLE}
        {test.pooledDays != null ? <span className="ml-2 font-normal text-muted-foreground sm:hidden">{`${test.pooledDays} days`}</span> : null}
      </p>
      <table className="mt-1 hidden w-full border-collapse text-xs sm:table">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">Arm</th>
            <th className="py-1.5 pr-2 font-medium">Shows</th>
            <th className="py-1.5 pr-2 font-medium">Days</th>
            <th className="py-1.5 pr-2 font-medium">Spend</th>
            <th className="py-1.5 pr-2 font-medium">Attributed purchases</th>
            <th className="py-1.5 font-medium">Cost per attributed purchase</th>
          </tr>
        </thead>
        <tbody>
          {test.pooled.map((row) => (
            <tr key={row.arm} className="border-b border-border/60" data-pooled-arm={row.arm}>
              <td className="py-1.5 pr-2">{row.arm}</td>
              <td className="py-1.5 pr-2 tabular-nums">{row.shows}</td>
              <td className="py-1.5 pr-2 tabular-nums">{row.days}</td>
              <td className="py-1.5 pr-2 tabular-nums">{k(pence(row.spend))}</td>
              <td className="py-1.5 pr-2 tabular-nums">{row.purchases}</td>
              <td className="py-1.5 tabular-nums">{row.cost == null ? NO_FIGURE : k(pence(row.cost))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {test.pooled.map((row) => (
        <p key={row.arm} className="mt-0.5 text-xs sm:hidden">
          {k(`${row.arm} · ${row.shows} shows · ${row.cost == null ? NO_FIGURE : pence(row.cost)} per attributed purchase · ${row.purchases}`)}
        </p>
      ))}
      {test.note ? <p className="mt-2 text-xs text-muted-foreground" data-call-note>{k(test.note)}</p> : null}
    </div>
  );
}

/** RT17: the call, one line for Matas on every show in the test; accepting it once applies to all. Accept and Reject sit right at 1280, under it at 393. */
function CallCard({ line, shadow, apply, actions }: { line: PanelLine; shadow: boolean; apply?: PanelApply; actions: RetargetingActions }) {
  const [picking, setPicking] = useState(false);
  const state = line.state;
  const decidable = Boolean(apply && apply.mode === "live" && (state === "to_review" || state === "accepted" || state === "rejected"));
  const busy = Boolean(actions.busy);
  const shadowTitle = shadow ? "Shadow: nothing here can be applied yet" : undefined;
  const onAccept = line.retargetingCall?.onAccept ?? null;
  return (
    <div className="mt-3 rounded border border-border/70 p-3" data-call data-line-state={state}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Call</span>
            <span className="hidden text-sm font-medium sm:inline">{k(line.title)}</span>
          </p>
          <p className="mt-0.5 hidden text-xs sm:block">{k(line.detail)}</p>
          {onAccept ? <p className="mt-0.5 hidden text-xs sm:block">{k(onAccept)}</p> : null}
          {line.writeText ? <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{k(line.writeText)}</p> : null}
          <p className="mt-0.5 text-sm font-medium sm:hidden">{k(line.narrow?.detail ?? line.title)}</p>
          {line.narrow?.writeText ? <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{k(line.narrow.writeText)}</p> : null}
          {state !== "to_review" ? (
            <p className={`mt-0.5 text-xs ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`} data-line-state={state}>
              <StateText state={state} reason={line.reason ?? null} />
            </p>
          ) : null}
        </div>
        {state === "applied" || state === "applying" || state === "expired" ? null : (
          <div className="flex shrink-0 gap-2" role="group" aria-label="Accept or reject">
            <Button type="button" size="sm" variant={state === "accepted" ? "primary" : "outline"} aria-pressed={state === "accepted"} disabled={!decidable || busy} title={shadowTitle} onClick={() => actions.onDecide?.(line.id, "accept")}>
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
        )}
      </div>
      {picking ? (
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
  /** RT17: the layout test's call, when one is stored. */
  callLine?: PanelLine | null;
  clientId?: string | null;
  /** The show, for RT8's wizard links. */
  eventId?: string | null;
  /** The gates (live controls). Absent = read-only (the frames). */
  apply?: PanelApply;
  mode?: "shadow" | "live";
  actions?: RetargetingActions;
};

export function RetargetingPanelView({ view, line = null, callLine = null, clientId = null, eventId = null, apply, mode, actions = {} }: RetargetingPanelViewProps) {
  // RT3: before Apply the tiers' audiences don't exist, so the pool is "Known after create".
  const created = view.state === "running";
  const create = view.create;
  // RT11: one share, today's.
  const share = line?.share ?? create?.defaultShare ?? 10;
  const shadow = apply ? apply.mode === "shadow" : (mode ?? "shadow") === "shadow";
  const option = create?.options.find((row) => row.share === share) ?? null;
  const budgets = (row: TierRow) => (option ? option.tiers[row.tier] : row.budgetMinor);
  const accepted = apply && line && appliesNow({ kind: line.kind, state: line.state, writeKind: line.writeKind ?? null }, apply) ? 1 : 0;
  const retry = apply && line && line.state === "failed" && appliesNow({ kind: line.kind, state: "accepted", writeKind: line.writeKind ?? null }, apply) ? 1 : 0;
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

      {view.running?.off ? (
        <p className="mt-2 text-xs text-destructive" data-retargeting-off>
          {k(view.running.off)}
        </p>
      ) : null}

      {view.notProposed ? (
        <p className="mt-2 text-xs text-muted-foreground" data-not-proposed={view.state}>
          {k(view.notProposed)}
        </p>
      ) : null}

      {create ? <CreateCard view={view} line={line} shadow={shadow} apply={apply} actions={actions} share={share} /> : null}

      {view.test ? (
        <>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block" data-each-arm>
            {k(view.test.eachArm)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground sm:hidden">{k(view.test.eachArmNarrow)}</p>
          <p className="text-xs text-muted-foreground sm:hidden">{k(view.test.metaSplits)}</p>
          {view.test.arms.map((arm) => (
            <ArmTable key={`t-${arm.arm}`} arm={arm} />
          ))}
          {view.test.arms.map((arm) => (
            <ArmCard key={`c-${arm.arm}`} arm={arm} />
          ))}
          <Pooled test={view.test} />
        </>
      ) : null}
      {callLine ? <CallCard line={callLine} shadow={shadow} apply={apply} actions={actions} /> : null}

      {view.tiers.length ? (
        <>
          <TierTable rows={view.tiers} budgets={budgets} clientId={clientId} eventId={eventId} created={created} />
          <TierCards rows={view.tiers} budgets={budgets} clientId={clientId} eventId={eventId} created={created} />
          {view.notes.map((note) => (
            <Missing key={note.text} line={note} clientId={clientId} eventId={eventId} />
          ))}
        </>
      ) : null}

      {apply && line ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-end">
          {actions.error ? <p className="text-xs text-destructive">{actions.error}</p> : null}
          <div className="flex shrink-0 gap-2">
            {retry ? (
              <Button type="button" size="sm" variant="outline" disabled={shadow || Boolean(actions.busy)} onClick={() => actions.onApply?.({ retry: true, lineIds: [line.id] })}>
                Retry failed (1)
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={shadow || accepted === 0 || Boolean(actions.busy)} onClick={() => actions.onApply?.({ retry: false, lineIds: [line.id] })}>
              {actions.busy ? "Applying…" : `Apply accepted (${accepted})`}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
