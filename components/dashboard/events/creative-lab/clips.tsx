"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { HeldLabel } from "@/components/dashboard/events/creative-lab/held-label";
import {
  CLIPS_NOTE,
  effectiveSelection,
  emptySelection,
  leftSelectionNote,
  selectionAfterAll,
  selectionAfterNone,
  selectionAfterToggle,
  selectionCount,
  type ClipSelection,
} from "@/lib/creative-lab/selection";
import { CropPicker } from "@/components/dashboard/events/creative-lab/crop-picker";
import { RenderRows } from "@/components/dashboard/events/creative-lab/render-rows";
import { VerdictChip } from "@/components/dashboard/events/creative-lab/verdict-chip";
import { PosterVideo } from "@/components/dashboard/events/creative-lab/poster-video";
import { ClipSound, showSoundToggle, useClipVideo } from "@/components/dashboard/events/creative-lab/use-clip-video";
import { overlayPanelLine } from "@/lib/creative-lab/overlay-check";
import {
  candidateAddLabel,
  candidateTileState,
  cantRunReason,
  clipBucket,
  durationLabel,
  groupClips,
  findClipsErrorSentence,
  findClipsReadingLine,
  importErrorSentence,
  isNative9x16,
  metricUnit,
  money,
  postAge,
  rankCandidates,
  resultsLabel,
  sourceBadge,
} from "@/lib/creative-lab/surface";
import {
  artistHint,
  emptyFootage,
  featuringLine,
  promoterHint,
  promoterTileLabel,
  toggleFeature,
} from "@/lib/creative-lab/footage-owner";
import { WhichFolder } from "@/components/dashboard/events/drive/ui";
import { formatFileSize, preselectFolder, usualFolders, type FolderChoice } from "@/lib/drive/panel";
import { uploadFileToCampaignAssets } from "@/lib/tiktok-wizard/campaign-asset-upload";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function fileDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

