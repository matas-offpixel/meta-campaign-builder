"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { isInPaydayWindow } from "@/lib/dashboard/pacing";
import { offerRefusal, offerWords, type OfferFigures, type OfferKind } from "@/lib/releases/offers";
import { paydayPush } from "@/lib/releases/windows";
import { RELEASE_STATES, type ReleaseState } from "@/lib/releases/types";

const FULL = ["not yet", "on sale", "selling fast", "final X", "sold out"];
const SHORT = ["not yet", "on sale", "fast", "final", "out"];

/** Sentence case, as the records draw a panel title. The mono kicker stays for column labels. */
const PANEL_TITLE = "text-[13px] font-semibold tracking-normal";
const KICKER = "font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground";

/** Deck token for a content-led push. Not a new colour. */
const META_BLUE = "#5B7FA6";

export type RungMark = { text: string; short: string; status: "done" | "next" | "later" };

export type ReleaseRow = {
  id: string;
  name: string;
  when: string;
  shortWhen: string;
  state: ReleaseState;
  provenance: string;
  shortProvenance: string;
  /** Hidden on the 393 state list (the timeline still shows it). */
  wideOnly?: boolean;
  /** always: the chip shows at both widths. wide: only at 1280. */
  countChip?: "always" | "wide";
  timelineLabel: string;
  shortTimeline: string;
  left: string;
  /** Lower ladder band, so a long rung row clears the one above it. */
  low?: boolean;
  /** Backfilled: the derived segment is outlined, and there is no set-line. */
  plain?: boolean;
  rungs: RungMark[];
};

export type ClaimLine = { text: string; chip: string; tone: "ok" | "warn" | "dash" };

