"use client";

import { useEffect, useState } from "react";
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
            <ArtistRow key={`${artist.id}:${artist.rightsLabel}:${artist.startingCaption ?? ""}:${artist.playedCities.join("|")}`} artist={artist} adAccountId={lab.adAccountId} busy={busy} onSave={(body) => run(body)} />
          ))}
          <ArtistRow artist={null} adAccountId={lab.adAccountId} busy={busy} onSave={(body) => run(body)} />
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

function pageLabel(page: { id: string; name: string }): string {
  return `${page.name} · ${page.id}`;
}

function igLabelOf(account: { igActorId?: string; username?: string; name?: string }): string {
  const id = account.igActorId?.trim() ?? "";
  const name = account.username?.trim() || account.name?.trim() || "";
  return [name, id].filter(Boolean).join(" · ");
}

function ArtistRow({
  artist,
  adAccountId,
  busy,
  onSave,
}: {
  artist: CreativeLabCardData["artists"][number] | null;
  adAccountId: string | null;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const router = useRouter();
  const [name, setName] = useState(artist?.name ?? "");
  const [ref, setRef] = useState(artist?.rightsDocRef ?? "");
  const [caption, setCaption] = useState(artist?.startingCaption ?? "");
  const [cities, setCities] = useState((artist?.playedCities ?? []).join("\n"));
  const [folderUrl, setFolderUrl] = useState(artist?.clipFolderUrl ?? "");
  const [clipSource, setClipSource] = useState(artist?.clipSource ?? "file");
  const [folderNote, setFolderNote] = useState(artist?.clipFolderLastError ?? "");
  const [importedFiles, setImportedFiles] = useState<{ name: string; outcome: string; reason: string | null }[]>([]);
  const [importing, setImporting] = useState(false);
  const [finding, setFinding] = useState(false);
  const [igError, setIgError] = useState<string | null>(null);
  const [artistVoice, setArtistVoice] = useState(Boolean(artist?.metaPageId));
  const [pageId, setPageId] = useState(artist?.metaPageId ?? "");
  const [instagramActorId, setInstagramActorId] = useState(artist?.instagramActorId ?? "");
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [igLabel, setIgLabel] = useState(artist?.instagramActorId ?? "");
  const [pageNote, setPageNote] = useState("");
  const [igNote, setIgNote] = useState("");

  useEffect(() => {
    if (!adAccountId) return;
    let cancelled = false;
    void fetch(`/api/meta/pages?adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(async (res) => ({ ok: res.ok, json: (await res.json()) as { pages?: { id: string; name: string }[]; error?: string } }))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          setPageNote(json.error || "Could not load Pages.");
          setPages([]);
          return;
        }
        setPageNote("");
        setPages(json.pages ?? []);
      })
      .catch(() => {
        if (!cancelled) setPageNote("Could not load Pages.");
      });
    return () => {
      cancelled = true;
    };
  }, [adAccountId]);

  useEffect(() => {
    if (!adAccountId || !pageId) return;
    let cancelled = false;
    void fetch(`/api/meta/page-identity?pageId=${encodeURIComponent(pageId)}&adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(async (res) => ({ ok: res.ok, json: (await res.json()) as { ig?: { state?: string; account?: { igActorId?: string; username?: string; name?: string } } } }))
      .then(({ ok, json }) => {
        if (cancelled || !ok || json.ig?.state !== "linked" || !json.ig.account?.igActorId) return;
        setIgLabel(igLabelOf(json.ig.account));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [adAccountId, pageId]);

  async function choosePage(next: string) {
    if (next === pageId) return;
    const savedPage = artist?.metaPageId ?? "";
    const pageChanged = next !== savedPage;
    setPageId(next);
    if (next) setArtistVoice(true);
    if (!pageChanged) {
      setInstagramActorId(artist?.instagramActorId ?? "");
      setIgLabel(artist?.instagramActorId ?? "");
    } else {
      setInstagramActorId("");
      setIgLabel("");
    }
    setIgNote("");
    if (!next || !adAccountId) return;
    const res = await fetch(`/api/meta/page-identity?pageId=${encodeURIComponent(next)}&adAccountId=${encodeURIComponent(adAccountId)}`);
    const json = (await res.json()) as {
      error?: string;
      ig?: { state?: string; reason?: string; account?: { igActorId?: string; username?: string; name?: string } };
    };
    if (!res.ok) {
      setIgNote(json.error || "Could not resolve the Instagram account.");
      return;
    }
    if (json.ig?.state === "linked" && json.ig.account?.igActorId) {
      if (pageChanged) setInstagramActorId(json.ig.account.igActorId);
      setIgLabel(igLabelOf(json.ig.account));
      return;
    }
    if (json.ig?.state === "no_ig") {
      setIgNote("This Page has no Instagram account.");
      return;
    }
    setIgNote(json.ig?.reason || "Instagram account unresolved.");
  }

  return (
    <div className="rounded border border-border p-2">
      {artist ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={artist.rights === "approved"} disabled={busy || importing || finding} onChange={(e) => void onSave({ action: "setCleared", artistId: artist.id, cleared: e.target.checked })} />
          Cleared
        </label>
      ) : <p className="text-muted-foreground">New artist. Save, then tick Cleared.</p>}
      <div className="mt-2 grid gap-2">
        <input className="rounded border border-border bg-background p-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <details>
          <summary>Edit note</summary>
          <input className="mt-1 w-full rounded border border-border bg-background p-2" placeholder="Note (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
        </details>
        <input className="rounded border border-border bg-background p-2" placeholder="Starting caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <label className="block">Played before (cities)<textarea className="mt-1 w-full rounded border border-border bg-background p-2" rows={2} value={cities} onChange={(e) => setCities(e.target.value)} /></label>
        <label className="block">Clip folder (Drive or Dropbox link)
          <input className="mt-1 w-full rounded border border-border bg-background p-2" value={folderUrl} onChange={(e) => setFolderUrl(e.target.value)} />
        </label>
        <label className="block">Clip source
          <select className="mt-1 w-full rounded border border-border bg-background p-2" value={clipSource} onChange={(e) => setClipSource(e.target.value)}>
            <option value="file">file</option>
            <option value="instagram">instagram — artist feed</option>
            <option value="spark">spark</option>
            <option value="presskit">presskit</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={artistVoice || Boolean(pageId)} onChange={(e) => setArtistVoice(e.target.checked)} disabled={Boolean(pageId)} />
          Artist voice
        </label>
        {adAccountId ? (
          <select className="rounded border border-border bg-background p-2" value={pageId} onChange={(e) => void choosePage(e.target.value)}>
            <option value="">Artist Page</option>
            {pageId && !pages.some((page) => page.id === pageId) ? <option value={pageId}>{pageId}</option> : null}
            {pages.map((page) => <option key={page.id} value={page.id}>{pageLabel(page)}</option>)}
          </select>
        ) : (
          <p className="text-muted-foreground">No ad account on this client.</p>
        )}
        {pageNote ? <p className="text-muted-foreground">{pageNote}</p> : null}
        <p className="text-muted-foreground">{igLabel ? `Instagram ${igLabel}` : igNote || "No artist Instagram account yet."}</p>
        {folderNote ? <p>{folderNote}</p> : null}
        {(igError || artist?.igLastError) ? <p>{igError || artist?.igLastError}</p> : null}
        {artist && artist.igCandidates.length > 0 ? (
          <ul className="space-y-1">
            {artist.igCandidates.map((clip) => (
              <li key={clip.igMediaId}>
                {clip.permalink ? <a href={clip.permalink}>{clip.postedAt || clip.permalink}</a> : (clip.postedAt || "undated")}
                {` · ${clip.likes ?? "likes hidden"} likes · ${clip.comments ?? 0} comments · ${clip.score == null ? "no score" : clip.score.toFixed(4)}`}
                {` · ${clip.hasFile ? "file available" : "request from team"}`}
                {` · ${clip.audioMatch == null ? "music unknown" : clip.audioMatch ? "music match" : "no music match"}`}
                {clip.status === "requested" ? " · requested" : ""}
                {!clip.hasFile && clip.status === "candidate" ? (
                  <Button type="button" disabled={busy} onClick={() => onSave({ action: "requestIgCandidate", artistId: artist.id, igMediaId: clip.igMediaId })}>Request from team</Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {importedFiles.length > 0 ? (
          <ul className="space-y-1">
            {importedFiles.map((file, index) => (
              <li key={`${file.name}:${index}`}>{file.name}: {file.outcome}{file.reason ? ` — ${file.reason}` : ""}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" disabled={busy || importing} onClick={async () => {
          const result = await onSave({ action: "saveArtist", artistId: artist?.id, name, rightsDocRef: ref, startingCaption: caption, playedCities: linesOf(cities), clipFolderUrl: folderUrl, clipSource, metaPageId: pageId || null, instagramActorId: instagramActorId || null, artistVoice: artistVoice || Boolean(pageId) }) as { ok?: boolean; json?: { clipImport?: { files?: { name: string; outcome: string; reason: string | null }[]; folderError?: string | null }; clipImportError?: string | null } } | undefined;
          const clipImport = result?.json?.clipImport;
          if (result?.json?.clipImportError) setFolderNote(result.json.clipImportError);
          else if (clipImport?.folderError) setFolderNote(clipImport.folderError);
          else if (clipImport) setFolderNote("");
          if (clipImport?.files) setImportedFiles(clipImport.files);
        }}>Save</Button>
        {artist ? (
          <Button type="button" disabled={busy || importing || !folderUrl.trim()} onClick={async () => {
            setImporting(true);
            setFolderNote("");
            try {
              const res = await fetch(`/api/creative-lab/artists/${artist.id}/import-clips`, { method: "POST" });
              const json = (await res.json()) as { error?: string; folderError?: string | null; files?: { name: string; outcome: string; reason: string | null }[] };
              if (!res.ok) {
                setFolderNote(json.error || "Could not import clips.");
                return;
              }
              setImportedFiles(json.files ?? []);
              setFolderNote(json.folderError || "");
              router.refresh();
            } catch {
              setFolderNote("Could not import clips.");
            } finally {
              setImporting(false);
            }
          }}>{importing ? "Importing…" : "Import clips"}</Button>
        ) : null}
        {artist ? (
          <Button type="button" disabled={busy || finding || importing || artist.rights !== "approved"} onClick={async () => {
            setFinding(true);
            setIgError(null);
            try {
              const res = await fetch(`/api/creative-lab/artists/${artist.id}/find-clips`, { method: "POST" });
              const json = (await res.json()) as { error?: string | null };
              if (!res.ok || json.error) {
                setIgError(json.error || "Could not find clips.");
                return;
              }
              router.refresh();
            } catch {
              setIgError("Could not find clips.");
            } finally {
              setFinding(false);
            }
          }}>{finding ? "Finding…" : "Find clips on Instagram"}</Button>
        ) : null}
      </div>
    </div>
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