export function LabClips({
  lab,
  busy,
  onSave,
  onError,
  intake = true,
  driveFolderId = null,
  pendingFind = false,
  pendingImportId = null,
  showTiles = true,
  audibleClipId = null,
  layout = "status",
}: {
  lab: CreativeLabCardData;
  busy: boolean;
  onSave: Save;
  onError: (message: string) => void;
  intake?: boolean;
  /** When the event has a Drive folder, a clip asks which folder before it is stored. */
  driveFolderId?: string | null;
  /** Frame only: Find clips is already in flight. */
  pendingFind?: boolean;
  pendingImportId?: string | null;
  showTiles?: boolean;
  /** Frame only: this clip mounts with sound on. Nothing is stored. */
  audibleClipId?: string | null;
  /** status keeps the Keeping / New / Can't run groups. owner groups by footage owner. */
  layout?: "status" | "owner";
}) {
  const groups = groupClips(lab.clips);
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [folderChoice, setFolderChoice] = useState<FolderChoice | null>(null);
  const findable = lab.lineupRows.filter((row) => row.labArtistId && row.instagramHandle);
  const [finding, setFinding] = useState(pendingFind);
  const [readingHandle, setReadingHandle] = useState<string | null>(pendingFind ? findable[0]?.instagramHandle ?? null : null);
  const [findError, setFindError] = useState<string | null>(null);
  const stored = lab.clipSelection ?? emptySelection();
  const [override, setOverride] = useState<ClipSelection | null>(null);
  const selection = override ?? stored;
  const usable = [...groups.keeping, ...groups.fresh];
  const usableIds = usable.map((clip) => clip.id);
  const counts = selectionCount(selection, lab.clips);
  const selected = new Set(effectiveSelection(selection, lab.clips).map((clip) => clip.id));
  const left = leftSelectionNote(selection, lab.clips);
  const folders = lab.artists.filter((artist) => artist.clipFolderUrl);

  async function applySelection(next: ClipSelection) {
    const previous = selection;
    setOverride(next);
    const result = await onSave({ action: "setClipSelection", mode: next.mode, rows: next.rows });
    if (!result?.ok) {
      setOverride(previous);
      onError("The selection didn't save — try again.");
    }
  }

  async function findClips() {
    setFindError(null);
    setFinding(true);
    let handle = findable[0]?.instagramHandle ?? null;
    try {
      for (const row of findable) {
        handle = row.instagramHandle;
        setReadingHandle(handle);
        const res = await fetch(`/api/creative-lab/artists/${row.labArtistId}/find-clips`, { method: "POST" });
        const json = (await res.json().catch(() => ({}))) as { error?: unknown };
        if (!res.ok) {
          setFindError(findClipsErrorSentence(json.error, handle));
          return;
        }
      }
      router.refresh();
    } catch {
      setFindError(findClipsErrorSentence(null, handle));
    } finally {
      setFinding(false);
    }
  }

  async function upload(file: File) {
    const artist = lab.artists.find((row) => row.rights === "approved") ?? lab.artists[0];
    if (!artist) {
      onError("Add an artist before a clip.");
      return;
    }
    const duration = await fileDuration(file);
    if (duration != null && duration > 30) {
      onError("Clips over 30 seconds are refused.");
      return;
    }
    if (driveFolderId) {
      const next = preselectFolder(
        { name: file.name, fromClips: true, artistId: artist.id },
        { artists: lab.artists.map((row) => ({ id: row.id, name: row.name })), status: lab.eventStatus, eventDate: lab.eventDate, today: lab.now.slice(0, 10) },
      );
      setPendingFile(file);
      setFolderChoice(next);
      return;
    }
    setWorking(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const contentHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const storagePath = `videos/creative-lab/${crypto.randomUUID()}.mp4`;
      await uploadFileToCampaignAssets(file, storagePath);
      const result = await onSave({
        action: "addClip",
        artistId: artist.id,
        source: "file",
        rightsRef: artist.rightsDocRef || "file",
        durationSeconds: duration,
        newAsset: { filename: file.name, storagePath, contentHash, byteSize: file.size, durationSeconds: duration },
      });
      if (result && !result.ok) onError(String(result.json.error || "Upload failed"));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section id="lab-clips" className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">Clips</h3>
          <p className="text-muted-foreground">{CLIPS_NOTE}</p>
        </div>
        <Button type="button" disabled={finding || findable.length === 0} onClick={() => void findClips()}>
          <HeldLabel
            idle={<><span className="max-[700px]:hidden">Find clips on Instagram</span><span className="hidden max-[700px]:inline">Find on Instagram</span></>}
            pending={<Finding />}
            active={finding}
          />
        </Button>
      </div>
      {counts.m > 0 ? (
        <div className="flex items-baseline justify-between gap-2">
          <p>
            <span className="font-bold">{counts.n}</span> of {counts.m} selected
            {counts.fresh > 0 ? <span className="text-muted-foreground"> · {counts.fresh} new, not selected</span> : null}
          </p>
          <p>
            <button type="button" className={counts.n === counts.m ? "text-muted-foreground" : "underline"} disabled={counts.n === counts.m} onClick={() => void applySelection(selectionAfterAll())}>Select all</button>
            {" · "}
            <button type="button" className={counts.n === 0 ? "text-muted-foreground" : "underline"} disabled={counts.n === 0} onClick={() => void applySelection(selectionAfterNone(usableIds))}>None</button>
          </p>
        </div>
      ) : null}
      {left ? <p className="text-sm">{left}</p> : null}
      {finding && findable.length > 0 ? <p className="text-sm text-muted-foreground">{findClipsReadingLine(readingHandle)}</p> : null}
      {findError ? <p className="text-sm text-destructive">{findError}</p> : null}
      {showTiles && layout === "owner" ? (
        <OwnerGroups
          lab={lab}
          selected={selected}
          onToggle={(clipId) => void applySelection(selectionAfterToggle(selection, usableIds, clipId))}
          onSave={onSave}
        />
      ) : showTiles ? <>
      <ClipGroup title="Keeping" hint="ran · cost per result" clips={groups.keeping} wide selected={selected} audibleClipId={audibleClipId} onToggle={(clipId) => void applySelection(selectionAfterToggle(selection, usableIds, clipId))} onCrop={(clipId, focus) => void fetch(`/api/creative-lab/clips/${clipId}/crop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cropFocusX: focus }) }).then(() => router.refresh())} />
      <ClipGroup title="New" hint="untested" clips={groups.fresh} selected={selected} audibleClipId={audibleClipId} onToggle={(clipId) => void applySelection(selectionAfterToggle(selection, usableIds, clipId))} onCrop={(clipId, focus) => void fetch(`/api/creative-lab/clips/${clipId}/crop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cropFocusX: focus }) }).then(() => router.refresh())} />
      <ClipGroup title="Can't run" clips={groups.cant} audibleClipId={audibleClipId} onCrop={() => undefined} />
      </> : null}
      {intake ? (
        <>
          <label
            className="block rounded border border-dashed border-border bg-card p-4 text-center text-muted-foreground"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void upload(file);
            }}
          >
            Drop a clip, or choose a file
            <input className="sr-only" type="file" accept="video/mp4,video/*" disabled={busy || working} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          </label>
          {pendingFile && folderChoice ? (
            <WhichFolder
              fileLabel={`${pendingFile.name} · ${formatFileSize(pendingFile.size)}`}
              choices={usualFolders({ artists: lab.artists.map((row) => ({ id: row.id, name: row.name })), status: lab.eventStatus, eventDate: lab.eventDate, today: lab.now.slice(0, 10) }, folderChoice)}
              selectedKey={folderChoice.key}
              artists={lab.artists.map((row) => ({ id: row.id, name: row.name }))}
              busy={working}
              onSelect={setFolderChoice}
              onCancel={() => { setPendingFile(null); setFolderChoice(null); }}
              onUpload={() => {
                const body = new FormData();
                body.set("file", pendingFile);
                body.set("key", folderChoice.key);
                if (folderChoice.artistName) body.set("artistName", folderChoice.artistName);
                setWorking(true);
                void fetch(`/api/events/${lab.eventId}/drive/upload`, { method: "POST", body })
                  .then(async (res) => {
                    const json = (await res.json()) as { error?: string; ok?: boolean };
                    if (!res.ok || json.ok === false) onError(json.error || "");
                    else {
                      setPendingFile(null);
                      setFolderChoice(null);
                      router.refresh();
                    }
                  })
                  .catch((err) => onError(err instanceof Error ? err.message : ""))
                  .finally(() => setWorking(false));
              }}
            />
          ) : null}
          {folders.map((artist) => (
            <Button key={artist.id} type="button" disabled={busy} onClick={() => void fetch(`/api/creative-lab/artists/${artist.id}/import-clips`, { method: "POST" }).then(() => router.refresh())}>
              Import {artist.name} folder
            </Button>
          ))}
        </>
      ) : null}
      <FindClips lab={lab} busy={busy} onSave={onSave} pendingImportId={pendingImportId} />
      <RenderRows rows={lab.renders} now={lab.now} />
    </section>
  );
}

