"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LabLineup } from "@/components/dashboard/events/creative-lab/lineup";
import { LabStrip } from "@/components/dashboard/events/creative-lab/strip";
import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { labNextStep } from "@/lib/creative-lab/lineup";
import { uploadFileToCampaignAssets } from "@/lib/tiktok-wizard/campaign-asset-upload";

const STYLES = [
  "lineup",
  "question",
  "scarcity",
  "social_proof",
  "venue",
  "whats_next",
  "artist_first_person",
  "experience",
  "four_line",
  "pov",
] as const;

async function post(eventId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`/api/creative-lab/events/${eventId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}


export function CreativeLabCard({ lab }: { lab: CreativeLabCardData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [judgeTable, setJudgeTable] = useState<string | null>(null);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const result = await post(lab.eventId, body);
      if (!result.ok) {
        setError(String(result.json.error || result.json.refused || "Request failed"));
        return result;
      }
      const caption = result.json.startingCaption as { ok?: boolean; errors?: { detail: string }[] } | null | undefined;
      if (caption && caption.ok === false) {
        setError(caption.errors?.map((item) => item.detail).join("; ") || "The starting caption did not pass.");
      }
      router.refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }

  const launchReason = !lab.launchesEnabled
    ? "Lab launches are switched off"
    : null;
  const running = lab.rounds.find((round) => round.ads.some((ad) => ad.metaAdId));
  const next = labNextStep({
    lineupCount: lab.lineupRows.length,
    unclearedWithClips: lab.lineupRows.some((row) => row.clipCount > 0 && !row.clearedAt),
    captionsWaiting: lab.captions.some((caption) => caption.status === "proposed"),
    roundReady: lab.captions.some((caption) => caption.status === "approved") && lab.clips.length > 0 && !running,
    runningRound: running?.roundNo ?? null,
    clipCount: lab.clips.length,
  });

  return (
    <details className="rounded-lg border border-border bg-card" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Creative Lab</summary>
      <div className="space-y-6 border-t border-border px-4 py-4 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        <LabStrip lineup={lab.lineupRows.length} clips={lab.clips.length} captions={lab.captions.length} round={lab.rounds[0]?.roundNo ?? null} next={next} />
        {!lab.facts || lab.facts.headliners.length === 0 ? <p>headliners not set</p> : null}
        <LabLineup eventId={lab.eventId} rows={lab.lineupRows} artists={lab.artists} adAccountId={lab.adAccountId} busy={busy} onSave={(body) => run(body)} />

        <section id="lab-clips" className="space-y-3">
          <h3 className="font-medium">Clips</h3>
          {lab.clips.length === 0 ? <p className="text-muted-foreground">No clips.</p> : null}
          <ul className="space-y-1">
            {lab.clips.map((clip) => (
              <li key={clip.id}>
                #{clip.clipNo} {clip.source} · {clip.rightsRef}
                {clip.durationSeconds != null ? ` · ${clip.durationSeconds.toFixed(1)}s` : ""}
                {clip.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- storage thumbnail, not a static asset
                  <img src={clip.thumbnailUrl} alt="" className="mt-1 h-16 w-10 object-cover" />
                ) : null}
              </li>
            ))}
          </ul>
          <ClipForm lab={lab} busy={busy} onError={setError} onDone={() => router.refresh()} />
        </section>

        <section id="lab-captions" className="space-y-3">
          <h3 className="font-medium">Captions</h3>
          <GenerateForm lab={lab} busy={busy} onRun={run} />
          <ul className="space-y-3">
            {lab.captions.map((caption) => (
              <li key={caption.id} className="rounded border border-border p-2">
                <p className="text-muted-foreground">{caption.style} · {caption.status} · {caption.sizeVariant} · {caption.validatorOk ? "passed" : caption.validatorDetail}</p>
                <p>{caption.lines.join(" / ")}</p>
                <p>{caption.primaryText}</p>
                {caption.awaitingLong ? <p>awaiting long-size approval</p> : null}
                {caption.status === "proposed" ? (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" disabled={busy} onClick={() => run({ action: "setCaptionStatus", captionId: caption.id, status: "approved" })}>Approve</Button>
                    <Button type="button" disabled={busy} onClick={() => run({ action: "setCaptionStatus", captionId: caption.id, status: "rejected" })}>Reject</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section id="lab-round" className="space-y-3">
          <h3 className="font-medium">Rounds</h3>
          {!lab.launchesEnabled ? (
            <Button type="button" disabled>
              Lab launches are switched off
            </Button>
          ) : null}
          {lab.rounds.length === 0 ? <p className="text-muted-foreground">No rounds.</p> : null}
          <ProposeForm lab={lab} busy={busy} onRun={run} />
          {lab.rounds.map((round) => {
            const rightsOff = !round.artistApproved;
            const pending = round.rendersPending;
            const reason = launchReason || (rightsOff ? "Rights are not approved" : pending ? "Renders are still pending" : null);
            return (
              <div key={round.id} className="rounded border border-border p-2">
                <p>Round {round.roundNo} · {round.artistName} · {round.status}</p>
                <ul className="mt-2 space-y-1">
                  {round.ads.map((ad) => (
                    <li key={ad.id}>
                      {ad.role} · {ad.adName} · {ad.launchState}
                      {ad.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- storage thumbnail, not a static asset
                        <img src={ad.thumbnailUrl} alt="" className="mt-1 h-16 w-10 object-cover" />
                      ) : null}
                      {ad.metaAdId ? <span> · {ad.metaAdId}</span> : null}
                      {ad.adsManagerUrl ? <a className="ml-2 underline" href={ad.adsManagerUrl} target="_blank" rel="noreferrer">Open in Ads Manager</a> : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  {round.status === "draft" ? <Button type="button" disabled={busy} onClick={() => run({ action: "approveRound", roundId: round.id })}>Approve</Button> : null}
                  <Button
                    type="button"
                    disabled={busy || Boolean(reason) || (round.status !== "approved" && round.status !== "draft")}
                    title={reason ?? undefined}
                    onClick={async () => {
                      if (round.status === "draft") {
                        const approved = await run({ action: "approveRound", roundId: round.id });
                        if (!approved?.ok) return;
                      }
                      const res = await fetch(`/api/creative-lab/rounds/${round.id}/launch`, { method: "POST" });
                      const json = (await res.json()) as { error?: string };
                      if (!res.ok) setError(json.error || "Launch failed");
                      router.refresh();
                    }}
                  >
                    {reason ?? "Approve & launch (paused)"}
                  </Button>
                  <Button type="button" disabled={busy} onClick={async () => {
                    const result = await run({ action: "judge", roundId: round.id, apply: false });
                    setJudgeTable(JSON.stringify(result?.json.verdicts ?? [], null, 2));
                  }}>Judge now</Button>
                  <Button type="button" disabled={busy} onClick={() => run({ action: "judge", roundId: round.id, apply: true })}>Write verdicts</Button>
                </div>
                {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
              </div>
            );
          })}
          {judgeTable ? <pre className="overflow-auto rounded bg-muted p-2 text-xs">{judgeTable}</pre> : null}
        </section>
      </div>
    </details>
  );
}


function ClipForm({ lab, busy, onError, onDone }: { lab: CreativeLabCardData; busy: boolean; onError: (message: string) => void; onDone: () => void }) {
  const [artistId, setArtistId] = useState(lab.artists[0]?.id ?? "");
  const [source, setSource] = useState("");
  const [rightsRef, setRightsRef] = useState("");
  const [permalinks, setPermalinks] = useState("");
  const [filmedEventId, setFilmedEventId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [working, setWorking] = useState(false);
  const instagram = source.trim().toLowerCase() === "instagram";
  const artist = lab.artists.find((row) => row.id === artistId);

  function chooseArtist(next: string) {
    setArtistId(next);
    if (instagram && !rightsRef.trim()) {
      const picked = lab.artists.find((row) => row.id === next);
      if (picked?.rightsDocRef) setRightsRef(picked.rightsDocRef);
    }
  }

  function chooseSource(next: string) {
    setSource(next);
    if (next.trim().toLowerCase() === "instagram" && !rightsRef.trim() && artist?.rightsDocRef) setRightsRef(artist.rightsDocRef);
  }

  async function upload(file: File) {
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
      const result = await post(lab.eventId, {
        action: "addClip",
        artistId,
        source,
        rightsRef: rightsRef || (instagram ? artist?.rightsDocRef ?? "" : ""),
        permalinks: instagram ? permalinks.split(/\n/).map((line) => line.trim()).filter(Boolean) : [],
        filmedEventId: filmedEventId || null,
        durationSeconds: duration,
        newAsset: { filename: file.name, storagePath, contentHash, byteSize: file.size, durationSeconds: duration },
      });
      if (!result.ok) onError(String(result.json.error || "Upload failed"));
      else onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid gap-2">
      <select className="rounded border border-border bg-background p-2" value={artistId} onChange={(e) => chooseArtist(e.target.value)}>
        {lab.artists.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      <input className="rounded border border-border bg-background p-2" placeholder="Source" value={source} onChange={(e) => chooseSource(e.target.value)} />
      {instagram ? <textarea className="rounded border border-border bg-background p-2" rows={3} placeholder="Instagram post permalinks, one per line" value={permalinks} onChange={(e) => setPermalinks(e.target.value)} /> : null}
      <input className="rounded border border-border bg-background p-2" placeholder="Rights ref" value={rightsRef} onChange={(e) => setRightsRef(e.target.value)} />
      <select className="rounded border border-border bg-background p-2" value={filmedEventId} onChange={(e) => setFilmedEventId(e.target.value)}>
        <option value="">Filmed at (optional)</option>
        {lab.clientEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
      </select>
      <select className="rounded border border-border bg-background p-2" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
        <option value="">Existing video</option>
        {lab.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
      </select>
      <Button type="button" disabled={busy || working || !source.trim() || (!rightsRef.trim() && !(instagram && artist?.rightsDocRef)) || !assetId} onClick={async () => {
        const result = await post(lab.eventId, {
          action: "addClip",
          artistId,
          source,
          rightsRef: rightsRef || (instagram ? artist?.rightsDocRef ?? "" : ""),
          permalinks: instagram ? permalinks.split(/\n/).map((line) => line.trim()).filter(Boolean) : [],
          filmedEventId: filmedEventId || null,
          creativeAssetId: assetId,
        });
        if (!result.ok) onError(String(result.json.error || "Could not add the clip"));
        else onDone();
      }}>Add clip</Button>
      <input type="file" accept="video/mp4,video/*" disabled={busy || working} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
    </div>
  );
}

function GenerateForm({ lab, busy, onRun }: { lab: CreativeLabCardData; busy: boolean; onRun: (body: Record<string, unknown>) => Promise<unknown> }) {
  const [style, setStyle] = useState<(typeof STYLES)[number]>("lineup");
  const [n, setN] = useState(3);
  const [clipId, setClipId] = useState("");
  const [stage, setStage] = useState("on_sale");
  const lags = lab.eventStatus !== "on_sale";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <select className="rounded border border-border bg-background p-2" value={style} onChange={(e) => setStyle(e.target.value as (typeof STYLES)[number])}>
        {STYLES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <input className="w-16 rounded border border-border bg-background p-2" type="number" min={1} max={6} value={n} onChange={(e) => setN(Number(e.target.value))} />
      <select className="rounded border border-border bg-background p-2" value={clipId} onChange={(e) => setClipId(e.target.value)}>
        <option value="">No clip</option>
        {lab.clips.map((clip) => <option key={clip.id} value={clip.id}>Clip {clip.clipNo}</option>)}
      </select>
      {lags ? (
        <select className="rounded border border-border bg-background p-2" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">events.status ({lab.eventStatus || "unset"})</option>
          <option value="on_sale">on sale</option>
          <option value="signup">signup</option>
          <option value="upcoming">upcoming</option>
        </select>
      ) : null}
      <Button type="button" disabled={busy} onClick={() => onRun({ action: "generate", style, n, clipId: clipId || null, stageOverride: lags && stage ? stage : null })}>Generate</Button>
    </div>
  );
}

function ProposeForm({ lab, busy, onRun }: { lab: CreativeLabCardData; busy: boolean; onRun: (body: Record<string, unknown>) => Promise<unknown> }) {
  const [artistId, setArtistId] = useState(lab.artists[0]?.id ?? "");
  const [adSetId, setAdSetId] = useState(lab.adSets[0]?.metaAdSetId ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <select className="rounded border border-border bg-background p-2" value={artistId} onChange={(e) => setArtistId(e.target.value)}>
        {lab.artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name} · {artist.rightsLabel}</option>)}
      </select>
      <select className="rounded border border-border bg-background p-2" value={adSetId} onChange={(e) => setAdSetId(e.target.value)}>
        {lab.adSets.map((adSet) => <option key={adSet.metaAdSetId} value={adSet.metaAdSetId}>{adSet.name} · {adSet.status} · {adSet.adCount}/50</option>)}
      </select>
      <Button type="button" disabled={busy || !artistId || !adSetId} onClick={() => onRun({ action: "propose", artistId, adsetMetaId: adSetId })}>Propose round</Button>
    </div>
  );
}

function fileDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}
