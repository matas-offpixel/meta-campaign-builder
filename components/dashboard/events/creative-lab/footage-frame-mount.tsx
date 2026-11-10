"use client";

import { artistHint, artistWhy, emptyFootage, needsFootageLabel, nextFootageLine, promoterHint, quotePairsLine, unpairedLine } from "@/lib/creative-lab/footage-owner";

const CLIENT = "Puzzle";
const EMPTY = emptyFootage(CLIENT, "puzzle");

function Tile({ badge, length, name, ticked, status }: { badge: string; length: string; name: string; ticked?: boolean; status?: string }) {
  return (
    <article className="w-36">
      <div className={`relative flex h-36 items-end justify-between rounded bg-muted p-1 ${ticked ? "ring-2 ring-foreground" : ""}`}>
        <span className="rounded bg-card px-1 text-xs">{badge}</span>
        <span className="text-xs tabular-nums">{ticked ? "✓ " : ""}{length}</span>
      </div>
      <p className="mt-1 text-xs">{name}</p>
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
    </article>
  );
}

function Clips() {
  return (
    <section className="space-y-4 p-4 text-sm max-[700px]:p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">Clips</h3>
        <p className="max-[700px]:hidden">21 of 26 selected · Select all · None</p>
      </div>
      <p className="text-muted-foreground">Selected clips become ads when a round pairs them with an approved caption</p>
      <p className="hidden text-xs text-muted-foreground max-[700px]:block">21 of 26 selected · Select all · None</p>
      <div>
        <p className="font-medium">{CLIENT} footage</p>
        <p className="text-muted-foreground"><span className="max-[700px]:hidden">{promoterHint(false)}</span><span className="hidden max-[700px]:inline">{promoterHint(true)}</span></p>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dashed border-border p-3 max-[700px]:flex-col max-[700px]:items-start">
          <span>{EMPTY.sentence}</span>
          <span className="rounded bg-foreground px-3 py-1.5 text-background">{EMPTY.action}</span>
          <span className="text-xs text-muted-foreground">{EMPTY.drop}</span>
        </div>
      </div>
      <div>
        <p className="font-medium">Enzo Siragusa footage</p>
        <p className="text-muted-foreground"><span className="max-[700px]:hidden">{artistHint("Enzo Siragusa", "he", false)}</span><span className="hidden max-[700px]:inline">{artistHint("Enzo Siragusa", "he", true)}</span></p>
        <div className="mt-2 flex gap-2">
          <Tile badge="IG" length="0:14" name="Enzo #1" ticked status="Untested" />
          <Tile badge="IG" length="0:22" name="Enzo #2" ticked status="Untested" />
          <div className="max-[700px]:hidden"><Tile badge="IG" length="0:18" name="Enzo #3" status="Untested" /></div>
        </div>
      </div>
      <div className="max-[700px]:hidden">
        <p className="font-medium">Luke Dean footage</p>
        <p className="text-muted-foreground">{artistHint("Luke Dean", "he", false)}</p>
        <div className="mt-2 flex gap-2">
          <Tile badge="Kit" length="0:11" name="Luke #1" ticked status="Untested" />
          <Tile badge="Kit" length="0:09" name="Luke #2" ticked status="Untested" />
          <Tile badge="IG" length="0:16" name="Luke #21" ticked status="Untested" />
        </div>
      </div>
    </section>
  );
}

function Captions() {
  return (
    <section className="space-y-3 p-4 text-sm max-[700px]:p-3">
      <h3 className="font-medium">Captions</h3>
      <p className="text-muted-foreground">✓ a caption, then Propose round 1 renders it on the selected clips</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-muted-foreground max-[700px]:hidden">Mode</span>
        <span className="rounded bg-foreground px-2 py-1 text-background">Caption</span>
        <span className="rounded border border-border px-2 py-1">Quote</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-muted-foreground max-[700px]:hidden">Angle</span>
        <span className="rounded border border-border px-2 py-1">Lineup</span>
        <span className="rounded bg-foreground px-2 py-1 text-background">Artist</span>
        <span className="rounded border border-border px-2 py-1">POV</span>
        <span className="rounded border border-border px-2 py-1">Scarcity</span>
        <span className="w-20 text-muted-foreground max-[700px]:hidden">Artist</span>
        <span className="rounded border border-border px-2 py-1 max-[700px]:hidden">Luke Dean ▾</span>
      </div>
      <p className="text-muted-foreground"><span className="max-[700px]:hidden">Sounds like @puzzle · </span>{artistWhy("Luke Dean", CLIENT)}</p>
      <div className="flex gap-3 max-[700px]:block">
        <article className="w-72 max-[700px]:hidden">
          <p>Luke Dean set to bring this energy to Circuit to close out the year</p>
          <p className="mt-1 font-medium">Artist · Luke #1</p>
          <p className="text-xs text-muted-foreground">third person · Puzzle&apos;s voice</p>
        </article>
        <article className="w-72">
          <p className="rounded border border-dashed border-border px-3 py-6 text-center text-muted-foreground">{needsFootageLabel(CLIENT)}</p>
          <p className="mt-1 font-medium">Lineup · unpaired</p>
          <p className="text-xs text-muted-foreground">{unpairedLine("Lineup", CLIENT)}</p>
        </article>
        <article className="w-72 max-[700px]:hidden">
          <p>Back in Southampton for this one…</p>
          <p className="mt-1 font-medium">quote · Luke #2</p>
          <p className="text-xs text-muted-foreground">{quotePairsLine("Luke Dean", CLIENT, "him", 0)} · <span className="text-success">✓ Cleared — artist channels too</span></p>
        </article>
      </div>
    </section>
  );
}

function Strip() {
  return (
    <section className="p-4 text-sm max-[700px]:p-3">
      <p className="flex items-center justify-between gap-3 max-[700px]:flex-col max-[700px]:items-start">
        <span><b>Next:</b> {nextFootageLine(CLIENT, 20)}</span>
        <span className="rounded bg-foreground px-3 py-1.5 text-background">{EMPTY.action}</span>
      </p>
    </section>
  );
}

export function FootageFrameMount({ id }: { id: string }) {
  return (
    <div data-frame-ready={id} className="bg-background text-foreground">
      {id === "CLW1" ? <Clips /> : null}
      {id === "CLW2" ? <Captions /> : null}
      {id === "CLW3" ? <Strip /> : null}
    </div>
  );
}
