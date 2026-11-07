"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { VerdictChip } from "@/components/dashboard/events/creative-lab/verdict-chip";
import { useClipVideo } from "@/components/dashboard/events/creative-lab/use-clip-video";
import {
  candidateTileState,
  cantRunReason,
  clipBucket,
  durationLabel,
  groupClips,
  metricUnit,
  money,
  postAge,
  rankCandidates,
  resultsLabel,
  sourceBadge,
} from "@/lib/creative-lab/surface";
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
}: {
  lab: CreativeLabCardData;
  busy: boolean;
  onSave: Save;
  onError: (message: string) => void;
}) {
  const groups = groupClips(lab.clips);
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const folders = lab.artists.filter((artist) => artist.clipFolderUrl);

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
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Clips</h3>
        <span className="text-muted-foreground">{groups.keeping.length + groups.fresh.length} usable · {groups.cant.length} can&apos;t run</span>
      </div>
      <ClipGroup title="Keeping" hint="ran · cost per result" clips={groups.keeping} wide />
      <ClipGroup title="New" hint="untested" clips={groups.fresh} />
      <ClipGroup title="Can't run" clips={groups.cant} />
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
      {folders.map((artist) => (
        <Button key={artist.id} type="button" disabled={busy} onClick={() => void fetch(`/api/creative-lab/artists/${artist.id}/import-clips`, { method: "POST" }).then(() => router.refresh())}>
          Import {artist.name} folder
        </Button>
      ))}
      <FindClips lab={lab} busy={busy} onSave={onSave} />
    </section>
  );
}

function ClipGroup({
  title,
  hint,
  clips,
  wide,
}: {
  title: string;
  hint?: string;
  clips: CreativeLabCardData["clips"];
  wide?: boolean;
}) {
  if (clips.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-muted-foreground">{title} · {clips.length}{hint ? ` · ${hint}` : ""}</p>
      <div className={wide ? "grid grid-cols-2 gap-2 sm:grid-cols-5" : "flex gap-2 overflow-x-auto sm:grid sm:grid-cols-5"}>
        {clips.map((clip) => {
          const reason = cantRunReason(clip);
          const verdict = clip.judged ? (clip.judged.verdict === "thin" ? "untested" : clip.judged.verdict) : "untested";
          return (
            <article key={clip.id} className={`w-36 shrink-0 sm:w-auto ${reason ? "rounded border border-dashed border-destructive p-1" : ""}`} title={clip.rightsRef}>
              <ClipFrame src={clip.previewUrl} poster={clip.thumbnailUrl} hasFile={clip.hasFile} name={clip.artistName} inS={clip.inS} outS={clip.outS} />
              <p className="mt-1 flex justify-between text-xs">
                <span>{sourceBadge(clip.source)}</span>
                <span className="tabular-nums">{durationLabel(clip.durationSeconds)}</span>
              </p>
              <p className="text-xs">{clip.artistName} #{clip.clipNo}</p>
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
    </div>
  );
}

function ClipFrame({ src, poster, hasFile, name, inS, outS }: { src: string | null; poster: string | null; hasFile: boolean; name: string; inS: number; outS: number | null }) {
  const { videoProps, rangeProps } = useClipVideo(inS, outS);
  if (src) {
    return (
      <div className="relative">
        <video
          {...videoProps}
          src={src}
          poster={poster ?? undefined}
          muted
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded object-cover"
        />
        <input
          aria-label="Scrub"
          className="absolute inset-x-2 bottom-2 h-1 accent-white"
          {...rangeProps}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    );
  }
  if (hasFile) return <div className="aspect-[9/16] w-full rounded bg-black" aria-label={name} />;
  return <div className="flex aspect-[9/16] w-full items-center justify-center rounded border border-border bg-card text-sm">{initials(name)}</div>;
}

/** Candidate tiles (design rules): rank · frame · ♥ / 💬 · age · aspect; one action or one status line. */
function FindClips({ lab, busy, onSave }: { lab: CreativeLabCardData; busy: boolean; onSave: Save }) {
  const groups = lab.artists
    .map((artist) => ({ artist, rows: rankCandidates(artist.igCandidates) }))
    .filter((group) => group.rows.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Find clips on Instagram</h3>
      {groups.map(({ artist, rows }) => (
        <div key={artist.id} className="space-y-2">
          <p className="text-muted-foreground">{artist.name} · best first</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {rows.map((clip) => {
              const state = candidateTileState(clip);
              const age = postAge(clip.postedAt, lab.now);
              return (
                <article key={clip.igMediaId} className="rounded border border-border p-2">
                  <div className="relative flex aspect-[9/16] w-full items-end rounded bg-foreground/80 p-1 text-xs text-background">
                    <span className="absolute top-1 left-1 rounded bg-background px-1 font-medium tabular-nums text-foreground">{clip.rank}</span>
                    {clip.permalink ? <a className="underline" href={clip.permalink}>Open post</a> : null}
                  </div>
                  <p className="mt-1 text-xs tabular-nums">♥ {clip.likes == null ? "—" : clip.likes.toLocaleString("en-GB")} · 💬 {(clip.comments ?? 0).toLocaleString("en-GB")}</p>
                  <p className="text-xs text-muted-foreground">{[age, clip.aspect || "aspect unknown"].filter(Boolean).join(" · ")}</p>
                  {state.action === "request" ? (
                    <Button type="button" size="sm" className="mt-1 w-full whitespace-nowrap px-1" disabled={busy} onClick={() => onSave({ action: "requestIgCandidate", artistId: artist.id, igMediaId: clip.igMediaId })}>Request from team</Button>
                  ) : state.action === "add" ? (
                    <Button type="button" size="sm" className="mt-1 w-full" disabled title="coming in M4b">Add</Button>
                  ) : null}
                  {state.status ? <p className="mt-1 text-xs text-muted-foreground">{state.status}</p> : null}
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
