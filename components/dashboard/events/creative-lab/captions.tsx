"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { saleStageFromStatus, type SaleStage } from "@/lib/creative-lab/caption-facts";
import { HeldLabel } from "@/components/dashboard/events/creative-lab/held-label";
import { captionsNote, eachPreviewClips, eachPreviewLine, effectiveSelection, emptySelection, NO_CLIP_SELECTED, OFF_CARD_CLIP, previewPlate, type PairMode } from "@/lib/creative-lab/selection";
import { captionCopy, captionPreviewClip, ctaForStage, feedHeadline, generateButtonLabel, generateFailureSentence, roundHasRun, styleLabel } from "@/lib/creative-lab/surface";
import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { QuoteGenerator, QuotePost } from "@/components/dashboard/events/creative-lab/quote-surface";
import { VoicePanel } from "@/components/dashboard/events/creative-lab/voice-panel";
import { USE_ANGLE_EVENT } from "@/components/insights-rail/use-angle";
import { acceptQuote, heldQuoteSentence, postsForQuote, quoteLines, sourceChip, type CaptionGenerator, type QuoteSource } from "@/lib/creative-lab/quote";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

const ANGLES = ["lineup", "artist_first_person", "pov", "scarcity"] as const;
const STAGES: { id: SaleStage; label: string }[] = [
  { id: "upcoming", label: "Teaser" },
  { id: "signup", label: "Presale" },
  { id: "on_sale", label: "On sale" },
];

function noticeAfterGenerate(result: { ok: boolean; json: Record<string, unknown> } | undefined): string | null {
  if (!result?.ok) return generateFailureSentence(result?.json.error ?? result?.json.refused);
  const sentence = result.json.notice;
  return typeof sentence === "string" && sentence.trim() ? sentence : null;
}

