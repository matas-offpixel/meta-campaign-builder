"use client";

import { useState } from "react";

import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { postedLabel } from "@/lib/creative-lab/posted-label";
import { quotePronoun } from "@/lib/creative-lab/quote";
import type { CardVoicePage } from "@/lib/creative-lab/voice-store";
import { VOICE_REFRESH_DAYS } from "@/lib/creative-lab/voice-store";
import { traitRows, voiceChipParts, VOICE_FLOOR, NO_POSTS_READ } from "@/lib/creative-lab/voice-traits";
import { styleLabel } from "@/lib/creative-lab/surface";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

const LONDON = "Europe/London";

function londonDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function clock(iso: string | null, now: string): { day: string; time: string; stale: boolean } | null {
  if (!iso) return null;
  const when = new Date(iso);
  const today = new Date(now);
  if (Number.isNaN(when.getTime())) return null;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: LONDON }).format(when);
  const same = londonDay(when) === londonDay(today);
  const stale = today.getTime() - when.getTime() > VOICE_REFRESH_DAYS * 86_400_000;
  return { day: same ? "today" : postedLabel(iso), time, stale };
}

export function VoicePanel({
  lab,
  angle,
  artistId,
  busy,
  onSave,
  initialOpen = false,
  contained = false,
  onOpenChange,
}: {
  lab: CreativeLabCardData;
  angle: string;
  artistId: string;
  busy: boolean;
  onSave: Save;
  initialOpen?: boolean;
  /** The frame keeps the sheet inside the shot. The event page uses a fixed sheet. */
  contained?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  function setVoiceOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }
  const artist = lab.artists.find((item) => item.id === artistId) ?? lab.artists[0] ?? null;
  const voiceArtist = lab.voice?.artists.find((item) => item.id === artistId) ?? lab.voice?.artists[0] ?? null;
  const artistPage = angle === "artist_first_person";
  const page: CardVoicePage | null = artistPage ? voiceArtist : lab.voice?.promoter ?? null;
  const handle = page?.handle ?? null;
  const sampleN = page?.sampleN ?? 0;
  const error = page?.error ?? null;
  const parts = voiceChipParts({ handle, sampleN, error, artistPage });
  const when = clock(page?.fetchedAt ?? null, lab.now);
  const ready = !parts.house;
  const traits = page?.traits ? traitRows(page.traits, "wide") : [];
  const narrowTraits = page?.traits ? traitRows(page.traits, "narrow") : [];
  const exemplars = page?.exemplars ?? [];
  const shown = exemplars.slice(0, 4);
  const read = when ? (when.day === "today" ? `${when.day} ${when.time}` : when.day) : "";
  const angleName = styleLabel(angle);
  const pronouns = quotePronoun(artist?.pronouns);
  const whyWide = whyLine({ artistPage, clientName: lab.clientName || "the promoter", handle, sampleN, error, read, angleName, artistName: artist?.name ?? "this artist", stale: when?.stale === true, pronouns });
  const whyNarrow = artistPage ? whyWide : ready ? `Promoter voice · read ${read}` : whyWide;
  const header = ready && handle ? `Sounds like @${handle}` : "House voice";
  const unread = `@${handle ?? "the page"} · not read yet`;
  const subWide = sampleN > 0
    ? `${sampleN} POSTS READ · ${read.toUpperCase()} · AGAIN ON FIND CLIPS AND NIGHTLY`
    : unread;
  const subNarrow = sampleN > 0
    ? `${sampleN} POSTS · ${read.toUpperCase()} · FIND CLIPS AND NIGHTLY`
    : unread;
  const restWide = Math.max(0, exemplars.length - 4);
  const restNarrow = Math.max(0, exemplars.length - 2);

  function readAgain() {
    void onSave({
      action: "readVoice",
      pageKind: artistPage ? "artist" : "promoter",
      artistId: artistPage ? artistId : undefined,
    });
  }

  const sheet = open ? (
    <>
    {contained ? <div className="pointer-events-none absolute inset-0 z-10 hidden bg-foreground/35 max-[700px]:block" /> : null}
    <aside
      className={
        contained
          ? "absolute top-0 right-0 z-20 flex h-full w-[440px] flex-col border-l border-border-strong bg-card text-[12.5px] shadow-md max-[700px]:inset-x-0 max-[700px]:top-auto max-[700px]:bottom-0 max-[700px]:h-[88%] max-[700px]:w-auto max-[700px]:rounded-t-[14px] max-[700px]:border-l-0"
          : "fixed top-0 right-0 z-40 flex h-full w-[440px] flex-col border-l border-border-strong bg-card text-[12.5px] shadow-md max-[700px]:inset-x-0 max-[700px]:top-auto max-[700px]:bottom-0 max-[700px]:h-[88%] max-[700px]:w-auto max-[700px]:rounded-t-[14px] max-[700px]:border-l-0"
      }
    >
      <div className="mx-auto mt-2 hidden h-1 w-[38px] rounded-full bg-border-strong max-[700px]:block" />
      <div className="border-b border-border px-4 pt-3.5 pb-2.5">
        <div className="flex items-center justify-between">
          <b className="text-sm">{header}</b>
          <button type="button" className="text-muted-foreground" onClick={() => setVoiceOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className={`mt-1 font-mono text-[10.5px] tracking-wide text-muted-foreground ${sampleN > 0 ? "uppercase" : ""}`}>
          <span className="max-[700px]:hidden">{subWide}</span>
          <span className="hidden max-[700px]:inline">{subNarrow}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-1.5 pb-4">
        {traits.length ? (
          <>
            <div className="border-b border-border py-2.5">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">Traits the writer took</span>
                <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">of {sampleN}</span>
              </div>
              <TraitList rows={traits} wide />
              <div className="hidden max-[700px]:block"><TraitList rows={narrowTraits} /></div>
            </div>
            <div className="border-b border-border py-2.5">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
                  <span className="max-[700px]:hidden">Exemplars · newest first</span>
                  <span className="hidden max-[700px]:inline">Exemplars</span>
                </span>
                <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">verbatim</span>
              </div>
              {shown.map((sample, index) => (
                <p key={sample.permalink ?? `${index}`} className={`my-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-xs leading-snug whitespace-pre-line ${index > 1 ? "max-[700px]:hidden" : ""}`}>
                  {sample.caption}
                  <span className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground whitespace-normal">
                    <span>{postedLabel(sample.postedAt)}</span>
                    <span className="ml-auto">♥ {sample.likes ?? 0}</span>
                    {sample.permalink ? (
                      <a className="inline-flex h-[18px] w-[18px] items-center justify-center rounded border border-border-strong text-[10px]" href={sample.permalink} target="_blank" rel="noreferrer" aria-label="Open the post">↗</a>
                    ) : (
                      <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded border border-border-strong text-[10px]" aria-hidden>↗</span>
                    )}
                  </span>
                </p>
              ))}
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                <span className="max-[700px]:hidden">{restWide > 0 ? `+ ${restWide} more · ` : ""}Exemplars set the tone. No line is reused.</span>
                <span className="hidden max-[700px]:inline">{restNarrow > 0 ? `+ ${restNarrow} more · ` : ""}No line is reused.</span>
              </p>
            </div>
          </>
        ) : (
          <div className="py-2.5">
            <p className="rounded-md bg-muted px-3 py-2.5 text-xs text-foreground">
              {sampleN > 0 && sampleN < VOICE_FLOOR
                ? `@${handle} has ${sampleN} posts, fewer than ${VOICE_FLOOR}. The writer uses the house voice until there are more.`
                : error
                  ? artistPage
                    ? `@${handle} can't be read: ${error}. Artist-voice captions use the house voice until it is.`
                    : `@${handle} can't be read: ${error}. Captions use the house voice until it is.`
                  : `${NO_POSTS_READ} Until then the writer uses the house voice: the style's seed examples and the event's facts.`}
            </p>
          </div>
        )}
        <div className={`mt-2 flex items-center gap-2 ${sampleN > 0 ? "justify-end" : ""}`}>
          <button type="button" className="h-6 shrink-0 whitespace-nowrap rounded-md border border-border-strong px-2 text-[11.5px] font-semibold max-[700px]:w-full" disabled={busy} onClick={readAgain}>
            {sampleN > 0 ? "Read again" : "Find clips"}
          </button>
          {sampleN === 0 ? <span className="text-[11.5px] text-muted-foreground max-[700px]:hidden">reads the page&apos;s reels and its last 30 captions in one call</span> : null}
        </div>
      </div>
    </aside>
    </>
  ) : null;

  return (
    <div className={contained && open ? "contents" : "space-y-2"}>
      <div className={`relative z-[15] mt-2.5 flex flex-wrap items-center ${contained && open ? "gap-x-2.5 gap-y-[13px] max-[700px]:gap-2.5" : "gap-2.5"}`}>
        <button
          type="button"
          className={`inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-semibold max-[700px]:w-full ${parts.house ? "border-dashed text-muted-foreground" : "border-border-strong text-foreground"} ${open ? "border-foreground" : ""}`}
          onClick={() => setVoiceOpen(!open)}
        >
          <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${parts.cant ? "bg-warning" : parts.house ? "bg-muted-foreground" : "bg-platform-ig"}`} />
          {parts.name}
          <span className="font-mono text-[10.5px] text-muted-foreground max-[700px]:hidden">{parts.count}</span>
          <span className="ml-auto hidden font-mono text-[10.5px] text-muted-foreground max-[700px]:inline">{parts.countNarrow}</span>
          <span className="text-muted-foreground" aria-hidden>{open ? "‹" : "›"}</span>
        </button>
        <p className={`text-[11.5px] text-muted-foreground max-[700px]:hidden ${contained && open ? "leading-none" : ""}`}>{whyWide}</p>
      </div>
      <p className={`relative z-[15] mt-1.5 hidden text-[11.5px] text-muted-foreground max-[700px]:block ${contained && open ? "leading-none" : ""}`}>{whyNarrow}</p>
      {sheet}
    </div>
  );
}

function TraitList({ rows, wide = false }: { rows: ReturnType<typeof traitRows>; wide?: boolean }) {
  return (
    <div className={wide ? "max-[700px]:hidden" : ""}>
      {rows.map((row) => (
        <div key={`${wide ? "w" : "n"}-${row.label}`} className={`grid items-center gap-x-2.5 py-1 text-xs ${wide ? "grid-cols-[92px_1fr_64px]" : "grid-cols-[78px_1fr_56px]"} ${row.off ? "text-muted-foreground" : ""}`}>
          <span className={`text-[11.5px] font-semibold ${row.off ? "text-muted-foreground" : "text-foreground"}`}>{row.label}</span>
          <span>
            {row.value}
            {row.hint ? <small className="text-[11px] text-muted-foreground"> {row.hint}</small> : null}
            {row.note ? <s className="text-[11px] text-warning-foreground no-underline"> {row.note}</s> : null}
          </span>
          <span className="text-right font-mono text-[10.5px] text-muted-foreground whitespace-nowrap">
            {row.evidence}
            <span className="mt-0.5 block h-[3px] rounded-sm bg-muted" aria-hidden>
              <span className="block h-full rounded-sm bg-muted-foreground" style={{ width: `${row.bar}%` }} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function whyLine(args: {
  artistPage: boolean;
  clientName: string;
  handle: string | null;
  sampleN: number;
  error: string | null;
  read: string;
  angleName: string;
  artistName: string;
  stale: boolean;
  pronouns: { subject: string; possessive: string };
}): string {
  const possessive = args.pronouns.possessive;
  if (args.artistPage && !args.handle) return `Add Instagram on ${args.artistName}'s row — the same action the row already has.`;
  if (!args.artistPage && !args.handle) return `Add ${args.clientName}'s Instagram — the writer uses the house voice until then.`;
  if (args.error && args.sampleN < VOICE_FLOOR) {
    const house = args.artistPage ? "Artist-voice captions use the house voice until it is." : "Captions use the house voice until it is.";
    return `@${args.handle} can't be read: ${args.error}. ${house}`;
  }
  if (args.sampleN > 0 && args.sampleN < VOICE_FLOOR) {
    return `@${args.handle} has ${args.sampleN} posts, fewer than ${VOICE_FLOOR}. The writer uses the house voice until there are more.`;
  }
  if (args.sampleN >= VOICE_FLOOR && args.handle) {
    if (args.stale) return `Read ${args.read} · the nightly pass has not reached it since. The corpus still counts; the sheet says when it was read.`;
    if (args.artistPage) return `Artist voice · ${possessive} own posts, not the promoter's · read ${args.read} with Find clips`;
    return `Promoter voice · every angle · read ${args.read} · shape from ${args.angleName} · facts from the event`;
  }
  return NO_POSTS_READ;
}
