"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { REJECT_REASONS, appliesNow, retriesNow, stateText, type RejectReason } from "@/lib/onsale-refresh/line-states";
import type { PanelApply, PanelLine, PanelProposal } from "@/lib/onsale-refresh/read";
import { isShowWeek } from "@/lib/onsale-refresh/on-sale";
import { appliedStamp, dayMonth, outcomeWeek, shortDay, todayLondon, weekLabel } from "@/lib/onsale-refresh/schedule";

/**
 * The Refresh panel (R4, F1 at 1280, F2 at 393, F3 after Apply): the
 * latest proposal per campaign. Without its gates (the P1 frames) it is
 * read-only, as P1 drew it. With them (P2): the Shadow / Live arm, Accept
 * and Reject as a toggle pair while Live (Reject asks for a reason), each
 * add line's copy before Accept, Apply accepted (n) for creative lines,
 * the result in each applied line, and Retry failed (n). The words are
 * the record's.
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

const CTA_WORD: Record<string, string> = { sign_up: "Sign up", learn_more: "Learn more", book_now: "Book now", buy_tickets: "Buy tickets" };

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The copy the new ad goes in with (R4: the line shows the creative and its copy before Accept). */
function CopyBlock({ copy }: { copy: NonNullable<PanelLine["copy"]> }) {
  const facts = [copy.headline, CTA_WORD[copy.cta] ?? copy.cta, hostOf(copy.destinationUrl)].filter(Boolean).join(" · ");
  return (
    <div className="mt-1 border-l-2 border-border pl-2 text-xs" data-copy="add">
      {copy.primaryText ? <p className="line-clamp-3 whitespace-pre-line sm:line-clamp-2">“{copy.primaryText}”</p> : null}
      <p className="text-muted-foreground">{facts}</p>
    </div>
  );
}

export type PanelActions = {
  onArm?: (mode: "shadow" | "live") => void;
  onDecide?: (lineId: string, decision: "accept" | "reject", reason?: RejectReason, note?: string) => void;
  onApply?: (opts: { retry: boolean; lineIds?: string[] }) => void;
  busy?: boolean;
  error?: string | null;
};