export function ReleasesPanel({
  kicker,
  place,
  headline,
  headlineRest,
  narrowRest,
  rows,
  claims,
  claimSummary,
  footnote,
  narrowFootnote,
  todayLabel = "Today · 7 Nov",
  todayShort = "Today",
  onState,
  onCount,
  bare = false,
}: {
  kicker: string;
  place: string;
  headline: string;
  headlineRest: string;
  narrowRest: string;
  rows: ReleaseRow[];
  claims: ClaimLine[];
  claimSummary: string;
  footnote: string;
  narrowFootnote?: string;
  todayLabel?: string;
  todayShort?: string;
  onState?: (id: string, state: ReleaseState, confirmed: boolean) => Promise<{ ask: boolean } | void>;
  onCount?: (id: string, sold: number) => Promise<void>;
  /** AB1b. The state panel only: no timeline, no claims. */
  bare?: boolean;
}) {
  const [ask, setAsk] = useState<string | null>(null);
  const [counting, setCounting] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-3">
      {bare ? null : <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className={PANEL_TITLE}>
            <span className="sm:hidden">Releases · {rows.length}</span>
            <span className="hidden sm:inline">Releases</span>
          </h3>
          <span className="text-xs text-muted-foreground">
            <span className="hidden sm:inline">{place}</span>
            <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => setEditing((open) => !open)}>
              <span className="sm:hidden">Edit</span>
              <span className="hidden sm:inline">Edit releases</span>
            </Button>
          </span>
        </div>
        {editing ? <EditSheet rows={rows} onClose={() => setEditing(false)} /> : null}
        <div className="overflow-hidden">
          <div className="overflow-x-auto">
            <Timeline rows={rows} todayLabel={todayLabel} todayShort={todayShort} />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground sm:hidden">scrolls sideways →</p>
        </div>
        <p className="sr-only">{kicker}</p>
      </section>}

      <div className={bare ? "" : "grid gap-3 sm:grid-cols-[1.7fr_1fr]"}>
        <section className="rounded-md border border-border bg-card p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className={PANEL_TITLE}>Where each release is</h3>
            {bare ? (
              <p>
                <span className="hidden font-heading text-2xl sm:inline">{headline}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline"> {headlineRest}</span>
                <span className="text-xs text-muted-foreground sm:hidden">{narrowRest}</span>
              </p>
            ) : (
              <p>
                <span className="font-heading text-2xl">{headline}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  <span className="sm:hidden">{narrowRest}</span>
                  <span className="hidden sm:inline">{headlineRest}</span>
                </span>
              </p>
            )}
          </div>
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className={row.wideOnly ? "hidden gap-2 sm:grid sm:grid-cols-[8rem_1fr_auto] sm:items-center" : "grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-center"}>
                <div>
                  <div className="text-sm">{row.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    <span className="sm:hidden">{row.shortWhen}</span>
                    <span className="hidden sm:inline">{row.when}</span>
                  </div>
                </div>
                <div className={row.plain ? "inline-flex max-w-full rounded-full border border-border-strong text-[10px] font-semibold whitespace-nowrap" : "inline-flex max-w-full overflow-hidden rounded-full border border-border-strong text-[10px] font-semibold whitespace-nowrap"}>
                  {RELEASE_STATES.map((state, index) => {
                    const on = state === row.state;
                    const past = RELEASE_STATES.indexOf(state) < RELEASE_STATES.indexOf(row.state);
                    const outlined = Boolean(row.plain && on);
                    const end = index === 0 ? "rounded-l-full" : index === RELEASE_STATES.length - 1 ? "rounded-r-full" : "";
                    return (
                      <button
                        key={state}
                        type="button"
                        className={outlined ? `border-r border-border px-1.5 py-1 last:border-r-0 text-foreground outline outline-[1.5px] outline-offset-[-1px] outline-foreground/70 ${end}` : `border-r border-border px-1.5 py-1 last:border-r-0 ${on ? "bg-foreground text-background" : past ? "text-muted-foreground" : "text-foreground/80"}`}
                        onClick={async () => {
                          if (!onState) return;
                          const result = await onState(row.id, state, ask === `${row.id}:${state}`);
                          if (result?.ask) setAsk(`${row.id}:${state}`);
                          else setAsk(null);
                        }}
                      >
                        <span className="hidden sm:inline">{FULL[index]}</span>
                        <span className="sm:hidden">{SHORT[index]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-xs">
                  {row.plain ? null : <b>{FULL[RELEASE_STATES.indexOf(row.state)]}</b>}
                  <div className="text-muted-foreground">
                    <span className="hidden sm:inline">{row.provenance}</span>
                    <span className="sm:hidden">{row.shortProvenance}</span>
                    {row.countChip && counting === row.id ? (
                      <form
                        className="mt-1 flex gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const sold = Number(draft);
                          if (!Number.isFinite(sold) || !onCount) return;
                          void onCount(row.id, sold).then(() => setCounting(null));
                        }}
                      >
                        <input
                          aria-label={`Count for ${row.name}`}
                          inputMode="numeric"
                          className="w-20 rounded border border-border bg-background px-1 py-0.5"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                      </form>
                    ) : (
                      row.countChip ? (
                      <button type="button" className={`ml-1 rounded border border-dashed border-border px-1 ${row.countChip === "wide" ? "hidden sm:inline" : ""}`} onClick={() => { setCounting(row.id); setDraft(""); }}>
                        add a count
                      </button>
                      ) : null
                    )}
                  </div>
                  {ask?.startsWith(`${row.id}:`) ? (
                    <p className="text-warning">Move {row.name} back? Tap the state again to confirm.</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {bare ? (
            <p className="mt-3 hidden text-[11px] text-muted-foreground sm:block">{footnote}</p>
          ) : (
            <p className="mt-3 text-[11px] text-muted-foreground">
              <span className="sm:hidden">{narrowFootnote ?? footnote}</span>
              <span className="hidden sm:inline">{footnote}</span>
            </p>
          )}
        </section>
        {bare ? null : <section className="hidden rounded-md border border-border bg-card p-4 sm:block">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className={PANEL_TITLE}>Claims</h3>
            <span className="text-[11px] text-muted-foreground">{claimSummary}</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {claims.map((claim) => (
              <li key={claim.text} className="flex justify-between gap-2">
                <span>{claim.text}</span>
                <Chip tone={claim.tone}>{claim.chip}</Chip>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">claims come from the ladder · a claim never runs above its trigger</p>
        </section>}
      </div>
    </div>
  );
}

/** The line is one element. Labels hang off it, so a second line never moves a dot. */
function Timeline({ rows, todayLabel, todayShort }: { rows: ReleaseRow[]; todayLabel: string; todayShort: string }) {
  return (
    <div className="relative h-48 min-w-[760px] sm:min-w-0">
      <div className="absolute top-20 right-0 left-0 h-0.5 bg-border-strong" />
      {rows.map((row) => (
        <ReleaseMark key={row.id} row={row} />
      ))}
      <div className="absolute top-20 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-warning" style={{ left: "66%" }} />
      <div className="absolute top-0 w-max -translate-x-1/2 text-[10.5px] font-semibold whitespace-nowrap text-warning" style={{ left: "66%" }}>
        <span className="hidden sm:inline">{todayLabel}</span>
        <span className="sm:hidden">{todayShort}</span>
      </div>
      <div className="absolute top-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-transparent" style={{ left: "86%" }} />
      <div className="absolute top-9 w-max -translate-x-1/2 text-center text-[10.5px] leading-tight font-semibold" style={{ left: "86%" }}>
        <span className="block whitespace-nowrap">Payday</span>
        <span className="block whitespace-nowrap font-normal">
          <span className="hidden sm:inline">Fri 27 Nov</span>
          <span className="sm:hidden">27 Nov</span>
        </span>
      </div>
      <div className="absolute top-20 hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive sm:block" style={{ left: "98%" }} />
      <div className="absolute top-9 hidden w-max -translate-x-full text-[10.5px] font-semibold whitespace-nowrap text-destructive sm:block" style={{ left: "98%" }}>
        Show · 27 Dec
      </div>
    </div>
  );
}

function ReleaseMark({ row }: { row: ReleaseRow }) {
  const [name, date] = splitTimeline(row.timelineLabel);
  const [shortName, shortDate] = splitTimeline(row.shortTimeline);
  return (
    <div className="absolute top-20 h-0 w-0 -translate-x-1/2" style={{ left: row.left }}>
      <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
      <div className="absolute bottom-3 left-1/2 w-max -translate-x-1/2 text-center text-[10.5px] leading-tight font-semibold">
        <span className="hidden whitespace-nowrap sm:block">{name}</span>
        {date ? <span className="hidden whitespace-nowrap font-normal text-foreground/80 sm:block">{date}</span> : null}
        <span className="whitespace-nowrap sm:hidden">{shortName}</span>
        {shortDate ? <span className="block whitespace-nowrap font-normal text-foreground/80 sm:hidden">{shortDate}</span> : null}
      </div>
      <div className={`absolute left-1/2 flex w-max -translate-x-1/2 items-center gap-1 text-[9.5px] ${row.low ? "top-10" : "top-3"}`}>
        {row.rungs.map((rung, index) => (
          <span key={rung.text} className="flex items-center gap-1">
            {index > 0 ? <span className="text-muted-foreground">→</span> : null}
            <RungPill rung={rung} />
          </span>
        ))}
      </div>
    </div>
  );
}

function splitTimeline(label: string): [string, string] {
  const cut = label.indexOf(" · ");
  if (cut < 0) return [label, ""];
  return [label.slice(0, cut), label.slice(cut + 3)];
}

function RungPill({ rung }: { rung: RungMark }) {
  const cls =
    rung.status === "done"
      ? "inline-flex h-[18px] items-center rounded border border-success bg-success px-1.5 whitespace-nowrap text-white"
      : rung.status === "next"
        ? "inline-flex h-[18px] items-center rounded border border-warning bg-card px-1.5 whitespace-nowrap text-warning"
        : "inline-flex h-[18px] items-center rounded border border-dashed border-border-strong px-1.5 whitespace-nowrap text-muted-foreground";
  return (
    <span className={cls}>
      <span className="hidden sm:inline">{rung.text}</span>
      <span className="sm:hidden">{rung.short}</span>
    </span>
  );
}

function EditSheet({ rows, onClose }: { rows: ReleaseRow[]; onClose: () => void }) {
  return (
    <form className="mb-3 space-y-2 rounded border border-border p-3" onSubmit={(event) => { event.preventDefault(); onClose(); }}>
      <p className="text-xs text-muted-foreground">Name, community time and list time. This is the only place those are typed.</p>
      {rows.map((row) => (
        <div key={row.id} className="grid gap-1 sm:grid-cols-3">
          <input aria-label={`${row.name} name`} defaultValue={row.name} className="rounded border border-border bg-background px-2 py-1 text-sm" />
          <input aria-label={`${row.name} community time`} placeholder="Community time" className="rounded border border-border bg-background px-2 py-1 text-sm" />
          <input aria-label={`${row.name} list time`} placeholder="List time" className="rounded border border-border bg-background px-2 py-1 text-sm" />
        </div>
      ))}
      <Button type="submit" size="sm">Save releases</Button>
    </form>
  );
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "dash" | "bad"; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-success text-success"
      : tone === "warn"
        ? "border-warning text-warning"
        : tone === "bad"
          ? "border-destructive text-destructive"
          : "border-dashed border-border text-muted-foreground";
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

function Piece() {
  return (
    <div className="flex h-28 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border px-1 text-center text-[10px] leading-tight text-muted-foreground">
      + needs the piece
    </div>
  );
}

export function ClaimCards({
  onCorrect,
}: {
  onCorrect?: (state: ReleaseState) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="text-success">✓ Read</span>
        <span className="mx-2 font-medium text-foreground">Propose</span>
        <span>Approve</span>
        <span className="mx-2">Scheduled</span>
        <span>Live</span>
      </p>
      <article className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-warning bg-card p-3 sm:grid-cols-[auto_1fr_auto]">
        <div className="flex h-28 w-16 shrink-0 flex-col items-center justify-center rounded px-0.5 text-center text-[8px] font-semibold leading-tight text-white" style={{ background: "linear-gradient(160deg,#1e1810,#5a3a2a)" }}>
          <span style={{ color: "#FE3232" }}>EARLY BIRD, 2ND & 3RD<br />RELEASE SOLD OUT</span>
          <span>FINAL RELEASE<br />RUNNING LOW</span>
        </div>
        <div>
          <p className="text-sm font-medium">
            Proposes: push the roll-call <Chip tone="warn">proposed</Chip>{" "}
            <span className="hidden sm:inline"><Chip tone="dash">preferred over &quot;90% sold out&quot;</Chip></span>
          </p>
          <p className="mt-1 hidden font-mono text-xs sm:block">
            <b>Skiddle read Mon 9 Nov 09:00:</b> early bird sold out · 2nd release sold out · 3rd release sold out · final release selling fast (on sale 3 days)
          </p>
          <p className="mt-1 hidden text-xs sm:block">
            <span className="text-muted-foreground">trigger</span> 3 releases sold out, 1 selling fast{" "}
            <span className="text-muted-foreground">→ claim</span> line 1 &quot;EARLY BIRD, 2ND &amp; 3RD RELEASE SOLD OUT&quot; · line 2 &quot;FINAL RELEASE RUNNING LOW&quot; (the final release&apos;s own rung: live · selling fast)
          </p>
          <p className="mt-1 text-xs sm:hidden">
            <span className="text-muted-foreground">trigger</span> 3 sold out, 1 selling fast → two lines, the names from the releases
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">preferred over &quot;90% sold out&quot;</p>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">Runs at the read, inside the window. Formats: 9:16 clip (T1), 4:5 and 1:1 statics (T2). Line 1 in kit red, line 2 white — the registered CTA piece if the designer supplies one, else the font path.</p>
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1 sm:flex-col">
          <Button type="button" size="sm">Approve</Button>
          <Button type="button" size="sm" variant="outline">Correct</Button>
        </div>
      </article>
      <article className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-warning bg-card p-3 sm:grid-cols-[auto_1fr_auto]">
        <div className="flex h-28 w-16 shrink-0 flex-col items-center justify-center rounded px-0.5 text-center text-[8px] font-semibold leading-tight text-white" style={{ background: "linear-gradient(160deg,#1e1810,#3a3a4a)" }}>
          <span>£10 TODAY<br />SPLIT THE REST IN 3</span>
        </div>
        <div>
          <p className="text-sm font-medium">
            <span className="hidden sm:inline">Proposes: push &quot;£10 today · split the rest in 3&quot;</span>
            <span className="sm:hidden">&quot;£10 today · split the rest in 3&quot;</span>{" "}
            <Chip tone="warn">entered, not derived</Chip>
          </p>
          <p className="mt-1 hidden text-xs sm:block">
            <span className="text-muted-foreground">offer</span> payment plan · £10 today, 3 parts · until Fri 27 Nov{" "}
            <span className="text-muted-foreground">entered by</span> Matas, Sun 8 Nov 14:10, from the Offers sheet
          </p>
          <p className="mt-1 hidden text-xs sm:block">
            <span className="text-muted-foreground">words</span> &quot;£10 TODAY&quot; / &quot;SPLIT THE REST IN 3&quot; · no scarcity words · £10 is a price the validator checks against the offer
          </p>
          <p className="mt-1 text-xs sm:hidden">
            <span className="text-muted-foreground">entered by</span> Matas, 8 Nov · until 27 Nov
          </p>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">No read makes an offer true, so there is no trigger line. Runs mid-month as content-led (A7) unless Matas sets a window. Formats: 4:5 and 1:1 statics (T2, the number on its own line at 1.5×).</p>
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1 sm:flex-col">
          <Button type="button" size="sm">Approve</Button>
          <Button type="button" size="sm" variant="outline">Edit the offer</Button>
        </div>
      </article>
      <article className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-warning bg-card p-3 sm:grid-cols-[auto_1fr_auto]">
        <Piece />
        <div>
          <p className="text-sm font-medium">
            Proposes: push &quot;2nd release 90% sold out&quot; <Chip tone="warn">proposed</Chip>
          </p>
          <p className="mt-1 font-mono text-xs">
            <b>Client message, Wed 4 Nov:</b> 2nd release selling fast (on sale 6 days) · 3rd release not yet · early bird sold out
          </p>
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">trigger</span> selling fast for 6 days, no count on the page{" "}
            <span className="text-muted-foreground">→ claim</span> &quot;90% sold out&quot; (Puzzle&apos;s ladder: selling fast 5+ days → 90%)
          </p>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">Runs Thu 5 – Fri 6 Nov, before the 3rd release opens. Formats: 9:16 video, 4:5, 1:1.</p>
          <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">selling fast 6 days → 90% · runs Thu–Fri</p>
          {correcting ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {RELEASE_STATES.map((state, index) => (
                <button key={state} type="button" className="rounded border border-border px-1.5 py-0.5 text-[11px]" onClick={() => onCorrect?.(state)}>
                  {FULL[index]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1 sm:flex-col">
          <Button type="button" size="sm">Approve</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCorrecting(true)}>Correct</Button>
        </div>
      </article>

      <article className="hidden grid-cols-[auto_1fr_auto] gap-3 rounded-md border border-border bg-card p-3 sm:grid">
        <Piece />
        <div>
          <p className="text-sm font-medium">
            3rd release live · selling fast <Chip tone="ok">approved · ran 6 Nov 12:00</Chip>
          </p>
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">trigger</span> 3rd release list time 6 Nov 12:00 passed, state on sale (set by Matas at 12:02){" "}
            <span className="text-muted-foreground">→ claim</span> &quot;live · selling fast&quot;
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Ran at the release time whatever the calendar said.</p>
        </div>
        <Chip tone="ok">Live</Chip>
      </article>

      <article className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-dashed border-border bg-card p-3 sm:grid-cols-[auto_1fr_auto]">
        <Piece />
        <div>
          <p className="text-sm font-medium">
            Final X · 3rd release <Chip tone="dash">locked</Chip>
          </p>
          <p className="mt-1 hidden text-xs sm:block">
            <span className="text-muted-foreground">trigger</span> needs the release at final X, or a count at 90%+{" "}
            <span className="text-muted-foreground">today</span> selling fast, day 1, no count
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">needs final X or a count at 90%+ · day 1</p>
          <p className="mt-1 hidden text-xs sm:block">Can&apos;t run yet. It comes back as a proposal when a read or an entry gets there. The X is the remaining figure, never typed.</p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Chip tone="dash">Locked</Chip>
        </div>
      </article>

      <article className="hidden gap-3 rounded-md border border-destructive bg-card p-3 sm:grid sm:grid-cols-[auto_1fr_auto]">
        <Piece />
        <div>
          <p className="text-sm font-medium">
            General sale 90% sold out <Chip tone="bad">back to held</Chip>
          </p>
          <p className="mt-1 text-xs text-destructive">
            Approved on 5 Nov from a read that showed general sale selling fast. Today&apos;s read shows it on sale, not selling fast. The trigger isn&apos;t met any more, so it&apos;s held until a read or an entry says selling fast again.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" size="sm" variant="outline">Correct the read</Button>
          <Button type="button" size="sm" variant="outline">Not now</Button>
        </div>
      </article>
    </div>
  );
}

type PushMark = "ticket" | "content" | "payday";

const CALENDAR: { ymd: string; day: string; lines?: { text: string; mark?: PushMark }[]; show?: boolean }[] = [
  { ymd: "2026-11-23", day: "23" },
  { ymd: "2026-11-24", day: "24" },
  { ymd: "2026-11-25", day: "25" },
  { ymd: "2026-11-26", day: "26" },
  { ymd: "2026-11-27", day: "27", lines: [{ text: "Payday" }, { text: "Payday push · 3rd release 90% sold out", mark: "ticket" }] },
  { ymd: "2026-11-28", day: "28", lines: [{ text: "3rd release 90% sold out", mark: "ticket" }] },
  { ymd: "2026-11-29", day: "29" },
  { ymd: "2026-11-30", day: "30" },
  { ymd: "2026-12-01", day: "1 Dec", lines: [{ text: "3rd release live 12:00", mark: "ticket" }] },
  { ymd: "2026-12-02", day: "2" },
  { ymd: "2026-12-03", day: "3" },
  { ymd: "2026-12-04", day: "4" },
  { ymd: "2026-12-05", day: "5" },
  { ymd: "2026-12-06", day: "6" },
  { ymd: "2026-12-07", day: "7" },
  { ymd: "2026-12-08", day: "8" },
  { ymd: "2026-12-09", day: "9" },
  { ymd: "2026-12-10", day: "10" },
  { ymd: "2026-12-11", day: "11" },
  { ymd: "2026-12-12", day: "12" },
  { ymd: "2026-12-13", day: "13" },
  { ymd: "2026-12-14", day: "14" },
  { ymd: "2026-12-15", day: "15", lines: [{ text: "Artist cards", mark: "content" }] },
  { ymd: "2026-12-16", day: "16", lines: [{ text: "UGC · Enzo", mark: "content" }] },
  { ymd: "2026-12-17", day: "17", lines: [{ text: "Experience", mark: "content" }] },
  { ymd: "2026-12-18", day: "18" },
  { ymd: "2026-12-19", day: "19" },
  { ymd: "2026-12-20", day: "20" },
  { ymd: "2026-12-21", day: "21" },
  { ymd: "2026-12-22", day: "22", lines: [{ text: "Final X · 3rd release · if triggered", mark: "ticket" }] },
  { ymd: "2026-12-23", day: "23" },
  { ymd: "2026-12-24", day: "24", lines: [{ text: "Payday push", mark: "payday" }, { text: "moved · 25th is Christmas" }] },
  { ymd: "2026-12-25", day: "25", lines: [{ text: "Payday · Christmas Day" }] },
  { ymd: "2026-12-26", day: "26" },
  { ymd: "2026-12-27", day: "27", lines: [{ text: "Show" }], show: true },
];

function Swatch({ mark }: { mark: PushMark | "window" }) {
  if (mark === "payday") return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm border-2 border-foreground align-middle" />;
  if (mark === "window") return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm border border-border-strong bg-background align-middle" />;
  if (mark === "ticket") return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm bg-destructive align-middle" />;
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm align-middle" style={{ background: META_BLUE }} />;
}

export function PaydayCalendar() {
  const moved = paydayPush(2026, 12);
  const payday = new Set(["2026-11-27", moved.day]);
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 hidden items-baseline justify-between gap-2 sm:flex">
        <h3 className={PANEL_TITLE}>Pushes · 23 Nov – 27 Dec</h3>
        <p className="text-[11px] text-muted-foreground">
          <Swatch mark="ticket" />ticket warning <Swatch mark="content" />content-led <Swatch mark="payday" />payday <Swatch mark="window" />payday window
        </p>
      </div>
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-1 text-[11px]">
          {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
            <div key={day} className={`${KICKER} text-center`}>{day}</div>
          ))}
          {CALENDAR.map((cell) => {
            const win = isInPaydayWindow(cell.ymd);
            return (
              <div
                key={cell.ymd}
                className={`min-h-16 rounded p-1 ${cell.show ? "bg-foreground text-background" : win ? "bg-background" : ""} ${payday.has(cell.ymd) ? "outline outline-2 outline-foreground" : ""} ${cell.ymd === "2026-12-25" ? "opacity-60" : ""}`}
              >
                <div>{cell.day}</div>
                {cell.lines?.map((line) => (
                  <div key={line.text} className="text-[9.5px] leading-tight">
                    {line.mark ? <Swatch mark={line.mark} /> : null}
                    {line.text === "moved · 25th is Christmas" ? moved.reason : line.text}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The window is the code&apos;s 18 days: Thursday 26 Nov to Sunday 13 Dec. Ticket warnings sit inside it; content-led pushes sit outside it. A live claim runs at its release time regardless. December&apos;s payday falls on Christmas Day, so the push moves to Thursday 24 and the day says why.
        </p>
      </div>
      <div className="space-y-3 text-xs sm:hidden">
        <p className={KICKER}>Week of 23 Nov · payday window opens Thu</p>
        <p className="font-medium"><Swatch mark="ticket" />Fri 27 · Payday push + 3rd release 90% sold out</p>
        <p><Swatch mark="ticket" />Sat 28 · 3rd release 90% sold out</p>
        <p><Swatch mark="ticket" />Tue 1 Dec · 3rd release live 12:00</p>
        <p className={KICKER}>Week of 14 Dec · mid-month</p>
        <p><Swatch mark="content" />Tue 15 · Artist cards</p>
        <p><Swatch mark="content" />Wed 16 · UGC · Enzo</p>
        <p><Swatch mark="content" />Thu 17 · Experience</p>
        <p className={KICKER}>Week of 21 Dec · show week</p>
        <p><Swatch mark="ticket" />Tue 22 · Final X · 3rd release · if triggered</p>
        <p className="font-medium"><Swatch mark="payday" />Thu 24 · Payday push (moved from Christmas Day)</p>
      </div>
    </section>
  );
}

type CellStatus = "made" | "approved" | "held" | "proposed" | "locked" | "missing" | "na";

const BOARD: { name: string; sub?: string; cells: { text: string; status: CellStatus }[] }[] = [
  { name: "Headliner UGC · promoter voice", cells: [{ text: "Enzo #2", status: "approved" }, { text: "—", status: "na" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { name: "Headliner UGC · artist voice", cells: [{ text: "Held · Luke Dean not cleared", status: "held" }, { text: "—", status: "na" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { name: "Artist card", sub: "A–Z, press shot", cells: [{ text: "+ audio 15 s", status: "made" }, { text: "", status: "approved" }, { text: "", status: "approved" }, { text: "+ needs Reeshy's press shot", status: "missing" }] },
  { name: "Lineup artwork edit", cells: [{ text: "+ needs the PSD", status: "missing" }, { text: "", status: "approved" }, { text: "", status: "approved" }, { text: "", status: "made" }] },
  { name: "2nd release", sub: "sold out · ladder done", cells: [{ text: "90% sold out", status: "approved" }, { text: "90% sold out", status: "approved" }, { text: "live", status: "approved" }, { text: "—", status: "na" }] },
  { name: "3rd release · 90% sold out", sub: "proposed · Mon read", cells: [{ text: "Proposed · approve", status: "proposed" }, { text: "Proposed · approve", status: "proposed" }, { text: "+ needs the PSD \"release\" slot", status: "missing" }, { text: "—", status: "na" }] },
  { name: "3rd release · final X", sub: "needs final X or 90%+ count", cells: [{ text: "Locked · day 1", status: "locked" }, { text: "Locked", status: "locked" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { name: "General sale · 90%", sub: "needs selling fast", cells: [{ text: "Locked · on sale, not fast", status: "locked" }, { text: "—", status: "na" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { name: "Client promo / experience", cells: [{ text: "Venue walk-through", status: "approved" }, { text: "", status: "approved" }, { text: "+ needs client's edit", status: "missing" }, { text: "—", status: "na" }] },
  { name: "Offer · payment plan", sub: "entered, not derived", cells: [{ text: "—", status: "na" }, { text: "£10 today", status: "proposed" }, { text: "£10 today", status: "proposed" }, { text: "—", status: "na" }] },
];

export function AssetBoard() {
  const [said, setSaid] = useState<string | null>(null);
  const heads = ["9:16 video", "4:5 static", "1:1 static", "9:16 static"];
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={PANEL_TITLE}>Asset bank</h3>
        <p className="text-xs">
          <span className="hidden sm:inline">15 approved · 2 proposed · 3 locked · 5 missing</span>
          <span className="sm:hidden">15 ✓ · 2 proposed · 3 locked · 5 missing</span>
          <Button
            type="button"
            size="sm"
            className="ml-2 hidden sm:inline-flex"
            onClick={() => setSaid("Nothing to make. The missing cells need a piece.")}
          >
            Make the missing 5
          </Button>
        </p>
      </div>
      {said ? <p className="mb-2 text-xs text-destructive">{said}</p> : null}
      <div className="hidden sm:grid sm:grid-cols-[1.4fr_repeat(4,1fr)] sm:gap-1 sm:text-[11px]">
        <span />
        {heads.map((head) => <span key={head} className={KICKER}>{head}</span>)}
        {BOARD.map((row) => (
          <RowCells key={row.name} name={row.name} sub={row.sub} cells={row.cells} />
        ))}
      </div>
      <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-1 text-[11px] sm:hidden">
        <span />
        <span className={KICKER}>9:16 video</span>
        <span className={KICKER}>4:5</span>
        <span>UGC · promoter</span>
        <Cell text="" status="approved" />
        <Cell text="—" status="na" />
        <span>Lineup edit</span>
        <Cell text="+ PSD" status="missing" />
        <Cell text="" status="approved" />
        <span>3rd · 90%</span>
        <Cell text="Proposed" status="proposed" />
        <Cell text="Proposed" status="proposed" />
        <span>3rd · final X</span>
        <Cell text="Locked" status="locked" />
        <Cell text="Locked" status="locked" />
        <span>Offer · plan</span>
        <Cell text="—" status="na" />
        <Cell text="£10 today" status="proposed" />
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground sm:hidden">swipe for 1:1 and 9:16 static →</p>
    </section>
  );
}

function RowCells({ name, sub, cells }: { name: string; sub?: string; cells: { text: string; status: CellStatus }[] }) {
  return (
    <>
      <span>
        <span className="block text-xs font-semibold">{name}</span>
        {sub ? <span className="block text-[10.5px] text-muted-foreground">{sub}</span> : null}
      </span>
      {cells.map((cell, index) => <Cell key={`${name}-${index}`} text={cell.text} status={cell.status} />)}
    </>
  );
}

function Cell({ text, status }: { text: string; status: CellStatus }) {
  const thumb = status === "made" || status === "approved";
  const cls = thumb
    ? "border-transparent text-white"
    : status === "held"
      ? "border-warning text-warning"
      : status === "proposed"
        ? "border-warning bg-warning/20 text-warning"
        : status === "locked" || status === "missing"
          ? "border-dashed border-border-strong text-muted-foreground"
          : "border-transparent text-muted-foreground opacity-50";
  return (
    <div className={`relative flex min-h-16 items-center justify-center overflow-hidden rounded border p-1 text-center ${cls}`}>
      {thumb ? <span className="absolute inset-0" style={{ background: "linear-gradient(160deg,#4a3a2a,#9a7a5a)" }} /> : null}
      {status === "approved" ? (
        <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">✓</span>
      ) : null}
      {text && text !== "—" ? <span className="relative">{text}</span> : status === "na" ? "—" : null}
    </div>
  );
}

export type LadderRow = {
  trigger: string;
  detail?: string;
  claim: string;
  note?: string;
  narrow?: boolean;
  /** Hidden below the sm breakpoint. The 393 ladder starts at sold out. */
  wide?: boolean;
  accent?: boolean;
  narrowTrigger?: string;
  narrowDetail?: string;
  narrowClaim?: string;
};

const LADDER: LadderRow[] = [
  { trigger: "Release list time passed · state on sale", detail: "from the release time, or a read / entry", claim: "\"{release} live · selling fast\"", wide: true },
  { trigger: "Selling fast for 5+ days, no count", detail: "Puzzle: 5 days (default 7)", claim: "\"{release} 90% sold out\"", wide: true },
  { trigger: "Actual 50% · 60% · 70% · 80%", detail: "when a count and a capacity exist", claim: "\"75%\" · \"80%\" · \"90% sold out\" · \"95% sold\"", wide: true },
  { trigger: "Actual 90% · or state final X · or the page shows remaining", claim: "\"99%\" or \"final X\"", note: "X from the page or the count, never typed", wide: true },
  { trigger: "State sold out", claim: "\"sold out\"" },
  {
    trigger: "2+ releases sold out · 1 on sale or selling fast",
    narrowTrigger: "2+ releases sold out · 1 on sale",
    detail: "roll-call · preferred over the % rung",
    narrowDetail: "roll-call · preferred over %",
    claim: "\"{sold-out releases} RELEASE SOLD OUT\" / \"{live release's claim}\"",
    narrowClaim: "\"EARLY BIRD, 2ND & 3RD RELEASE SOLD OUT\" /\n\"FINAL RELEASE RUNNING LOW\"",
    note: "two lines · the names from the releases, in order · line 2 is the live release's own rung",
    accent: true,
  },
  { trigger: "Sold now − sold 14 days ago ≥ 500", detail: "sales velocity · needs two counts · window and count per client", claim: "\"{n}+ TICKETS SOLD IN THE LAST 2 WEEKS\"" },
  {
    trigger: "Next release's list time within 4 days",
    detail: "price increase on a date",
    claim: "\"PRICES RISE {DAY}\"",
    note: "qualifier \"LAST CHANCE AT £{n}\" when the release has a price",
    narrowClaim: "\"PRICES RISE {DAY}\" · \"LAST CHANCE AT £{n}\"",
  },
  {
    trigger: "Days to show ≤ 14 · and the % rung's trigger met",
    narrowTrigger: "Days to show ≤ 14 · % rung met",
    claim: "\"LESS THAN 2 WEEKS TO GO\" / \"OVER 90% SOLD OUT\"",
  },
  { trigger: "A new row in the typed lineup", claim: "\"{ARTIST} (JUST ANNOUNCED)\"", note: "refreshes the lineup slot and every ALONGSIDE: list" },
];

export function ClaimLadder({ live, initial, resetTo, onReset }: { live?: boolean; initial?: LadderRow[]; resetTo?: LadderRow[]; onReset?: () => void }) {
  const seed = resetTo ?? initial ?? LADDER;
  const [rows, setRows] = useState(initial ?? seed);
  const [edit, setEdit] = useState<number | null>(null);
  return (
    <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={PANEL_TITLE}>Claim ladder</h3>
          <span className="text-[11px] text-muted-foreground">
            <span className="hidden sm:inline">what a warning may say, by what&apos;s true · Puzzle&apos;s own</span>
            <span className="sm:hidden">what a warning may say, by what&apos;s true</span>
            <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => { setRows(seed); onReset?.(); }}>
              Reset to default
            </Button>
          </span>
        </div>
        <div className="space-y-2 text-xs sm:grid sm:grid-cols-[1fr_1.5rem_1fr] sm:gap-2 sm:space-y-0">
          <div className={`${KICKER} sm:col-span-1`}>
            <span className="sm:hidden">Trigger → claim</span>
            <span className="hidden sm:inline">Trigger · what&apos;s true</span>
          </div>
          <span className="hidden sm:block" />
          <div className={`hidden sm:block ${KICKER}`}>Claim · what the asset says</div>
          {rows.map((row, index) => (
            <div key={row.trigger} className={row.wide ? "hidden sm:contents" : "flex flex-col gap-1 sm:contents"}>
              <div className={`rounded-md border border-border border-l-[3px] bg-background px-2.5 py-1.5 ${row.accent ? "border-l-destructive" : "border-l-foreground/70"}`}>
                <div>
                  <span className="sm:hidden">{row.narrowTrigger ?? row.trigger}</span>
                  <span className="hidden sm:inline">{row.trigger}</span>
                </div>
                {row.narrowDetail ? <div className="mt-0.5 text-[10.5px] text-muted-foreground sm:hidden">{row.narrowDetail}</div> : null}
                {row.detail ? <div className="mt-0.5 hidden text-[10.5px] text-muted-foreground sm:block">{row.detail}</div> : null}
              </div>
              <span className="hidden text-center text-muted-foreground sm:block">→</span>
              <button type="button" className={`rounded-md border border-border border-l-[3px] bg-background px-2.5 py-1.5 text-left ${row.accent ? "border-l-destructive" : "border-l-warning"}`} onClick={() => live && setEdit(index)}>
                {live && edit === index ? (
                  <input
                    aria-label={`Claim for ${row.trigger}`}
                    className="w-full rounded border border-border bg-card px-1"
                    defaultValue={row.claim}
                    onBlur={(event) => {
                      const claim = event.target.value;
                      setRows((current) => current.map((item, at) => (at === index ? { ...item, claim } : item)));
                      setEdit(null);
                    }}
                  />
                ) : (
                  <div className="whitespace-pre-line">
                    <span className="sm:hidden">{row.narrowClaim ?? row.claim}</span>
                    <span className="hidden sm:inline">{row.claim}</span>
                  </div>
                )}
                {row.note ? <div className="mt-0.5 hidden text-[10.5px] text-muted-foreground sm:block">{row.note}</div> : null}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">edit a cell to change Puzzle&apos;s ladder · every approved claim records which rung allowed it · offers are not rungs: see Offers</span>
          <span className="sm:hidden">tap a cell to edit · 13 rungs · offers are not rungs</span>
        </p>
      </section>
      <section className="hidden rounded-md border border-border bg-card p-4 sm:block">
        <h3 className={`mb-2 ${PANEL_TITLE}`}>How Puzzle&apos;s warnings run</h3>
        <div className="space-y-1.5 text-xs">
          <p><b>Read</b> Skiddle · Mon / Wed / Fri 09:00 <Chip tone="dash">reader to be proved</Chip></p>
          <p><b>Fallback</b> client message → Matas sets the state</p>
          <p><b>Counts</b> entered chips; velocity needs two, a window apart</p>
          <p><b>Offers</b> entered on the event, never derived — payment plan · group · early entry <Chip tone="warn">entered, not derived</Chip> on the card</p>
          <p><b>Timing</b> payday window for % and final X claims; &quot;{'{release}'} live&quot; and the roll-call at the release time; price rise from 4 days before</p>
          <p><b>Formats</b> 9:16 video · 4:5 · 1:1 — T1 / T2 per the overlay record; the roll-call in kit red over white</p>
          <p><b>Approval</b> every claim, every time</p>
        </div>
      </section>
    </div>
  );
}

const FIELD = "mt-1 w-full rounded border border-border bg-background px-2 py-1";

/** Kind, figures, condition, from / until. One action: Propose. Writes event_offers. */
export function OffersSheet({
  eventId,
  initial,
}: {
  eventId?: string;
  initial?: {
    kind?: OfferKind;
    today?: string;
    parts?: string;
    price?: string;
    arrive?: string;
    condition?: string;
    from?: string;
    until?: string;
  };
}) {
  const [kind, setKind] = useState<OfferKind>(initial?.kind ?? "payment_plan");
  const [today, setToday] = useState(initial?.today ?? "");
  const [parts, setParts] = useState(initial?.parts ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [arrive, setArrive] = useState(initial?.arrive ?? "");
  const [condition, setCondition] = useState(initial?.condition ?? "");
  const [from, setFrom] = useState(initial?.from ?? "");
  const [until, setUntil] = useState(initial?.until ?? "");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const figures: OfferFigures = kind === "payment_plan"
    ? { today: today === "" ? undefined : Number(today), parts: parts === "" ? undefined : Number(parts) }
    : kind === "early_entry"
      ? { price: price === "" ? undefined : Number(price), arrive: arrive || undefined }
      : {};
  const words = offerWords(kind, figures).card;
  const refusal = offerRefusal([condition, words, arrive].filter(Boolean).join(" "));
  const ready = kind === "group" || (kind === "payment_plan" ? today !== "" && parts !== "" : price !== "");

  async function propose(event: FormEvent) {
    event.preventDefault();
    if (refusal || !ready || !eventId) return;
    setBusy(true);
    setSaid(null);
    const res = await fetch(`/api/events/${eventId}/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        figures,
        condition,
        fromAt: from || null,
        untilAt: until || null,
      }),
    });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    setSaid(res.ok ? "Proposed." : (body.error ?? "Could not save the offer."));
  }

  return (
    <form className="w-full space-y-2 rounded-md border border-border bg-card p-4" onSubmit={propose}>
      <h3 className={PANEL_TITLE}>Offers</h3>
      <label className="block text-xs">
        Kind
        <select aria-label="Kind" className={FIELD} value={kind} onChange={(event) => setKind(event.target.value as OfferKind)}>
          <option value="payment_plan">payment plan</option>
          <option value="group">group</option>
          <option value="early_entry">early entry</option>
        </select>
      </label>
      <div className="text-xs">
        <div>Figures</div>
        {kind === "payment_plan" ? (
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label>
              Today £
              <input aria-label="Today" inputMode="decimal" className={FIELD} value={today} onChange={(event) => setToday(event.target.value)} />
            </label>
            <label>
              Parts
              <input aria-label="Parts" inputMode="numeric" className={FIELD} value={parts} onChange={(event) => setParts(event.target.value)} />
            </label>
          </div>
        ) : null}
        {kind === "group" ? <p className="mt-1 text-muted-foreground">4 for 3</p> : null}
        {kind === "early_entry" ? (
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label>
              Price £
              <input aria-label="Price" inputMode="decimal" className={FIELD} value={price} onChange={(event) => setPrice(event.target.value)} />
            </label>
            <label>
              Arrive before
              <input aria-label="Arrive before" className={FIELD} value={arrive} onChange={(event) => setArrive(event.target.value)} />
            </label>
          </div>
        ) : null}
      </div>
      <label className="block text-xs">
        Condition
        <input aria-label="Condition" className={FIELD} value={condition} onChange={(event) => setCondition(event.target.value)} />
      </label>
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <label>
          From
          <input aria-label="From" type="date" className={FIELD} value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Until
          <input aria-label="Until" type="date" className={FIELD} value={until} onChange={(event) => setUntil(event.target.value)} />
        </label>
      </div>
      {refusal ? <p className="text-xs text-destructive">{refusal}</p> : null}
      {said ? <p className="text-xs text-muted-foreground">{said}</p> : null}
      <Button type="submit" size="sm" disabled={Boolean(refusal) || !ready || busy}>
        Propose
      </Button>
    </form>
  );
}