/** The ids this write stored. Null when the request failed, so an older cross stays. */
function writtenCaptionIds(result: { ok: boolean; json: Record<string, unknown> } | undefined): string[] | null {
  if (!result?.ok || !Array.isArray(result.json.captions)) return null;
  return result.json.captions.flatMap((row) => {
    if (!row || typeof row !== "object" || !("id" in row)) return [];
    const id = (row as { id?: unknown }).id;
    return typeof id === "string" && id ? [id] : [];
  });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function LabCaptions({
  lab,
  busy,
  onSave,
  quoteMode = false,
  initialAngle = "lineup",
  initialArtistId,
  initialVoiceOpen = false,
  voiceContained = false,
  pendingWrite = false,
  initialPair = "best",
  initialWrittenIds,
}: {
  lab: CreativeLabCardData;
  busy: boolean;
  onSave: Save;
  /** Off on the CL frames, so those shots stay as they were. The event page turns it on. */
  quoteMode?: boolean;
  initialAngle?: (typeof ANGLES)[number];
  initialArtistId?: string;
  initialVoiceOpen?: boolean;
  voiceContained?: boolean;
  /** Frame only: the Write button is already in flight. */
  pendingWrite?: boolean;
  initialPair?: PairMode;
  /** Frame only: the captions the last write returned, so Each selected can draw them. */
  initialWrittenIds?: readonly string[];
}) {
  const stageDefault = saleStageFromStatus(lab.eventStatus);
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>(initialAngle);
  const [stage, setStage] = useState<SaleStage>(stageDefault);

  // The Insights rail's "Use {angle}" (R9): pre-select, never generate.
  useEffect(() => {
    const onUse = (event: Event) => {
      const next = (event as CustomEvent<{ angle?: string }>).detail?.angle;
      if (next && (ANGLES as readonly string[]).includes(next)) setAngle(next as (typeof ANGLES)[number]);
    };
    window.addEventListener(USE_ANGLE_EVENT, onUse);
    return () => window.removeEventListener(USE_ANGLE_EVENT, onUse);
  }, []);
  const [count, setCount] = useState<1 | 3 | 5>(3);
  const [pair, setPair] = useState<PairMode>(initialPair);
  const [writtenIds, setWrittenIds] = useState<readonly string[] | null>(initialWrittenIds ?? null);
  const [writing, setWriting] = useState(pendingWrite);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"caption" | "quote">("caption");
  const [snapshot, setSnapshot] = useState<CaptionGenerator>({ angle: "lineup", count: 3, pair: "best", stage: stageDefault });
  const [artistId, setArtistId] = useState(initialArtistId ?? lab.artists[0]?.id ?? "");
  const [source, setSource] = useState<QuoteSource>("post");
  const [words, setWords] = useState("");
  const [where, setWhere] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const artist = lab.artists.find((item) => item.id === artistId) ?? lab.artists[0];
  const posts = postsForQuote((artist?.igCandidates ?? []).map((row) => ({ permalink: row.permalink, caption: row.caption, postedAt: row.postedAt })));
  function chooseMode(next: "caption" | "quote") {
    if (next === "quote") {
      setSnapshot({ angle, count, pair, stage });
      setMode("quote");
      return;
    }
    setAngle(snapshot.angle);
    setCount(snapshot.count);
    setPair(snapshot.pair);
    setStage(snapshot.stage);
    setMode("caption");
  }
  function useWords() {
    const post = posts.find((item) => item.offered && item.caption === words)
      ?? posts.find((item) => item.offered && item.caption != null && words.trim() === item.caption.trim());
    const sourceText = source === "post" ? (post?.caption ?? words) : source === "typed" ? null : words;
    const accepted = acceptQuote({ words, source, sourceText });
    if (!accepted.ok) {
      setRefusal(accepted.sentence);
      return;
    }
    if (source === "typed" && !where.trim()) {
      setRefusal("Say where these words were said.");
      return;
    }
    setRefusal(null);
    void onSave({
      action: "useQuote",
      artistId: artist?.id ?? "",
      words: accepted.text,
      quoteSource: source,
      quoteSourceText: source === "typed" ? null : sourceText,
      quoteSourceRef: source === "post" ? post?.permalink ?? null : null,
      quoteSourceNote: source === "typed" ? where.trim() : null,
    });
  }
  const page = lab.clientName || "Page";
  const visible = lab.captions.filter((caption) => caption.status !== "rejected");
  const selection = lab.clipSelection ?? emptySelection();
  const selected = effectiveSelection(selection, lab.clips);
  const plates = eachPreviewClips(selected);
  const written = new Map(visible.map((caption) => [caption.id, caption]));
  const crossed = (writtenIds ?? []).flatMap((id) => {
    const caption = written.get(id);
    return caption && caption.mode !== "quote" ? [caption] : [];
  });
  const ran = lab.rounds.filter((round) => roundHasRun(round.status));
  const roundNo = (ran.at(-1)?.roundNo ?? 0) + 1;

  return (
    <section id="lab-captions" className="space-y-4">
      <h3 className="font-medium">Captions</h3>
      <p className="text-muted-foreground">{captionsNote(roundNo)}</p>
      {quoteMode && mode === "quote" ? (
        <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {lab.artists.map((item) => (
            <button key={item.id} type="button" aria-pressed={item.id === artist?.id} className="rounded border border-border px-2 py-1 text-sm" onClick={() => { setArtistId(item.id); setWords(""); }}>{item.name}</button>
          ))}
        </div>
        <QuoteGenerator
          mode="quote"
          onMode={chooseMode}
          artistLabel={artist?.name ?? "Pick an artist"}
          showArtistChip={artist?.rights === "approved"}
          source={source}
          onSource={(next) => {
            setSource(next);
            setWords("");
            setRefusal(null);
          }}
          words={words}
          onWords={(value) => {
            setWords(value);
            setRefusal(null);
          }}
          chip={sourceChip({ source, postedLabel: posts[0]?.postedOn ?? "", wide: true }).replace(/^●\s*/, "")}
          picked={null}
          lineLabel={`${quoteLines(words).length} of 4 lines`}
          handle={artist?.igUsername}
          pairNote="Pairs with the artist's best clip (More to change). Nothing is written by the Lab."
          onUse={useWords}
          refusal={refusal}
          where={where}
          onWhere={setWhere}
          posts={posts}
          onPickPost={(post) => {
            if (!post.offered || post.caption == null) return;
            setWords(post.caption);
            setRefusal(null);
          }}
        />
        </div>
      ) : (
      <div className="space-y-2 rounded border border-border bg-card p-3">
        {quoteMode ? <Control label="Mode" value={mode} options={[{ id: "caption", label: "Caption" }, { id: "quote", label: "Quote" }]} onChange={chooseMode} /> : null}
        <Control label="Angle" value={angle} options={ANGLES.map((id) => ({ id, label: styleLabel(id) }))} onChange={setAngle} />
        {angle === "artist_first_person" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-muted-foreground">Artist</span>
            <div className="flex flex-wrap items-center gap-1">
              {lab.artists.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === artist?.id}
                  className={`rounded px-2 py-1 text-sm ${item.id === artist?.id ? "bg-foreground text-background" : "border border-border bg-transparent"}`}
                  onClick={() => setArtistId(item.id)}
                >
                  {item.name}
                </button>
              ))}
              {artist ? (
                <span className={artist.rights === "approved" ? "rounded border border-success px-1.5 py-0.5 text-xs text-success" : "rounded border border-foreground px-1.5 py-0.5 text-xs"}>
                  {artist.rights === "approved" ? "✓ artist channels" : "Promoter page only"}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="sm:hidden">
          <details>
            <summary>More</summary>
            <Counts count={count} setCount={setCount} stage={stage} setStage={setStage} />
          </details>
        </div>
        <div className="hidden sm:block">
          <Counts count={count} setCount={setCount} stage={stage} setStage={setStage} />
        </div>
        {pair === "each" ? <p className="tabular-nums text-muted-foreground">{eachPreviewLine(crossed.length, plates.length)}</p> : null}
        <Control
          label="Pair with"
          value={pair}
          options={[
            { id: "spread", label: "Selected clips" },
            { id: "best", label: "Best of selected" },
            { id: "each", label: "Each selected" },
          ]}
          onChange={(value) => {
            setPair(value);
            setNotice(null);
          }}
        />
        <Button
          type="button"
          disabled={busy || writing}
          onClick={() => {
            setNotice(null);
            setWriting(true);
            void onSave({
              action: "generate",
              style: angle,
              n: count,
              pair,
              artistId: angle === "artist_first_person" ? artist?.id ?? null : null,
              stageOverride: stage,
            }).then((result) => { setNotice(noticeAfterGenerate(result)); const ids = writtenCaptionIds(result); if (ids) setWrittenIds(ids); }).catch(() => setNotice(generateFailureSentence(null))).finally(() => setWriting(false));
          }}
        >
          <HeldLabel
            idle={generateButtonLabel(false, count)}
            pending={<><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{generateButtonLabel(true, count)}</>}
            active={writing}
          />
        </Button>
        {notice ? <p className="text-sm">{notice}</p> : null}
        {quoteMode ? (
          <VoicePanel
            lab={lab}
            angle={angle}
            artistId={artist?.id ?? ""}
            busy={busy}
            onSave={onSave}
            initialOpen={initialVoiceOpen}
            contained={voiceContained}
          />
        ) : null}
      </div>
      )}
      {pair === "each" ? (
        <div className="space-y-4">
          {crossed.map((caption) => (
              <div key={caption.id} className="space-y-2">
                <p className="text-xs text-muted-foreground">{styleLabel(caption.style)}</p>
                <div className="flex snap-x gap-3 overflow-x-auto">
                  {(plates.length > 0 ? plates : [null]).map((clip, index) => (
                    <FeedPost key={clip?.id ?? "none"} lab={lab} caption={caption} page={page} stage={stageDefault} busy={busy} onSave={onSave} clipOverride={clip} actions={index === 0} />
                  ))}
                </div>
              </div>
          ))}
        </div>
      ) : (
      <div className="flex snap-x gap-3 overflow-x-auto">
        {visible.map((caption) => (
          caption.mode === "quote" ? (
            <QuoteLive key={caption.id} lab={lab} caption={caption} page={page} />
          ) : (
            <FeedPost key={caption.id} lab={lab} caption={caption} page={page} stage={stageDefault} busy={busy} onSave={onSave} />
          )
        ))}
      </div>
      )}
    </section>
  );
}

function QuoteLive({
  lab,
  caption,
  page,
}: {
  lab: CreativeLabCardData;
  caption: CreativeLabCardData["captions"][number];
  page: string;
}) {
  const artist = lab.artists.find((item) => item.id === caption.artistId) ?? lab.artists[0];
  const cleared = artist?.rights === "approved";
  const held = cleared ? null : heldQuoteSentence(artist?.name ?? "this artist", artist?.pronouns);
  return (
    <div className="w-full shrink-0 snap-start sm:w-80">
      <QuotePost
        page={page}
        copy={caption.primaryText.trim() || null}
        words={caption.lines.join("\n")}
        time="0:00"
        headline={feedHeadline({ eventName: lab.eventName, eventDate: lab.eventDate, venue: lab.venueName })}
        sub=""
        cta="Get tickets"
        muted={!cleared}
        weight={caption.quoteWeight === 400 ? 400 : 700}
        held={held}
        chips={[
          { text: "quote" },
          { text: sourceChip({ source: caption.quoteSource ?? "typed", where: caption.quoteSourceNote, wide: true }) },
          ...(artist ? [{ text: artist.rights === "approved" ? artist.rightsLabel : "Promoter page only", ok: artist.rights === "approved" }] : []),
        ]}
      />
      {caption.validatorDetail ? <p className="px-1 pt-2 text-sm text-destructive">{caption.validatorDetail}</p> : null}
    </div>
  );
}

function Counts({
  count,
  setCount,
  stage,
  setStage,
}: {
  count: 1 | 3 | 5;
  setCount: (value: 1 | 3 | 5) => void;
  stage: SaleStage;
  setStage: (value: SaleStage) => void;
}) {
  return (
    <>
      <Control label="How many" value={String(count)} options={([1, 3, 5] as const).map((n) => ({ id: String(n), label: String(n) }))} onChange={(value) => setCount(Number(value) as 1 | 3 | 5)} />
      <Control label="Stage" value={stage} options={STAGES} onChange={setStage} />
    </>
  );
}

function Control<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            className={`rounded px-2 py-1 text-sm ${option.id === value ? "bg-foreground text-background" : "border border-border bg-transparent"}`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeedPost({
  lab,
  caption,
  page,
  stage,
  busy,
  onSave,
  clipOverride,
  actions = true,
}: {
  lab: CreativeLabCardData;
  caption: CreativeLabCardData["captions"][number];
  page: string;
  stage: SaleStage;
  busy: boolean;
  onSave: Save;
  /** Each selected draws this caption on a chosen clip. */
  clipOverride?: CreativeLabCardData["clips"][number] | null;
  /** ✎ ✕ ✓ belong to the caption, so only the first preview of a cross shows them. */
  actions?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [focusPrimary, setFocusPrimary] = useState(false);
  const [overlay, setOverlay] = useState(captionCopy(caption.lines));
  const [primary, setPrimary] = useState(caption.primaryText);
  const primaryField = useRef<HTMLTextAreaElement>(null);
  const selection = lab.clipSelection ?? emptySelection();
  const selected = effectiveSelection(selection, lab.clips);
  const plate = clipOverride !== undefined ? (clipOverride ? "clip" : previewPlate(null, lab.clips, selected.length)) : previewPlate(caption.clipId, lab.clips, selected.length);
  const clip = clipOverride !== undefined
    ? clipOverride
    : plate !== "clip"
      ? null
      : caption.clipId
        ? captionPreviewClip(lab.clips, caption.clipId)
        : captionPreviewClip(selected.length ? selected : lab.clips, null);
  function discardEdits() {
    setOverlay(captionCopy(caption.lines));
    setPrimary(caption.primaryText);
    setFocusPrimary(false);
    setEditing(false);
  }
  useEffect(() => {
    if (!editing || !focusPrimary) return;
    const field = primaryField.current;
    if (!field) return;
    field.focus();
    field.scrollIntoView({ block: "nearest" });
  }, [editing, focusPrimary]);
  const copy = captionCopy(caption.lines);
  const headline = feedHeadline({ eventName: lab.eventName, eventDate: lab.eventDate, venue: lab.venueName });
  const held = caption.style === "artist_first_person" && !lab.artists.some((artist) => artist.rights === "approved")
    ? `Artist voice — runs once ${lab.artists[0]?.name ?? "this artist"} is cleared for their own channels.`
    : null;
  return (
    <article className="w-full shrink-0 snap-start rounded border border-border bg-card sm:w-72">
      <div className="flex items-center gap-2 p-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-xs">{initials(page)}</span>
        <span>
          <span className="block text-sm">{page}</span>
          <span className="block text-xs text-muted-foreground">Sponsored</span>
        </span>
      </div>
      {caption.primaryText.trim() ? (
        <p className="px-3 py-2 text-sm">{caption.primaryText}</p>
      ) : actions ? (
        <button
          type="button"
          className="block w-full px-3 py-2 text-left text-sm text-muted-foreground"
          onClick={() => {
            setOverlay(captionCopy(caption.lines));
            setPrimary(caption.primaryText);
            setFocusPrimary(true);
            setEditing(true);
          }}
        >
          No primary text yet — ✎ to add
        </button>
      ) : (
        <p className="px-3 py-2 text-sm text-muted-foreground">No primary text yet</p>
      )}
      {plate === "missing" ? (
        <p className="px-3 py-6 text-sm">{OFF_CARD_CLIP}</p>
      ) : (
        <>
          <CaptionOverlay lines={copy.split("\n")} src={clip?.previewUrl} poster={clip?.thumbnailUrl ?? null} inS={clip?.inS ?? 0} outS={clip?.outS ?? null} hasAudio={clip?.hasAudio} />
          {plate === "none" ? <p className="px-3 py-2 text-sm">{NO_CLIP_SELECTED}</p> : null}
        </>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <p className="min-w-0 font-medium">{headline}</p>
        <span className="inline-flex min-w-28 shrink-0 items-center justify-center whitespace-nowrap rounded bg-foreground px-3 py-1.5 text-background">{ctaForStage(stage)}</span>
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">{styleLabel(caption.style)}{clip ? ` · ${clip.artistName} #${clip.clipNo}` : ""}</p>
      {held ? <p className="px-3 pb-2 text-sm">{held}</p> : null}
      {caption.validatorDetail ? <p className="px-3 pb-2 text-sm text-destructive">{caption.validatorDetail}</p> : null}
      {actions && editing ? (
        <form
          className="space-y-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setEditing(false);
            void onSave({ action: "editCaption", captionId: caption.id, overlay, primaryText: primary });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            discardEdits();
          }}
        >
          <label className="block text-xs">Overlay<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={4} value={overlay} onChange={(event) => setOverlay(event.target.value)} /></label>
          <label className="block text-xs">Primary text<textarea ref={primaryField} autoFocus={focusPrimary} className="mt-1 w-full rounded border border-border bg-background p-2" rows={2} value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy}>Save</Button>
            <Button type="button" variant="outline" onClick={discardEdits}>Cancel</Button>
          </div>
        </form>
      ) : actions ? (
        <div className="flex items-center gap-2 p-2">
          <button type="button" aria-label="Edit" className="h-8 w-8 rounded border border-border" onClick={() => { setOverlay(captionCopy(caption.lines)); setPrimary(caption.primaryText); setFocusPrimary(!caption.primaryText.trim()); setEditing(true); }}>✎</button>
          <button type="button" aria-label="Reject" className="h-8 w-8 rounded border border-border" disabled={busy || caption.status !== "proposed"} onClick={() => onSave({ action: "setCaptionStatus", captionId: caption.id, status: "rejected" })}>✕</button>
          {held ? null : (
            <button type="button" aria-label="Approve" className="h-8 w-8 rounded bg-foreground text-background" disabled={busy || caption.status !== "proposed"} onClick={() => onSave({ action: "setCaptionStatus", captionId: caption.id, status: "approved" })}>✓</button>
          )}
        </div>
      ) : null}
    </article>
  );
}
