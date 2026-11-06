"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { saleStageFromStatus, type SaleStage } from "@/lib/creative-lab/caption-facts";
import { captionCopy, ctaForStage, feedPostClip, groupClips, metricUnit, money, styleLabel, verdictChip } from "@/lib/creative-lab/surface";
import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

const ANGLES = ["lineup", "artist_first_person", "pov", "scarcity"] as const;
const STAGES: { id: SaleStage; label: string }[] = [
  { id: "upcoming", label: "Teaser" },
  { id: "signup", label: "Presale" },
  { id: "on_sale", label: "On sale" },
];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function LabCaptions({
  lab,
  busy,
  onSave,
}: {
  lab: CreativeLabCardData;
  busy: boolean;
  onSave: Save;
}) {
  const stageDefault = saleStageFromStatus(lab.eventStatus);
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>("lineup");
  const [stage, setStage] = useState<SaleStage>(stageDefault);
  const [count, setCount] = useState<1 | 3 | 5>(3);
  const [each, setEach] = useState(false);
  const usable = [...groupClips(lab.clips).keeping, ...groupClips(lab.clips).fresh];
  const page = lab.clientName || "Page";
  const visible = lab.captions.filter((caption) => caption.status !== "rejected");

  return (
    <section id="lab-captions" className="space-y-4">
      <h3 className="font-medium">Captions</h3>
      <div className="space-y-2 rounded border border-border bg-card p-3">
        <Control label="Angle" value={angle} options={ANGLES.map((id) => ({ id, label: styleLabel(id) }))} onChange={setAngle} />
        <div className="sm:hidden">
          <details>
            <summary>More</summary>
            <Counts count={count} setCount={setCount} stage={stage} setStage={setStage} />
          </details>
        </div>
        <div className="hidden sm:block">
          <Counts count={count} setCount={setCount} stage={stage} setStage={setStage} />
        </div>
        <Control
          label="Pair with"
          value={each ? "each" : "best"}
          options={[{ id: "best", label: "Best clip" }, { id: "each", label: "Each new clip" }]}
          onChange={(value) => setEach(value === "each")}
        />
        <Button
          type="button"
          disabled={busy}
          onClick={() => onSave({
            action: "generate",
            style: angle,
            n: count,
            clipId: each ? null : usable[0]?.id ?? null,
            stageOverride: stage,
          })}
        >
          Generate
        </Button>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto">
        {visible.map((caption) => (
          <FeedPost key={caption.id} lab={lab} caption={caption} page={page} stage={stageDefault} busy={busy} onSave={onSave} />
        ))}
      </div>
      <Ran lab={lab} />
    </section>
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

function FeedPost({
  lab,
  caption,
  page,
  stage,
  busy,
  onSave,
}: {
  lab: CreativeLabCardData;
  caption: CreativeLabCardData["captions"][number];
  page: string;
  stage: SaleStage;
  busy: boolean;
  onSave: Save;
}) {
  const [editing, setEditing] = useState(false);
  const [overlay, setOverlay] = useState(captionCopy(caption.lines));
  const [primary, setPrimary] = useState(caption.primaryText);
  const headliners = new Set(lab.lineupRows.filter((row) => row.isHeadliner && row.labArtistId).map((row) => row.labArtistId as string));
  const clip = feedPostClip(lab.clips, headliners);
  const copy = captionCopy(caption.lines);
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
      <CaptionOverlay lines={copy.split("\n")} src={clip?.previewUrl} />
      {caption.primaryText ? <p className="px-3 py-2 text-sm">{caption.primaryText}</p> : null}
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <p className="font-medium">{lab.eventName}</p>
        <span className="rounded bg-foreground px-3 py-1.5 text-background">{ctaForStage(stage)}</span>
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">{styleLabel(caption.style)}{clip ? ` · ${clip.artistName} #${clip.clipNo}` : ""}</p>
      {held ? <p className="px-3 pb-2 text-sm">{held}</p> : null}
      {caption.validatorDetail ? <p className="px-3 pb-2 text-sm text-destructive">{caption.validatorDetail}</p> : null}
      {editing ? (
        <form
          className="space-y-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setEditing(false);
            void onSave({ action: "editCaption", captionId: caption.id, overlay, primaryText: primary });
          }}
        >
          <label className="block text-xs">Overlay<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={4} value={overlay} onChange={(event) => setOverlay(event.target.value)} /></label>
          <label className="block text-xs">Primary text<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={2} value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
          <Button type="submit" disabled={busy}>Save</Button>
        </form>
      ) : (
        <div className="flex items-center gap-2 p-2">
          <button type="button" aria-label="Edit" className="h-8 w-8 rounded border border-border" onClick={() => { setOverlay(captionCopy(caption.lines)); setPrimary(caption.primaryText); setEditing(true); }}>✎</button>
          <button type="button" aria-label="Reject" className="h-8 w-8 rounded border border-border" disabled={busy || caption.status !== "proposed"} onClick={() => onSave({ action: "setCaptionStatus", captionId: caption.id, status: "rejected" })}>✕</button>
          {held ? null : (
            <button type="button" aria-label="Approve" className="h-8 w-8 rounded bg-foreground text-background" disabled={busy || caption.status !== "proposed"} onClick={() => onSave({ action: "setCaptionStatus", captionId: caption.id, status: "approved" })}>✓</button>
          )}
        </div>
      )}
    </article>
  );
}

function Ran({ lab }: { lab: CreativeLabCardData }) {
  const groups = lab.rounds.map((round) => ({
    round,
    rows: round.ads.map((ad) => ({ ad, caption: lab.captions.find((caption) => caption.id === ad.captionId) })).filter((row) => row.caption),
  })).filter((group) => group.rows.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.round.id}>
          <p>Ran in round {group.round.roundNo}</p>
          {group.rows.map((row) => {
            const chip = verdictChip(row.ad.verdict);
            return (
              <p key={row.ad.id} className="text-sm">
                {captionCopy(row.caption!.lines).split("\n")[0]} · {money(row.ad.cost)} / {metricUnit(row.ad.metric)} · {chip.label}
              </p>
            );
          })}
        </div>
      ))}
    </div>
  );
}