function clipOwner(clip: CreativeLabCardData["clips"][number]): "promoter" | "artist" {
  if (clip.owner === "promoter" || clip.owner === "artist") return clip.owner;
  return clip.artistId ? "artist" : "promoter";
}

function OwnerGroups({
  lab,
  selected,
  onToggle,
  onSave,
}: {
  lab: CreativeLabCardData;
  selected: ReadonlySet<string>;
  onToggle: (clipId: string) => void;
  onSave: Save;
}) {
  const client = lab.clientName || "Client";
  const handle = lab.clientHandle || lab.voice?.promoter.handle || null;
  const empty = emptyFootage(client, handle);
  const promoter = lab.clips.filter((clip) => clipOwner(clip) === "promoter");
  const [menu, setMenu] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">{client} footage</p>
        <p className="text-muted-foreground"><span className="max-[700px]:hidden">{promoterHint(false)}</span><span className="hidden max-[700px]:inline">{promoterHint(true)}</span></p>
        {promoter.length === 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dashed border-border p-3 max-[700px]:flex-col max-[700px]:items-start">
            <span>{empty.sentence}</span>
            <Button type="button" onClick={() => void onSave(handle ? { action: "readVoice", pageKind: "promoter" } : { action: "readVoice", pageKind: "promoter" })}>{empty.action}</Button>
            <span className="text-xs text-muted-foreground">{empty.drop}</span>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {promoter.map((clip) => {
              const names = (clip.featuredArtistIds ?? []).map((id) => lab.artists.find((artist) => artist.id === id)?.name).filter((name): name is string => Boolean(name));
              return (
                <article key={clip.id} className={selected.has(clip.id) ? "rounded ring-2 ring-foreground" : ""}>
                  <ClipFrame src={clip.previewUrl} poster={clip.thumbnailUrl} hasFile={clip.hasFile} name={client} inS={clip.inS} outS={clip.outS} hasAudio={clip.hasAudio} ticked={selected.has(clip.id)} onToggle={() => onToggle(clip.id)} />
                  <p className="mt-1 flex justify-between text-xs"><span>{sourceBadge(clip.source)}</span><span className="tabular-nums">{durationLabel(clip.durationSeconds)}</span></p>
                  <p className="text-xs">{promoterTileLabel(client, clip.clipNo, names)}</p>
                  <button type="button" className="text-xs text-muted-foreground" onClick={() => setMenu(menu === clip.id ? null : clip.id)}>⋯</button>
                  {menu === clip.id ? (
                    <div className="mt-1 space-y-1 text-xs">
                      <p>Whose footage is this?</p>
                      <button type="button" onClick={() => void onSave({ action: "setClipOwner", clipId: clip.id, owner: "promoter", artistId: null })}>{client}&apos;s</button>
                      {lab.artists.map((artist) => (
                        <button key={artist.id} type="button" className="block" onClick={() => void onSave({ action: "setClipOwner", clipId: clip.id, owner: "artist", artistId: artist.id })}>{artist.name}&apos;s</button>
                      ))}
                      <p>Features…</p>
                      {lab.artists.map((artist) => {
                        const on = (clip.featuredArtistIds ?? []).includes(artist.id);
                        return (
                          <button
                            key={`f-${artist.id}`}
                            type="button"
                            className="block"
                            onClick={() => void onSave({ action: "setClipFeatures", clipId: clip.id, artistIds: toggleFeature(clip.featuredArtistIds ?? [], artist.id) })}
                          >
                            {on ? "✓ " : ""}{artist.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
      {lab.artists.map((artist) => {
        const clips = lab.clips.filter((clip) => clipOwner(clip) === "artist" && clip.artistId === artist.id);
        const featuring = promoter.filter((clip) => (clip.featuredArtistIds ?? []).includes(artist.id)).length;
        if (clips.length === 0 && featuring === 0) return null;
        return (
          <div key={artist.id} className="owner-artist">
            <p className="font-medium">{artist.name} footage</p>
            <p className="text-muted-foreground"><span className="max-[700px]:hidden">{artistHint(artist.name, artist.pronouns, false)}</span><span className="hidden max-[700px]:inline">{artistHint(artist.name, artist.pronouns, true)}</span></p>
            {featuring > 0 ? <p className="text-xs text-muted-foreground">{featuringLine(featuring, client, artist.name)}</p> : null}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {clips.map((clip) => (
                <article key={clip.id} className={selected.has(clip.id) ? "rounded ring-2 ring-foreground" : ""}>
                  <ClipFrame src={clip.previewUrl} poster={clip.thumbnailUrl} hasFile={clip.hasFile} name={artist.name} inS={clip.inS} outS={clip.outS} hasAudio={clip.hasAudio} ticked={selected.has(clip.id)} onToggle={() => onToggle(clip.id)} />
                  <p className="mt-1 flex justify-between text-xs"><span>{sourceBadge(clip.source)}</span><span className="tabular-nums">{durationLabel(clip.durationSeconds)}</span></p>
                  <p className="text-xs">{artist.name.split(" ")[0]} #{clip.clipNo}</p>
                  <button type="button" className="text-xs text-muted-foreground" onClick={() => setMenu(menu === clip.id ? null : clip.id)}>⋯</button>
                  {menu === clip.id ? (
                    <div className="mt-1 space-y-1 text-xs">
                      <p>Whose footage is this?</p>
                      <button type="button" onClick={() => void onSave({ action: "setClipOwner", clipId: clip.id, owner: "promoter", artistId: null })}>{client}&apos;s</button>
                      {lab.artists.map((item) => (
                        <button key={item.id} type="button" className="block" onClick={() => void onSave({ action: "setClipOwner", clipId: clip.id, owner: "artist", artistId: item.id })}>{item.name}&apos;s</button>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClipGroup({
  title,
  hint,
  clips,
  wide,
  selected,
  audibleClipId,
  onToggle,
  onCrop,
}: {
  title: string;
  hint?: string;
  clips: CreativeLabCardData["clips"];
  wide?: boolean;
  selected?: ReadonlySet<string>;
  audibleClipId?: string | null;
  onToggle?: (clipId: string) => void;
  onCrop: (clipId: string, focus: number) => void;
}) {
  if (clips.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-muted-foreground">{title} · {clips.length}{hint ? ` · ${hint}` : ""}</p>
      <div className={wide ? "grid grid-cols-2 gap-2 sm:grid-cols-5" : "flex gap-2 overflow-x-auto sm:grid sm:grid-cols-5"}>
        {clips.map((clip) => {
          const reason = cantRunReason(clip);
          const verdict = clip.judged ? (clip.judged.verdict === "thin" ? "untested" : clip.judged.verdict) : "untested";
          const wideFrame = clip.sourceWidth != null && clip.sourceHeight != null && !isNative9x16(clip.sourceWidth, clip.sourceHeight);
          return (
            <article key={clip.id} className={`w-36 shrink-0 sm:w-auto ${selected?.has(clip.id) ? "rounded ring-2 ring-foreground" : ""} ${reason ? "rounded border border-dashed border-destructive p-1" : ""}`} title={clip.rightsRef}>
              <ClipFrame src={clip.previewUrl} poster={clip.thumbnailUrl} hasFile={clip.hasFile} name={clip.artistName} inS={clip.inS} outS={clip.outS} hasAudio={clip.hasAudio} initialAudible={clip.id === audibleClipId} ticked={onToggle ? selected?.has(clip.id) === true : undefined} onToggle={onToggle ? () => onToggle(clip.id) : undefined} />
              <p className="mt-1 flex justify-between text-xs">
                <span>{sourceBadge(clip.source)}</span>
                <span className="tabular-nums">{durationLabel(clip.durationSeconds)}</span>
              </p>
              <p className="text-xs">{clip.artistName} #{clip.clipNo}</p>
              {clip.audioMatch ? <p className="text-xs">Music match — mute or replace before launch</p> : null}
              {wideFrame && !clip.cropOpen ? <p className="text-xs text-muted-foreground">Crop to 9:16</p> : null}
              {reason ? <p className="text-xs text-destructive">{reason}</p> : (
                <div className="mt-1 space-y-1 text-xs">
                  <VerdictChip verdict={verdict} />
                  {clip.judged && clipBucket(clip) === "keeping" ? (
                    <p className="tabular-nums">{money(clip.judged.cost)} / {metricUnit(clip.judged.metric)} · {resultsLabel(clip.judged.results, clip.judged.metric)}</p>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {clips.filter((clip) => clip.cropOpen && clip.sourceWidth != null && clip.sourceHeight != null && !isNative9x16(clip.sourceWidth, clip.sourceHeight)).map((clip) => (
        <CropPicker
          key={clip.id}
          src={clip.previewUrl}
          focus={clip.cropFocusX}
          clipNo={clip.clipNo}
          sourceWidth={clip.sourceWidth}
          sourceHeight={clip.sourceHeight}
          onSave={(focus) => onCrop(clip.id, focus)}
        />
      ))}
    </div>
  );
}

function ClipTick({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Selected" : "Not selected"}
      className="absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span
        className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 text-[12px] font-bold leading-none ${on ? "border-foreground bg-foreground text-on-media" : "border-on-media bg-black/40 text-transparent"}`}
      >
        ✓
      </span>
    </button>
  );
}

function ClipFrame({ src, poster, hasFile, name, inS, outS, hasAudio, initialAudible, ticked, onToggle }: { src: string | null; poster: string | null; hasFile: boolean; name: string; inS: number; outS: number | null; hasAudio?: boolean | null; initialAudible?: boolean; ticked?: boolean; onToggle?: () => void }) {
  const { videoProps, rangeProps, audible, toggleSound } = useClipVideo(inS, outS, { initialAudible });
  const tick = onToggle ? <ClipTick on={ticked === true} onToggle={onToggle} /> : null;
  if (src) {
    return (
      <div className="relative">
        {tick}
        <video
          {...videoProps}
          src={src}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded object-cover"
        />
        {showSoundToggle(hasAudio) ? <ClipSound audible={audible} onToggle={toggleSound} /> : null}
        <input
          aria-label="Scrub"
          className="absolute inset-x-2 bottom-2 h-1 accent-white"
          {...rangeProps}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    );
  }
  return (
    <div className="relative">
      {tick}
      {hasFile ? <div className="aspect-[9/16] w-full rounded bg-black" aria-label={name} /> : <div className="flex aspect-[9/16] w-full items-center justify-center rounded border border-border bg-card text-sm">{initials(name)}</div>}
    </div>
  );
}

function Poster({ url }: { url: string | null }) {
  if (!url) return <div className="aspect-[9/16] w-full rounded bg-foreground/80" />;
  if (/\.(webm|mp4)(\?|$)/i.test(url)) {
    return <PosterVideo src={url} at={0.5} className="aspect-[9/16] w-full rounded object-cover" />;
  }
  return <img src={url} alt="" className="aspect-[9/16] w-full rounded object-cover" />;
}

/** The button's words while Instagram is read: the spinner and "Finding…". */
function Finding() {
  return (
    <>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Finding…
    </>
  );
}

/** The button's words while a candidate imports: the spinner and "Importing…". */
function Importing() {
  return (
    <>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Importing…
    </>
  );
}

/** Candidate tiles: thumbnail, length, likes, comments, age, aspect, one action. */
function FindClips({ lab, busy, onSave, pendingImportId = null }: { lab: CreativeLabCardData; busy: boolean; onSave: Save; pendingImportId?: string | null }) {
  const router = useRouter();
  const [importing, setImporting] = useState<string | null>(pendingImportId);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const groups = lab.artists
    .map((artist) => ({ artist, rows: rankCandidates(artist.igCandidates) }))
    .filter((group) => group.rows.length > 0);
  const opened = groups.flatMap((group) => group.rows).find((clip) => clip.overlayOpen)?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(opened);
  if (groups.length === 0) return null;

  /** Download, check and register one candidate. The tile says "Importing…" until it resolves, and one sentence if it fails. */
  async function add(id: string, anyway: boolean) {
    if (pendingImportId) return;
    setImporting(id);
    setFailed((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });
    try {
      const res = await fetch(`/api/creative-lab/candidates/${id}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anyway }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setFailed((current) => ({ ...current, [id]: importErrorSentence(json.error) }));
        return;
      }
      router.refresh();
    } catch {
      setFailed((current) => ({ ...current, [id]: importErrorSentence(null) }));
    } finally {
      if (!pendingImportId) setImporting(null);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Find clips on Instagram</h3>
      {groups.map(({ artist, rows }) => {
        const open = rows.find((clip) => clip.id === openId && clip.overlay) ?? null;
        return (
          <div key={artist.id} className="space-y-2">
            <p className="text-muted-foreground">{artist.name} · best first · likes, comments and how recent · native 9:16 first</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {rows.map((clip) => {
                const state = candidateTileState(clip);
                const age = postAge(clip.postedAt, lab.now);
                const dimmed = clip.status === "skipped" || clip.status === "requested";
                const quality = clip.reason?.includes("Too low quality") ? clip.reason : null;
                const pending = importing === clip.id;
                const error = failed[clip.id] ?? null;
                return (
                  <article key={clip.igMediaId} data-candidate={clip.id} className={`rounded border border-border p-2 ${dimmed ? "opacity-[0.55]" : ""}`}>
                    <div className="relative">
                      <Poster url={clip.thumbnailUrl} />
                      <span className="absolute top-1 left-1 rounded bg-background px-1 text-xs font-medium tabular-nums text-foreground">{clip.rank}</span>
                      {clip.lengthSeconds != null ? <span className="absolute bottom-1 left-1 text-xs text-white">▶ {durationLabel(clip.lengthSeconds)}</span> : null}
                    </div>
                    <p className="mt-1 text-xs tabular-nums">♥ {clip.likes == null ? "—" : clip.likes.toLocaleString("en-GB")} · 💬 {(clip.comments ?? 0).toLocaleString("en-GB")}</p>
                    <p className="text-xs text-muted-foreground">{[age, clip.aspect || "aspect unknown"].filter(Boolean).join(" · ")}</p>
                    {state.action === "request" ? (
                      <Button type="button" size="sm" className="mt-1 w-full whitespace-nowrap px-1" disabled={busy} onClick={() => onSave({ action: "requestIgCandidate", artistId: artist.id, igMediaId: clip.igMediaId })}>Request from team</Button>
                    ) : state.action === "add" ? (
                      <Button type="button" size="sm" className="mt-1 w-full whitespace-nowrap" disabled={busy || pending} aria-busy={pending} onClick={() => void add(clip.id, false)}>
                        <HeldLabel idle={candidateAddLabel(clip.aspect)} pending={pending ? <Importing /> : null} active={pending} />
                      </Button>
                    ) : state.action === "import" ? (
                      <Button type="button" size="sm" className="mt-1 w-full whitespace-nowrap" disabled={busy || pending} aria-busy={pending} onClick={() => void add(clip.id, true)}>
                        <HeldLabel idle="Import" pending={pending ? <Importing /> : null} active={pending} />
                      </Button>
                    ) : null}
                    {error ? <p data-import-error className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
                    {quality ? <p className="mt-1 text-xs text-destructive">{quality}</p> : state.see ? (
                      <p className="mt-1 text-xs text-destructive">
                        {state.status} · <button type="button" className="underline" onClick={() => setOpenId(clip.id)}>see</button>
                      </p>
                    ) : state.status ? <p className="mt-1 text-xs text-muted-foreground">{state.status}</p> : null}
                  </article>
                );
              })}
            </div>
            {open?.overlay ? (
              <section className="w-full max-w-[460px] space-y-2 rounded border border-border bg-card p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium">Why #{open.rank} was skipped</h3>
                  <span className="text-xs text-muted-foreground">8 frames checked</span>
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {open.overlay.frames.map((frame) => (
                    <div key={frame.t} className={`relative aspect-[9/16] overflow-hidden rounded bg-black ${frame.text ? "outline outline-2 outline-destructive" : ""}`}>
                      <FrameStill src={open.thumbnailUrl} at={frame.t} />
                      {frame.text ? <span className="absolute inset-x-0 bottom-[30%] bg-destructive/80 text-center text-[10px] text-white">Aa</span> : null}
                    </div>
                  ))}
                </div>
                <p className="text-xs">
                  {overlayPanelLine(open.overlay.flagged)}{" "}
                  <button type="button" className="inline-flex items-center gap-1 underline" disabled={busy || importing === open.id} aria-busy={importing === open.id} onClick={() => void add(open.id, true)}>
                    <HeldLabel idle="Import anyway" pending={importing === open.id ? <Importing /> : "Import anyway"} active={importing === open.id} />
                  </button>
                </p>
                {failed[open.id] ? <p className="text-xs text-destructive" role="alert">{failed[open.id]}</p> : null}
              </section>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FrameStill({ src, at }: { src: string | null; at: number }) {
  if (!src) return null;
  if (/\.(webm|mp4)(\?|$)/i.test(src)) return <PosterVideo src={src} at={at} className="h-full w-full object-cover" />;
  return <img src={src} alt="" className="h-full w-full object-cover" />;
}