/** One line with P2's controls: the toggle pair while Live, the reason picker, the result and Retry. */
function LiveLineRow({ line, apply, actions, frozen }: { line: PanelLine; apply: PanelApply; actions: PanelActions; frozen: boolean }) {
  const [picking, setPicking] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const live = apply.mode === "live" && !frozen;
  const decidable = live && !line.supply && (line.state === "to_review" || line.state === "accepted" || line.state === "rejected");
  const shadowTitle = apply.mode === "shadow" ? "Shadow: nothing here can be applied yet" : undefined;
  const busy = Boolean(actions.busy);
  const retry = retriesNow(line, apply);
  return (
    <li className="rounded border border-border/70 p-3" data-kind={line.kind} data-state={line.state}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[line.kind]}</span>
            <span className="break-words text-sm font-medium">{line.title}</span>
          </div>
          {line.carried ? <p className="mt-0.5 text-xs text-muted-foreground">From the {line.carried} proposal</p> : null}
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Wide wide={line.detail} narrow={line.narrow.detail} />
          </p>
          {line.copy ? <CopyBlock copy={line.copy} /> : null}
          {line.state === "to_review" || line.state === "accepted" ? (
            <>
              <p className="mt-0.5 hidden text-xs sm:block">{line.writeText}</p>
              {line.narrow.writeText ? <p className="mt-0.5 text-xs sm:hidden">{line.narrow.writeText}</p> : null}
            </>
          ) : null}
          {line.blockedReason && (line.state === "to_review" || line.state === "rejected") ? <p className="mt-0.5 text-xs text-destructive">{line.blockedReason}</p> : null}
          {line.state !== "to_review" ? (
            <p className={`mt-0.5 text-xs ${line.state === "failed" ? "text-destructive" : line.state === "applied" ? "font-medium text-foreground" : "text-muted-foreground"}`} data-line-state={line.state}>
              {stateText(line.state, line.reason)}
            </p>
          ) : null}
          {picking ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" data-reasons>
              {(Object.keys(REJECT_REASONS) as RejectReason[]).map((reason) =>
                reason === "other" ? (
                  <Button key={reason} type="button" size="sm" variant={other != null ? "secondary" : "outline"} disabled={busy} onClick={() => setOther(other == null ? "" : null)}>
                    {REJECT_REASONS[reason]}
                  </Button>
                ) : (
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
                ),
              )}
              {other != null ? (
                <span className="flex w-full items-center gap-1.5 sm:w-auto">
                  <input
                    aria-label="Why (optional)"
                    placeholder="Why (optional)"
                    className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs sm:w-56"
                    value={other}
                    maxLength={200}
                    onChange={(event) => setOther(event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPicking(false);
                      actions.onDecide?.(line.id, "reject", "other", other);
                      setOther(null);
                    }}
                  >
                    Reject
                  </Button>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {line.supply ? (
          <Link href="#lab-round" className="shrink-0 text-xs underline underline-offset-2">
            Open Lab
          </Link>
        ) : line.state === "failed" ? (
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!live || busy || !retry} onClick={() => actions.onApply?.({ retry: true, lineIds: [line.id] })}>
              Retry
            </Button>
          </div>
        ) : line.state === "applied" || line.state === "applying" || line.state === "expired" ? null : (
          <div className="flex shrink-0 gap-2" role="group" aria-label="Accept or reject">
            <Button
              type="button"
              size="sm"
              variant={line.state === "accepted" ? "primary" : "outline"}
              aria-pressed={line.state === "accepted"}
              disabled={!decidable || busy || (line.state !== "accepted" && Boolean(line.blockedReason))}
              title={shadowTitle}
              onClick={() => actions.onDecide?.(line.id, "accept")}
            >
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant={line.state === "rejected" ? "secondary" : "ghost"}
              aria-pressed={line.state === "rejected"}
              disabled={!decidable || busy}
              title={shadowTitle}
              onClick={() => {
                if (line.state === "rejected") actions.onDecide?.(line.id, "reject");
                else setPicking(!picking);
              }}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** The per-event arm (R4): Shadow / Live, as the budget tick's. Live acts only with the deployment gate on. */
function ArmControl({ apply, actions }: { apply: PanelApply; actions: PanelActions }) {
  const offTitle = apply.globalEnabled ? undefined : "Applying is switched off on this deployment, so the panel stays in Shadow.";
  return (
    <div className="flex shrink-0 overflow-hidden rounded-full border border-border text-xs" role="group" aria-label="Shadow or Live" data-arm={apply.arm} title={offTitle}>
      {(["shadow", "live"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={apply.arm === mode}
          disabled={Boolean(actions.busy) || apply.arm === mode}
          className={`px-2 py-0.5 ${apply.arm === mode ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => actions.onArm?.(mode)}
        >
          {mode === "shadow" ? "Shadow" : "Live"}
        </button>
      ))}
    </div>
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

/**
 * The Objective block (F1 of the per-event purchases record): E4's setup
 * line when the ads' pixel is not the stored one, the objective, the
 * purchase line in its state, the attributed figure under it, and the
 * ticketing note or check. On the ticket-platform path (T4 of the
 * ticket-platform record) the attributed figure is the count, so there is
 * no attributed line: the moves sentence follows the purchase line at
 * 1280 and the platform's share of the pixel's purchases sits under it.
 * A proposal stored before the per-event record has no `attributed`
 * either; its purchase line already says the figure.
 */
export function ObjectiveBlock({ why, heading = true }: { why: PanelProposal["why"]; heading?: boolean }) {
  const setup = why.pixel ?? [];
  const setupNarrow = why.pixelNarrow ?? setup;
  return (
    <div className={heading ? "mb-3" : undefined} data-block="objective">
      {heading ? <p className="text-xs font-medium">Objective</p> : null}
      {setup.length ? (
        <div className="my-1 rounded bg-muted px-2 py-1.5 text-xs" data-setup="pixel">
          {setup.map((line, index) => (
            <p key={line}>
              <Wide wide={line} narrow={setupNarrow[index] ?? line} />
            </p>
          ))}
        </div>
      ) : null}
      {why.objective ? <p className="text-xs">{why.objective}</p> : null}
      <p className="text-xs text-muted-foreground">
        <Wide wide={why.purchase} narrow={why.purchaseNarrow || why.purchase} />
        {why.attributed ? null : <span className="hidden sm:inline"> {why.moves}</span>}
      </p>
      {why.attributed ? (
        <p className="text-xs text-muted-foreground">
          <Wide wide={`${why.attributed} ${why.moves}`.trim()} narrow={why.attributedNarrow ?? why.attributed} />
        </p>
      ) : null}
      {why.context ? (
        <p className="text-xs text-muted-foreground">
          <Wide wide={why.context} narrow={why.contextNarrow ?? why.context} />
        </p>
      ) : null}
      {why.ticketing ? <p className="text-xs text-muted-foreground">{why.ticketing}</p> : null}
    </div>
  );
}

export type OnSaleRefreshPanelViewProps = {
  eventId: string;
  proposals: PanelProposal[];
  /** G2: from show week's Monday the refresh has stopped; the empty panel says so, and (HC4) the line sits above older proposals. */
  showWeek?: boolean;
  /** P2: the gates. Absent = P1's read-only panel (the OR1 frame). */
  apply?: PanelApply;
  actions?: PanelActions;
};

/** The panel from data; the viewport decides the wide or the narrow wording. Nothing here fetches. */
export function OnSaleRefreshPanelView({ eventId, proposals, showWeek = false, apply, actions = {} }: OnSaleRefreshPanelViewProps) {
  if (!proposals.length) {
    return (
      <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4">
        <p className="text-sm font-medium">On-sale refresh</p>
        <p className="mt-1 text-xs text-muted-foreground">{showWeek ? "Show week: the refresh has stopped." : "No proposal yet. The first one comes on the next cycle Monday, ready by 08:00."}</p>
      </section>
    );
  }
  const head = proposals[0]!;
  const shadow = apply ? apply.mode === "shadow" : head.mode === "shadow";
  const all = proposals.flatMap((p) => p.lines);
  const accepted = apply ? all.filter((line) => appliesNow(line, apply)).length : all.filter((line) => line.state === "accepted").length;
  const failed = apply ? all.filter((line) => retriesNow(line, apply)).length : 0;
  // F3: the latest Apply, and the week its lines are checked on.
  const lastApplied = apply ? all.map((line) => line.appliedAt ?? "").filter(Boolean).sort().at(-1) ?? null : null;
  const outcome = lastApplied ? outcomeWeek(lastApplied) : null;
  return (
    <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4" data-mode={apply ? apply.mode : head.mode}>
      {apply && showWeek ? <p className="mb-2 text-xs font-medium">Show week: the refresh has stopped.</p> : null}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">On-sale refresh · {weekLabel(head.cycleMonday)}</p>
          <p className="text-xs text-muted-foreground">
            Data to {shortDay(head.windowEnd)}
            <Wide wide={nextLine(head, true)} narrow={nextLine(head, false)} />
          </p>
          {lastApplied ? <p className="text-xs text-muted-foreground">Applied {appliedStamp(lastApplied)}</p> : null}
        </div>
        {apply ? <ArmControl apply={apply} actions={actions} /> : <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs">{shadow ? "Shadow" : "Live"}</span>}
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

      <ObjectiveBlock why={head.why} />

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
                {creatives.map((line) => (apply ? <LiveLineRow key={line.id} line={line} apply={apply} actions={actions} frozen={showWeek} /> : <LineRow key={line.id} line={line} shadow={shadow} />))}
              </ul>
            ) : null}
            {creatives.some((line) => line.kind === "add_creative") && proposal.notes.adds ? <p className="mt-1 text-xs text-muted-foreground">{proposal.notes.adds}</p> : null}
            <div className="mt-2">
              <Watch label="Watch" items={proposal.watch.creatives} note={proposal.notes.pauses} />
            </div>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Audiences</p>
            {audiences.length ? (
              <ul className="mt-1 space-y-2">
                {audiences.map((line) => (apply ? <LiveLineRow key={line.id} line={line} apply={apply} actions={actions} frozen={showWeek} /> : <LineRow key={line.id} line={line} shadow={shadow} />))}
              </ul>
            ) : null}
            <div className="mt-2">
              <Watch label="Watch" items={proposal.watch.audiences} note={proposal.notes.drops} />
            </div>
          </div>
        );
      })}

      {apply ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            <p>
              {shadow ? (
                <Wide wide="Shadow: nothing here can be applied yet. Each line is checked against next week's data." narrow="Shadow: nothing applies yet." />
              ) : outcome ? (
                <Wide wide={`Outcomes are checked ${shortDay(outcome.checked)} on the week to ${shortDay(outcome.to)}.`} narrow={`Checked ${shortDay(outcome.checked)}.`} />
              ) : (
                "Outcomes are checked after the next full week."
              )}
            </p>
            {actions.error ? <p className="mt-0.5 text-destructive">{actions.error}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            {failed > 0 ? (
              <Button type="button" size="sm" variant="outline" disabled={shadow || showWeek || Boolean(actions.busy)} onClick={() => actions.onApply?.({ retry: true })}>
                Retry failed ({failed})
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={shadow || showWeek || accepted === 0 || Boolean(actions.busy)} onClick={() => actions.onApply?.({ retry: false })}>
              {actions.busy ? "Applying…" : `Apply accepted (${accepted})`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {shadow ? <Wide wide="Shadow: nothing here can be applied yet. Each line is checked against next week's data." narrow="Shadow: nothing applies yet." /> : "Outcomes are checked after the next full week."}
          </p>
          <Button type="button" size="sm" disabled={shadow || accepted === 0}>
            Apply accepted ({accepted})
          </Button>
        </div>
      )}
    </section>
  );
}

/** The live panel: fetches the event's proposals and gates through the session route, and wires P2's clicks. Mounted by G2's on-sale predicate. */
export function OnSaleRefreshPanel({ eventId, eventDate }: { eventId: string; eventDate: string | null }) {
  const showWeek = isShowWeek(eventDate, todayLondon(new Date()));
  const [panel, setPanel] = useState<{ proposals: PanelProposal[]; apply: PanelApply | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/onsale-refresh`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { proposals: PanelProposal[]; apply?: PanelApply };
    setPanel({ proposals: body.proposals ?? [], apply: body.apply ?? null });
  }, [eventId]);
  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);
  const act = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/onsale-refresh/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setActionError(json.error ?? `HTTP ${res.status}`);
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed");
      } finally {
        setBusy(false);
      }
    },
    [eventId, load],
  );
  if (error) {
    return (
      <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4 text-xs text-destructive">
        On-sale refresh: {error}
      </section>
    );
  }
  if (!panel) {
    return (
      <section id="onsale-refresh" className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
        On-sale refresh…
      </section>
    );
  }
  const actions: PanelActions = {
    busy,
    error: actionError,
    onArm: (mode) => void act("arm", { mode }),
    onDecide: (lineId, decision, reason, note) => void act(`lines/${lineId}`, { decision, reason, note }),
    onApply: (opts) => void act("apply", opts),
  };
  return <OnSaleRefreshPanelView eventId={eventId} proposals={panel.proposals} showWeek={showWeek} apply={panel.apply ?? undefined} actions={actions} />;
}

export { dayMonth as refreshDayMonth };
