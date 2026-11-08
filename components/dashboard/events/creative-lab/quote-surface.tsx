"use client";

import type { QuoteSource } from "@/lib/creative-lab/quote";
import type { QuoteWeight } from "../../../../src/remotion/caption-style/quote-profile";

const IG = "#B0607A";
const META = "#5B7FA6";

export function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange?: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="inline-flex w-fit overflow-hidden rounded-md border border-border">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            className={`px-2.5 py-1 text-sm ${option.id === value ? "bg-foreground text-background" : "bg-card text-foreground"}`}
            onClick={() => onChange?.(option.id)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </div>
  );
}

export function QuoteGenerator({
  mode,
  onMode,
  artistLabel,
  showArtistChip,
  source,
  onSource,
  words,
  onWords,
  chip,
  chipNarrow,
  picked,
  lineLabel,
  pairNote,
  onUse,
  refusal,
  where,
  onWhere,
}: {
  mode: "caption" | "quote";
  onMode?: (mode: "caption" | "quote") => void;
  artistLabel: string;
  showArtistChip: boolean;
  source: QuoteSource;
  onSource?: (source: QuoteSource) => void;
  words: string;
  onWords?: (words: string) => void;
  chip: string;
  chipNarrow?: string;
  picked: string | null;
  lineLabel: string;
  pairNote: string;
  onUse?: () => void;
  refusal?: string | null;
  where?: string;
  onWhere?: (where: string) => void;
}) {
  const sources = [
    { id: "press_kit", label: "Press kit" },
    { id: "post", label: "A post" },
    { id: "typed", label: "Typed" },
  ];
  return (
    <div className="space-y-3 rounded border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Seg label="Mode" value={mode} options={[{ id: "caption", label: "Caption" }, { id: "quote", label: "Quote" }]} onChange={(id) => onMode?.(id as "caption" | "quote")} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Artist</span>
          <span className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1 text-sm">
            <span className="truncate">{artistLabel}</span>
            {showArtistChip ? <span className="hidden shrink-0 rounded border border-success px-1.5 text-[10px] text-success sm:inline">✓ artist channels</span> : null}
          </span>
        </div>
        <div className="hidden sm:block">
          <Seg label="Source" value={source} options={sources} onChange={(id) => onSource?.(id as QuoteSource)} />
        </div>
        <span className="mb-1 ml-auto hidden rounded border border-border px-2 py-1 text-sm sm:inline">More ▾</span>
      </div>
      <div className="sm:hidden">
        <Seg label="Source" value={source} options={sources} onChange={(id) => onSource?.(id as QuoteSource)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_280px]">
        <div className="rounded border border-border bg-background p-3 text-sm">
          {onWords ? (
            <textarea className="w-full resize-none bg-transparent outline-none" rows={4} value={words} onChange={(event) => onWords(event.target.value)} />
          ) : (
            <p>{words}</p>
          )}
          {source === "typed" ? (
            <label className="mt-2 block text-xs text-muted-foreground">
              Where
              <input className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-sm text-foreground" value={where ?? ""} onChange={(event) => onWhere?.(event.target.value)} />
            </label>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden rounded border border-border px-1.5 py-0.5 text-foreground sm:inline"><span style={{ color: IG }}>●</span> {chip.replace(/^●\s*/, "")}</span>
            <span className="rounded border border-border px-1.5 py-0.5 text-foreground sm:hidden"><span style={{ color: IG }}>●</span> {(chipNarrow ?? chip).replace(/^●\s*/, "")}</span>
            {picked ? <span className="hidden sm:inline">{picked}</span> : null}
            <span>{lineLabel}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded bg-foreground px-3 py-2 text-sm text-background sm:w-auto" onClick={onUse}>Use these words</button>
            <span className="rounded border border-border px-2 py-1 text-sm sm:hidden">More ▾</span>
          </div>
          <p className="mt-2 hidden text-xs text-muted-foreground sm:block">{pairNote}</p>
          {refusal ? <p className="mt-2 text-sm">{refusal}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Plate({
  words,
  time,
  crop,
  weight = 700,
  marker,
  muted = false,
}: {
  words: string;
  time: string;
  crop: boolean;
  weight?: QuoteWeight;
  marker?: { at: string; label: string } | null;
  muted?: boolean;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden bg-black ${crop ? "aspect-[4/5]" : "aspect-[9/16]"}`}
      style={{ containerType: "size" }}
    >
      <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#2a241c,#6a5a48)", filter: muted ? "saturate(.6)" : undefined }} />
      {!crop && marker ? (
        <>
          <div className="pointer-events-none absolute inset-x-[8%] border border-dashed border-white/80" style={{ top: "14.58%", bottom: "14.59%" }}>
            <i className="absolute right-1 top-0 text-[8px] not-italic text-white">4:5 rect · 14.58 %</i>
          </div>
          <div className="pointer-events-none absolute inset-x-0 border-t" style={{ top: marker.at, borderColor: "#ffd34a" }}>
            <i className="absolute right-1 -top-3 bg-black/60 px-1 text-[8px] not-italic" style={{ color: "#ffd34a" }}>{marker.label}</i>
          </div>
        </>
      ) : null}
      <p
        className="pointer-events-none absolute left-1/2 w-[70%] -translate-x-1/2 -translate-y-1/2 text-center whitespace-pre-line text-white"
        style={{
          top: crop ? "18.7%" : "28%",
          fontWeight: weight,
          fontSize: crop ? "2.745cqh" : "1.93cqh",
          lineHeight: crop ? "4.267cqh" : "3cqh",
        }}
      >
        {words}
      </p>
      <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 text-white">
        <span className="text-xs">▶</span>
        <span className="h-0.5 flex-1 bg-white/80" />
        <span className="text-[10px]">{time}</span>
      </div>
    </div>
  );
}

export function QuotePost({
  page,
  copy,
  words,
  time,
  headline,
  sub,
  cta,
  chips,
  held,
  muted = false,
  copyOnNarrow = true,
}: {
  page: string;
  copy: string | null;
  words: string;
  time: string;
  headline: string;
  sub: string;
  cta: string;
  chips: { text: string; ok?: boolean; at?: "wide" | "narrow" }[];
  held: string | null;
  muted?: boolean;
  copyOnNarrow?: boolean;
}) {
  return (
    <article className={`w-full max-w-[360px] ${muted ? "opacity-[.92]" : ""}`}>
      <div className="rounded border border-border bg-card">
        <div className="flex items-center gap-2 p-2">
          <span className="h-8 w-8 rounded-full border border-border" />
          <span>
            <span className="block text-sm">{page}</span>
            <span className="block text-xs text-muted-foreground">Sponsored<span className="hidden sm:inline"> · <span style={{ color: META }}>●</span></span></span>
          </span>
        </div>
        {copy ? <p className={`px-3 py-2 text-sm ${copyOnNarrow ? "" : "hidden sm:block"}`}>{copy}</p> : null}
        <Plate words={words} time={time} crop muted={muted} />
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <p className="min-w-0 text-sm font-medium">{headline}<br /><span className="font-normal text-muted-foreground">{sub}</span></p>
          <span className="inline-flex shrink-0 rounded bg-foreground px-3 py-1.5 text-sm text-background">{cta}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {chips.map((chip) => (
          <span key={chip.text} className={`rounded border px-1.5 py-0.5 text-xs ${chip.ok ? "border-success text-success" : "border-border"} ${chip.at === "wide" ? "hidden sm:inline" : chip.at === "narrow" ? "sm:hidden" : ""}`}>{chip.text}</span>
        ))}
        {!held ? (
          <span className="ml-auto hidden gap-1 sm:flex">
            <Icon label="Edit">✎</Icon>
            <Icon label="Reject">✕</Icon>
            <Icon label="Approve" solid>✓</Icon>
          </span>
        ) : null}
      </div>
      {!held ? (
        <div className="mt-2 flex gap-1 sm:hidden">
          <Icon label="Edit">✎</Icon>
          <Icon label="Reject">✕</Icon>
          <Icon label="Approve" solid>✓</Icon>
        </div>
      ) : null}
      {held ? (
        <div className="mt-2 rounded border border-warning/40 bg-warning/10 p-2 text-sm">
          <span className="rounded bg-warning px-1.5 py-0.5 text-xs text-background">Held</span>
          <b className="mt-1 block sm:mt-0 sm:ml-2 sm:inline">{held}</b>
          <button type="button" className="mt-2 block w-full rounded border border-border bg-card px-2 py-1 text-sm sm:inline sm:w-auto">Clear for artist channels</button>
          <span className="ml-2 hidden gap-1 align-middle opacity-40 sm:inline-flex">
            <Icon label="Edit">✎</Icon>
            <Icon label="Reject">✕</Icon>
          </span>
        </div>
      ) : null}
    </article>
  );
}

function Icon({ children, label, solid = false }: { children: string; label: string; solid?: boolean }) {
  return (
    <span aria-label={label} className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded border text-sm ${solid ? "border-foreground bg-foreground text-background" : "border-border"}`}>{children}</span>
  );
}

export function CaptionPlate({
  lines,
  marker,
  label,
}: {
  lines: readonly string[];
  marker: string;
  label: string;
}) {
  return (
    <figure className="w-[260px] shrink-0">
      <div className="relative aspect-[9/16] overflow-hidden bg-black" style={{ containerType: "size" }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#2a241c,#6a5a48)" }} />
        <div className="pointer-events-none absolute inset-x-[8%] border border-dashed border-white/80" style={{ top: "14.58%", bottom: "14.59%" }}>
          <i className="absolute right-1 top-0 text-[8px] not-italic text-white">4:5 rect · 14.58 %</i>
        </div>
        <div className="pointer-events-none absolute inset-x-0 border-t" style={{ top: "35.5%", borderColor: "#ffd34a" }}>
          <i className="absolute right-1 -top-3 bg-black/60 px-1 text-[8px] not-italic" style={{ color: "#ffd34a" }}>{marker}</i>
        </div>
        <p
          className="pointer-events-none absolute top-[35.5%] left-[8%] right-[8%] -translate-y-1/2 text-center whitespace-pre-line text-white"
          style={{
            fontWeight: 400,
            fontStretch: "120%",
            fontSize: "5.1389cqw",
            lineHeight: 1.054,
            WebkitTextStroke: "0.054054em #000",
            paintOrder: "stroke fill",
          }}
        >
          {lines.join("\n")}
        </p>
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 text-white">
          <span className="text-xs">▶</span>
          <span className="h-0.5 flex-1 bg-white/80" />
          <span className="text-[10px]">0:14</span>
        </div>
      </div>
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

export function QuotePlate({
  words,
  weight,
  label,
}: {
  words: string;
  weight: QuoteWeight;
  label: string;
}) {
  return (
    <figure className="w-[260px] shrink-0">
      <Plate words={words} time="0:14" crop={false} weight={weight} marker={{ at: "28%", label: "quote centre · 0.28 H" }} />
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
