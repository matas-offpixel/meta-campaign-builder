"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { isInPaydayWindow } from "@/lib/dashboard/pacing";
import { paydayPush } from "@/lib/releases/windows";
import { RELEASE_STATES, type ReleaseState } from "@/lib/releases/types";

const FULL = ["not yet", "on sale", "selling fast", "final X", "sold out"];
const SHORT = ["not yet", "on sale", "fast", "final", "out"];

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
  rungs: RungMark[];
  narrowRungs?: RungMark[];
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
}) {
  const [ask, setAsk] = useState<string | null>(null);
  const [counting, setCounting] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="font-heading text-sm tracking-wide">
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
            <div className="relative h-40 min-w-[760px] sm:min-w-0">
              <div className="absolute left-0 right-0 top-[52px] h-px bg-border" />
              {rows.map((row) => (
                <div key={row.id} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: row.left }}>
                  <div className="max-w-[140px] text-[11px] leading-tight">
                    <span className="hidden sm:inline">{row.timelineLabel}</span>
                    <span className="sm:hidden">{row.shortTimeline}</span>
                  </div>
                  <div className="mx-auto mt-1 h-2.5 w-2.5 rounded-full bg-foreground" />
                  <div className="mt-3 flex justify-center gap-1 text-[10px]">
                    {(row.narrowRungs ?? row.rungs).map((rung, index) => (
                      <span key={rung.text} className="hidden sm:contents">
                        {index > 0 ? <span className="text-muted-foreground">→</span> : null}
                        <RungPill rung={rung} />
                      </span>
                    ))}
                    {(row.narrowRungs ?? row.rungs).map((rung, index) => (
                      <span key={`${rung.short}-${index}`} className="sm:hidden">
                        {index > 0 ? <span className="text-muted-foreground">→</span> : null}
                        <RungPill rung={{ ...rung, text: rung.short }} />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="absolute top-0 -translate-x-1/2 text-center text-warning" style={{ left: "66%" }}>
                <div className="text-[11px]">
                  <span className="hidden sm:inline">{todayLabel}</span>
                  <span className="sm:hidden">{todayShort}</span>
                </div>
                <div className="mx-auto mt-1 h-4 w-0.5 rounded bg-warning" />
              </div>
              <div className="absolute top-0 -translate-x-1/2 text-center" style={{ left: "86%" }}>
                <div className="text-[11px]">
                  <span className="hidden sm:inline">Payday · Fri 27 Nov</span>
                  <span className="sm:hidden">Payday 27 Nov</span>
                </div>
                <div className="mx-auto mt-1 h-2.5 w-2.5 rounded-full border-2 border-foreground bg-transparent" />
              </div>
              <div className="absolute top-0 hidden -translate-x-1/2 text-center sm:block" style={{ left: "98%" }}>
                <div className="text-[11px] text-destructive">Show · 27 Dec</div>
                <div className="mx-auto mt-1 h-2.5 w-2.5 rounded-full bg-destructive" />
              </div>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground sm:hidden">scrolls sideways →</p>
        </div>
        <p className="sr-only">{kicker}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-[1.7fr_1fr]">
        <section className="rounded-md border border-border bg-card p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="font-heading text-sm tracking-wide">Where each release is</h3>
            <p>
              <span className="font-heading text-2xl">{headline}</span>{" "}
              <span className="text-xs text-muted-foreground">
                <span className="sm:hidden">{narrowRest}</span>
                <span className="hidden sm:inline">{headlineRest}</span>
              </span>
            </p>
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
                <div className="flex flex-wrap gap-1">
                  {RELEASE_STATES.map((state, index) => {
                    const on = state === row.state;
                    const past = RELEASE_STATES.indexOf(state) < RELEASE_STATES.indexOf(row.state);
                    return (
                      <button
                        key={state}
                        type="button"
                        className={`rounded px-1.5 py-0.5 text-[11px] ${on ? "bg-foreground text-background" : past ? "text-success" : "text-muted-foreground"}`}
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
                  <b>{FULL[RELEASE_STATES.indexOf(row.state)]}</b>
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
          <p className="mt-3 text-[11px] text-muted-foreground">
            <span className="sm:hidden">{narrowFootnote ?? footnote}</span>
            <span className="hidden sm:inline">{footnote}</span>
          </p>
        </section>
        <section className="hidden rounded-md border border-border bg-card p-4 sm:block">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-heading text-sm tracking-wide">Claims</h3>
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
        </section>
      </div>
    </div>
  );
}

function RungPill({ rung }: { rung: RungMark }) {
  const cls =
    rung.status === "done"
      ? "rounded bg-success px-1 text-white"
      : rung.status === "next"
        ? "rounded border border-warning px-1 text-warning"
        : "rounded border border-dashed border-border px-1 text-muted-foreground";
  return <span className={cls}>{rung.text}</span>;
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

const CALENDAR: { ymd: string; day: string; lines?: string[]; kind?: "ticket" | "content" | "payday" | "show" }[] = [
  { ymd: "2026-11-23", day: "23" },
  { ymd: "2026-11-24", day: "24" },
  { ymd: "2026-11-25", day: "25" },
  { ymd: "2026-11-26", day: "26" },
  { ymd: "2026-11-27", day: "27", lines: ["Payday", "Payday push · 3rd release 90% sold out"], kind: "payday" },
  { ymd: "2026-11-28", day: "28", lines: ["3rd release 90% sold out"], kind: "ticket" },
  { ymd: "2026-11-29", day: "29" },
  { ymd: "2026-11-30", day: "30" },
  { ymd: "2026-12-01", day: "1 Dec", lines: ["3rd release live 12:00"], kind: "ticket" },
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
  { ymd: "2026-12-15", day: "15", lines: ["Artist cards"], kind: "content" },
  { ymd: "2026-12-16", day: "16", lines: ["UGC · Enzo"], kind: "content" },
  { ymd: "2026-12-17", day: "17", lines: ["Experience"], kind: "content" },
  { ymd: "2026-12-18", day: "18" },
  { ymd: "2026-12-19", day: "19" },
  { ymd: "2026-12-20", day: "20" },
  { ymd: "2026-12-21", day: "21" },
  { ymd: "2026-12-22", day: "22", lines: ["Final X · 3rd release · if triggered"], kind: "ticket" },
  { ymd: "2026-12-23", day: "23" },
  { ymd: "2026-12-24", day: "24", lines: ["Payday push", "moved · 25th is Christmas"], kind: "payday" },
  { ymd: "2026-12-25", day: "25", lines: ["Payday · Christmas Day"] },
  { ymd: "2026-12-26", day: "26" },
  { ymd: "2026-12-27", day: "27", lines: ["Show"], kind: "show" },
];

export function PaydayCalendar() {
  const moved = paydayPush(2026, 12);
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 hidden items-baseline justify-between gap-2 sm:flex">
        <h3 className="font-heading text-sm tracking-wide">Pushes · 23 Nov – 27 Dec</h3>
        <p className="text-[11px] text-muted-foreground">ticket warning · content · payday · payday window</p>
      </div>
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-1 text-[11px]">
          {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
            <div key={day} className="text-muted-foreground">{day}</div>
          ))}
          {CALENDAR.map((cell) => {
            const win = isInPaydayWindow(cell.ymd);
            const reason = cell.ymd === moved.day ? moved.reason : null;
            return (
              <div key={cell.ymd} className={`min-h-16 rounded p-1 ${cell.kind === "show" ? "bg-foreground text-background" : win ? "bg-muted" : ""} ${cell.ymd === "2026-12-25" ? "opacity-60" : ""}`}>
                <div>{cell.day}</div>
                {cell.lines?.map((line) => <div key={line}>{line === "moved · 25th is Christmas" && reason ? reason : line}</div>)}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The window is the code&apos;s 18 days: Thursday 26 Nov to Sunday 13 Dec. Ticket warnings sit inside it; content-led pushes sit outside it. A live claim runs at its release time regardless. December&apos;s payday falls on Christmas Day, so the push moves to Thursday 24 and the day says why.
        </p>
      </div>
      <div className="space-y-3 text-xs sm:hidden">
        <p className="text-muted-foreground">Week of 23 Nov · payday window opens Thu</p>
        <p className="font-medium">Fri 27 · Payday push + 3rd release 90% sold out</p>
        <p>Tue 1 Dec · 3rd release live 12:00</p>
        <p className="text-muted-foreground">Week of 14 Dec · mid-month</p>
        <p>Tue 15 · Artist cards</p>
        <p>Wed 16 · UGC · Enzo</p>
        <p className="text-muted-foreground">Week of 21 Dec · show week</p>
        <p>Tue 22 · Final X · 3rd release · if triggered</p>
        <p className="font-medium">Thu 24 · Payday push (moved from Christmas Day)</p>
      </div>
    </section>
  );
}

const BOARD: { row: string; cells: { text: string; status: "approved" | "proposed" | "locked" | "missing" | "na" | "held" }[] }[] = [
  { row: "Headliner UGC · promoter voice", cells: [{ text: "Enzo #2", status: "approved" }, { text: "—", status: "na" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { row: "Headliner UGC · artist voice", cells: [{ text: "Held · Luke Dean not cleared", status: "held" }, { text: "—", status: "na" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { row: "Artist card", cells: [{ text: "+ audio 15 s", status: "held" }, { text: "", status: "approved" }, { text: "", status: "approved" }, { text: "+ needs Reeshy's press shot", status: "missing" }] },
  { row: "Lineup artwork edit", cells: [{ text: "+ needs the PSD", status: "missing" }, { text: "", status: "approved" }, { text: "", status: "approved" }, { text: "", status: "held" }] },
  { row: "2nd release", cells: [{ text: "90% sold out", status: "approved" }, { text: "90% sold out", status: "approved" }, { text: "live", status: "approved" }, { text: "—", status: "na" }] },
  { row: "3rd release · 90% sold out", cells: [{ text: "Proposed · approve", status: "proposed" }, { text: "Proposed · approve", status: "proposed" }, { text: "+ needs the PSD", status: "missing" }, { text: "—", status: "na" }] },
  { row: "3rd release · final X", cells: [{ text: "Locked · day 1", status: "locked" }, { text: "Locked", status: "locked" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { row: "General sale · 90%", cells: [{ text: "Locked · on sale, not fast", status: "locked" }, { text: "—", status: "na" }, { text: "—", status: "na" }, { text: "—", status: "na" }] },
  { row: "Client promo / experience", cells: [{ text: "Venue walk-through", status: "approved" }, { text: "", status: "approved" }, { text: "+ needs client's edit", status: "missing" }, { text: "—", status: "na" }] },
];

export function AssetBoard() {
  const [said, setSaid] = useState<string | null>(null);
  const heads = ["9:16 video", "4:5 static", "1:1 static", "9:16 static"];
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm tracking-wide">Asset bank</h3>
        <p className="text-xs">
          <span className="hidden sm:inline">15 approved · 1 proposed · 3 locked · 5 missing</span>
          <span className="sm:hidden">15 ✓ · 1 proposed · 3 locked · 5 missing</span>
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
        {heads.map((head) => <span key={head} className="text-muted-foreground">{head}</span>)}
        {BOARD.map((row) => (
          <RowCells key={row.row} row={row.row} cells={row.cells} />
        ))}
      </div>
      <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-1 text-[11px] sm:hidden">
        <span />
        <span className="text-muted-foreground">9:16 video</span>
        <span className="text-muted-foreground">4:5</span>
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
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground sm:hidden">swipe for 1:1 and 9:16 static →</p>
    </section>
  );
}

function RowCells({ row, cells }: { row: string; cells: { text: string; status: "approved" | "proposed" | "locked" | "missing" | "na" | "held" }[] }) {
  return (
    <>
      <span>{row}</span>
      {cells.map((cell, index) => <Cell key={`${row}-${index}`} text={cell.text} status={cell.status} />)}
    </>
  );
}

function Cell({ text, status }: { text: string; status: "approved" | "proposed" | "locked" | "missing" | "na" | "held" }) {
  const cls =
    status === "approved"
      ? "border-success"
      : status === "proposed"
        ? "border-warning text-warning"
        : status === "locked"
          ? "border-dashed text-muted-foreground"
          : status === "missing"
            ? "border-dashed text-muted-foreground"
            : "text-muted-foreground";
  return <div className={`min-h-10 rounded border border-border p-1 ${cls}`}>{text || (status === "na" ? "—" : "")}</div>;
}

export type LadderRow = { trigger: string; detail?: string; claim: string; note?: string; narrow?: boolean };

const LADDER: LadderRow[] = [
  { trigger: "Release list time passed · state on sale", detail: "from the release time, or a read / entry", claim: "{release} live · selling fast", narrow: true },
  { trigger: "Selling fast for 5+ days, no count", detail: "Puzzle: 5 days (default 7)", claim: "{release} 90% sold out", note: "Puzzle prefers the % line; \"final X\" is the other option", narrow: true },
  { trigger: "Actual 50% sold", detail: "when a count and a capacity exist", claim: "\"75% sold\"" },
  { trigger: "Actual 60%", claim: "\"80% sold\"" },
  { trigger: "Actual 70%", claim: "\"90% sold out\"", narrow: true },
  { trigger: "Actual 80%", claim: "\"95% sold\"" },
  { trigger: "Actual 90% · or state final X · or the page shows remaining", claim: "\"99%\" or \"final X\"", note: "X = the remaining figure from the page or the count, never typed", narrow: true },
  { trigger: "State sold out", claim: "\"sold out\"" },
];

export function ClaimLadder({ live, initial, resetTo, onReset }: { live?: boolean; initial?: LadderRow[]; resetTo?: LadderRow[]; onReset?: () => void }) {
  const seed = resetTo ?? initial ?? LADDER;
  const [rows, setRows] = useState(initial ?? seed);
  const [edit, setEdit] = useState<number | null>(null);
  return (
    <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-sm tracking-wide">Claim ladder</h3>
          <span className="text-[11px] text-muted-foreground">
            what a warning may say, by what&apos;s true
            <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => { setRows(seed); onReset?.(); }}>
              Reset to default
            </Button>
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 gap-y-2 text-xs">
          <div className="text-muted-foreground">Trigger · what&apos;s true</div>
          <span />
          <div className="hidden text-muted-foreground sm:block">Claim · what the asset says</div>
          {rows.map((row, index) => (
            <div key={row.trigger} className={row.narrow ? "contents" : "hidden sm:contents"}>
              <div>
                <div>{row.trigger}</div>
                {row.detail ? <div className="hidden text-[11px] text-muted-foreground sm:block">{row.detail}</div> : null}
                {live && edit === index ? (
                  <input
                    aria-label={`Claim for ${row.trigger}`}
                    className="mt-1 w-full rounded border border-border bg-background px-1"
                    defaultValue={row.claim}
                    onBlur={(event) => {
                      const claim = event.target.value;
                      setRows((current) => current.map((item, at) => (at === index ? { ...item, claim } : item)));
                      setEdit(null);
                    }}
                  />
                ) : null}
              </div>
              <span className="hidden sm:inline">→</span>
              <button type="button" className="text-left" onClick={() => live && setEdit(index)}>
                <div>{row.claim}</div>
                {row.note ? <div className="hidden text-[11px] text-muted-foreground sm:block">{row.note}</div> : null}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">edit a cell to change the ladder · every approved claim records which rung allowed it</span>
          <span className="sm:hidden">tap a cell to edit · 4 of 8 rungs shown</span>
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Roll-call, when two releases are sold out and one is on sale: the sold-out names, then the live claim. Preferred when that is true. Not an extra rung on this table.
        </p>
      </section>
      <section className="hidden rounded-md border border-border bg-card p-4 sm:block">
        <h3 className="mb-2 font-heading text-sm tracking-wide">How Puzzle&apos;s warnings run</h3>
        <div className="space-y-1.5 text-xs">
          <p><b>Read</b> Skiddle · Mon / Wed / Fri 09:00 <Chip tone="dash">reader to be proved</Chip></p>
          <p><b>Fallback</b> client message → Matas sets the state</p>
          <p><b>Timing</b> payday window for % and final X claims; &quot;{'{release}'} live&quot; at the release time</p>
          <p><b>Formats</b> 9:16 video · 4:5 · 1:1. The piece is not in yet.</p>
          <p><b>Approval</b> every claim, every time</p>
        </div>
      </section>
    </div>
  );
}
