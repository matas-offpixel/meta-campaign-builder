"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
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

function linesOf(value: string): string[] {
  return value.split(/\n|,/).map((name) => name.trim()).filter(Boolean);
}

export function CreativeLabCard({ lab }: { lab: CreativeLabCardData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lineup, setLineup] = useState((lab.facts?.lineup ?? []).join("\n"));
  const [headliners, setHeadliners] = useState((lab.facts?.headliners ?? []).join("\n"));
  const [dates, setDates] = useState((lab.facts?.allowedDates ?? []).join("\n"));
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
      router.refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }

  const launchReason = !lab.launchesEnabled
    ? "Lab launches are switched off"
    : null;

  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Creative Lab</summary>
      <div className="space-y-6 border-t border-border px-4 py-4 text-sm">
        <p className="text-muted-foreground">
          Next payday {lab.paydayLabel}. {lab.daysToEvent == null ? "No event date." : `${lab.daysToEvent} days to the event.`}
        </p>
        {error ? <p className="text-destructive">{error}</p> : null}

        <section className="space-y-2">
          <h3 className="font-medium">Facts</h3>
          {!lab.facts || lab.facts.headliners.length === 0 ? <p>headliners not set</p> : null}
          <label className="block">Lineup<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={4} value={lineup} onChange={(e) => setLineup(e.target.value)} /></label>
          <label className="block">Headliners, in draw order<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={3} value={headliners} onChange={(e) => setHeadliners(e.target.value)} /></label>
          <label className="block">Allowed dates<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={2} value={dates} onChange={(e) => setDates(e.target.value)} /></label>
          <Button type="button" disabled={busy} onClick={() => run({ action: "saveFacts", lineup: linesOf(lineup), headliners: linesOf(headliners), allowedDates: linesOf(dates) })}>Save facts</Button>
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">Artists</h3>
          {lab.artists.map((artist) => (
            <ArtistRow key={`${artist.id}:${artist.rightsLabel}:${artist.startingCaption ?? ""}`} artist={artist} busy={busy} onSave={(body) => run(body)} />
          ))}
          <ArtistRow artist={null} busy={busy} onSave={(body) => run(body)} />
        </section>

        <section className="space-y-3">
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

        <section className="space-y-3">
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

        <section className="space-y-3">
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

function ArtistRow({
  artist,
  busy,
  onSave,
}: {
  artist: CreativeLabCardData["artists"][number] | null;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [name, setName] = useState(artist?.name ?? "");
  const [ref, setRef] = useState(artist?.rightsDocRef ?? "");
  const [caption, setCaption] = useState(artist?.startingCaption ?? "");
  return (
    <div className="rounded border border-border p-2">
      {artist ? <p>{artist.rightsLabel}</p> : <p className="text-muted-foreground">New artist</p>}
      <div className="mt-2 grid gap-2">
        <input className="rounded border border-border bg-background p-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded border border-border bg-background p-2" placeholder="Rights ref" value={ref} onChange={(e) => setRef(e.target.value)} />
        <input className="rounded border border-border bg-background p-2" placeholder="Starting caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" disabled={busy} onClick={() => onSave({ action: "saveArtist", artistId: artist?.id, name, rightsDocRef: ref, startingCaption: caption })}>Save</Button>
        {artist && artist.rights !== "approved" ? (
          <Button type="button" disabled={busy || !ref.trim() || !caption.trim()} onClick={() => onSave({ action: "approveArtist", artistId: artist.id })}>Approve rights</Button>
        ) : null}
      </div>
    </div>
  );
}

function ClipForm({ lab, busy, onError, onDone }: { lab: CreativeLabCardData; busy: boolean; onError: (message: string) => void; onDone: () => void }) {
  const [artistId, setArtistId] = useState(lab.artists[0]?.id ?? "");
  const [source, setSource] = useState("");
  const [rightsRef, setRightsRef] = useState("");
  const [filmedEventId, setFilmedEventId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [working, setWorking] = useState(false);

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
        rightsRef,
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
      <select className="rounded border border-border bg-background p-2" value={artistId} onChange={(e) => setArtistId(e.target.value)}>
        {lab.artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
      </select>
      <input className="rounded border border-border bg-background p-2" placeholder="Source" value={source} onChange={(e) => setSource(e.target.value)} />
      <input className="rounded border border-border bg-background p-2" placeholder="Rights ref" value={rightsRef} onChange={(e) => setRightsRef(e.target.value)} />
      <select className="rounded border border-border bg-background p-2" value={filmedEventId} onChange={(e) => setFilmedEventId(e.target.value)}>
        <option value="">Filmed at (optional)</option>
        {lab.clientEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
      </select>
      <select className="rounded border border-border bg-background p-2" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
        <option value="">Existing video</option>
        {lab.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
      </select>
      <Button type="button" disabled={busy || working || !source.trim() || !rightsRef.trim() || !assetId} onClick={async () => {
        const result = await post(lab.eventId, { action: "addClip", artistId, source, rightsRef, filmedEventId: filmedEventId || null, creativeAssetId: assetId });
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
