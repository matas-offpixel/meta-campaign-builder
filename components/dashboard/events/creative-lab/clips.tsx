"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { cantRunReason, durationLabel, groupClips, metricUnit, money, sourceBadge, verdictChip } from "@/lib/creative-lab/surface";
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
  if (clips.length === 0) {
    return <p className="mb-2 text-muted-foreground">{title} · 0{hint ? ` · ${hint}` : ""}</p>;
  }
  return (
    <div>
      <p className="mb-2 text-muted-foreground">{title} · {clips.length}{hint ? ` · ${hint}` : ""}</p>
      <div className={wide ? "grid grid-cols-2 gap-2 sm:grid-cols-5" : "flex gap-2 overflow-x-auto sm:grid sm:grid-cols-5"}>
        {clips.map((clip) => {
          const reason = cantRunReason(clip);
          const chip = clip.judged ? verdictChip(clip.judged.verdict === "untested" || clip.judged.verdict === "thin" ? "untested" : clip.judged.verdict) : verdictChip("untested");
          return (
            <article key={clip.id} className={`w-36 shrink-0 sm:w-auto ${reason ? "rounded border border-dashed border-destructive p-1" : ""}`} title={clip.rightsRef}>
              {clip.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- storage thumbnail, not a static asset
                <img src={clip.thumbnailUrl} alt="" className="aspect-[9/16] w-full rounded object-cover" />
              ) : (
                <div className="flex aspect-[9/16] w-full items-center justify-center rounded border border-border bg-card text-sm">{initials(clip.artistName)}</div>
              )}
              <p className="mt-1 flex justify-between text-xs">
                <span>{sourceBadge(clip.source)}</span>
                <span className="tabular-nums">{durationLabel(clip.durationSeconds)}</span>
              </p>
              <p className="text-xs">{clip.artistName} #{clip.clipNo}</p>
              {reason ? <p className="text-xs text-destructive">{reason}</p> : (
                <p className="text-xs">
                  <span className={chip.tone === "win" ? "text-success" : chip.tone === "lose" || chip.tone === "flag" ? "text-destructive" : "text-muted-foreground"}>{chip.label}</span>
                  {clip.judged && clipBucketKeeping(clip) ? <span className="tabular-nums"> · {money(clip.judged.cost)} / {metricUnit(clip.judged.metric)} · {clip.judged.results ?? "—"}</span> : null}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function clipBucketKeeping(clip: CreativeLabCardData["clips"][number]): boolean {
  return Boolean(clip.judged) && clip.judged?.verdict !== "untested" && clip.judged?.verdict !== "thin" && clip.cleared && !clip.renderError;
}

function FindClips({ lab, busy, onSave }: { lab: CreativeLabCardData; busy: boolean; onSave: Save }) {
  const rows = lab.artists.flatMap((artist) => artist.igCandidates.map((clip) => ({ artist, clip })));
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-medium">Find clips on Instagram</h3>
      <div className="flex gap-2 overflow-x-auto">
        {rows.map(({ artist, clip }) => (
          <article key={clip.igMediaId} className="w-40 shrink-0 rounded border border-border p-2">
            <p className="text-xs">{clip.permalink ? <a href={clip.permalink}>{clip.postedAt || clip.permalink}</a> : (clip.postedAt || "undated")}</p>
            <p className="tabular-nums text-xs">♥ {clip.likes ?? "—"} · 💬 {clip.comments ?? 0}</p>
            <p className="text-xs text-muted-foreground">{clip.aspect || "aspect unknown"} · {artist.name}</p>
            {!clip.hasFile && clip.status === "candidate" ? (
              <Button type="button" disabled={busy} onClick={() => onSave({ action: "requestIgCandidate", artistId: artist.id, igMediaId: clip.igMediaId })}>Request from team</Button>
            ) : null}
            <Button type="button" disabled title="coming in M4b">Add</Button>
            <p className="text-xs text-muted-foreground" title="coming in M4b">Skipped — text overlay</p>
          </article>
        ))}
      </div>
    </div>
  );
}
