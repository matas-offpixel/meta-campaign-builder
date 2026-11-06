"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { LabLineupRow } from "@/lib/db/creative-lab";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { clearedOn, type LibrarySuggestion, type SpotifySuggestion } from "@/lib/creative-lab/lineup";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function handles(row: LabLineupRow): string {
  return [row.instagramHandle ? `@${row.instagramHandle.replace(/^@/, "")}` : "", row.tiktokHandle ? `TikTok @${row.tiktokHandle.replace(/^@/, "")}` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function LabLineup({
  eventId,
  rows,
  artists,
  adAccountId,
  busy,
  onSave,
}: {
  eventId: string;
  rows: LabLineupRow[];
  artists: CreativeLabCardData["artists"];
  adAccountId: string | null;
  busy: boolean;
  onSave: Save;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(rows);
  const [dragId, setDragId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<LibrarySuggestion[]>([]);
  const [spotify, setSpotify] = useState<SpotifySuggestion[]>([]);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setOrder(rows);
  }, [rows]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (!query.trim()) {
        setLibrary([]);
        setSpotify([]);
        setSpotifyError(null);
        return;
      }
      void fetch(`/api/creative-lab/events/${eventId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "suggest", query }),
      })
        .then(async (res) => ({ ok: res.ok, json: (await res.json()) as { library?: LibrarySuggestion[]; spotify?: SpotifySuggestion[]; spotifyError?: string | null; error?: string } }))
        .then(({ ok, json }) => {
          if (!ok) {
            setSpotifyError(json.error || "Could not search.");
            return;
          }
          setLibrary(json.library ?? []);
          setSpotify(json.spotify ?? []);
          setSpotifyError(json.spotifyError ?? null);
        })
        .catch(() => setSpotifyError("Could not search."));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [eventId, query]);

  function saveOrder(next: LabLineupRow[]) {
    setOrder(next);
    void onSave({
      action: "saveLineup",
      slots: next.map((row) => ({ artistId: row.artistId, isHeadliner: row.isHeadliner })),
    });
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = order.findIndex((row) => row.artistId === dragId);
    const to = order.findIndex((row) => row.artistId === targetId);
    if (from < 0 || to < 0) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    setDragId(null);
    saveOrder(next);
  }

  async function addLibrary(suggestion: LibrarySuggestion) {
    if (suggestion.added) return;
    setQuery("");
    await onSave({
      action: "saveLineup",
      slots: [...order.map((row) => ({ artistId: row.artistId, isHeadliner: row.isHeadliner })), { artistId: suggestion.id, isHeadliner: false }],
    });
  }

  async function addSpotify(suggestion: SpotifySuggestion) {
    if (suggestion.added) return;
    setQuery("");
    await onSave({ action: "addSpotify", spotify: suggestion });
  }

  return (
    <section id="lab-lineup" className="space-y-3">
      <h3 className="font-medium">Lineup</h3>
      <label className="block">
        <span className="text-muted-foreground">Add with @</span>
        <input
          className="mt-1 w-full rounded border border-border bg-background p-2"
          value={query}
          placeholder="@ artist"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {library.length > 0 || spotify.length > 0 ? (
        <ul className="rounded border border-border">
          {library.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className={`block w-full px-2 py-1 text-left ${suggestion.added ? "text-muted-foreground" : ""}`}
                disabled={busy || suggestion.added}
                onClick={() => void addLibrary(suggestion)}
              >
                {suggestion.name}{suggestion.added ? " · added" : ""}
              </button>
            </li>
          ))}
          {spotify.map((suggestion) => (
            <li key={suggestion.spotifyId}>
              <button
                type="button"
                className="block w-full px-2 py-1 text-left"
                disabled={busy || suggestion.added}
                onClick={() => void addSpotify(suggestion)}
              >
                {suggestion.name} · Spotify{suggestion.added ? " · added" : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {spotifyError ? <p>{spotifyError}</p> : null}
      {order.length === 0 ? <p className="text-muted-foreground">No lineup yet.</p> : null}
      <ul className="space-y-2">
        {order.map((row) => {
          const artist = artists.find((item) => item.id === row.labArtistId);
          const hasInstagram = Boolean(row.instagramHandle || artist?.instagramActorId);
          return (
            <li
              key={row.artistId}
              draggable
              onDragStart={() => setDragId(row.artistId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropOn(row.artistId)}
              className="rounded border border-border bg-card p-2"
            >
              <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                <button
                  type="button"
                  className={row.isHeadliner ? "text-foreground" : "text-muted-foreground"}
                  aria-label={row.isHeadliner ? "Headliner" : "Mark headliner"}
                  disabled={busy}
                  onClick={() => saveOrder(order.map((item) => item.artistId === row.artistId ? { ...item, isHeadliner: !item.isHeadliner } : item))}
                >
                  ★
                </button>
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- artist photo from the stored profile
                  <img src={row.imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-xs">{initials(row.name)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.name}</p>
                  {handles(row) ? <p className="text-muted-foreground">{handles(row)}</p> : null}
                  <Rights row={row} />
                  <p className="tabular-nums text-muted-foreground">{row.clipCount} {row.clipCount === 1 ? "clip" : "clips"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <RowAction row={row} artist={artist} hasInstagram={hasInstagram} busy={busy} onSave={onSave} onEdit={() => setOpen(row.artistId)} onFound={() => router.refresh()} />
                  <details className="relative">
                    <summary className="cursor-pointer list-none">⋯</summary>
                    <div className="absolute right-0 z-10 mt-1 w-64 rounded border border-border bg-card p-2">
                      <button type="button" className="block w-full py-1 text-left" onClick={() => setOpen(open === row.artistId ? null : row.artistId)}>Edit</button>
                      {row.labArtistId && row.clearedAt ? (
                        <button type="button" className="block w-full py-1 text-left" disabled={busy} onClick={() => void onSave({ action: "clearLibrary", libraryArtistId: row.artistId, name: row.name, cleared: false })}>Remove clearance</button>
                      ) : null}
                      <button
                        type="button"
                        className="block w-full py-1 text-left text-destructive"
                        disabled={busy}
                        onClick={() => saveOrder(order.filter((item) => item.artistId !== row.artistId))}
                      >
                        Remove from lineup
                      </button>
                    </div>
                  </details>
                </div>
              </div>
              <Profile row={row} />
              {open === row.artistId ? (
                <EditRow row={row} artist={artist} adAccountId={adAccountId} busy={busy} onSave={onSave} />
              ) : null}
              {artist && artist.igCandidates.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {artist.igCandidates.map((clip) => (
                    <li key={clip.igMediaId}>
                      {clip.permalink ? <a href={clip.permalink}>{clip.postedAt || clip.permalink}</a> : (clip.postedAt || "undated")}
                      {` · ${clip.aspect || "aspect unknown"} · ${clip.likes ?? "likes hidden"} likes · ${clip.comments ?? 0} comments`}
                      {!clip.hasFile && clip.status === "candidate" ? (
                        <Button type="button" disabled={busy} onClick={() => onSave({ action: "requestIgCandidate", artistId: artist.id, igMediaId: clip.igMediaId })}>Request from team</Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Rights({ row }: { row: LabLineupRow }) {
  if (row.clearedAt) {
    const when = clearedOn(row.clearedAt);
    return (
      <p>
        <span className="text-success">✓ Cleared{row.clearedBy ? ` · ${row.clearedBy}` : ""}, {when}</span>
        {row.rightsNote ? <span className="text-muted-foreground"> · {row.rightsNote}</span> : null}
      </p>
    );
  }
  if (row.labArtistId) return <p>○ Not cleared</p>;
  return <p className="text-muted-foreground">— Not needed: no clips</p>;
}

function RowAction({
  row,
  artist,
  hasInstagram,
  busy,
  onSave,
  onEdit,
  onFound,
}: {
  row: LabLineupRow;
  artist: CreativeLabCardData["artists"][number] | undefined;
  hasInstagram: boolean;
  busy: boolean;
  onSave: Save;
  onEdit: () => void;
  onFound: () => void;
}) {
  if (!row.clearedAt) {
    return <Button type="button" disabled={busy} onClick={() => onSave({ action: "clearLibrary", libraryArtistId: row.artistId, name: row.name, cleared: true })}>Mark cleared</Button>;
  }
  if (!hasInstagram) return <Button type="button" disabled={busy} onClick={onEdit}>Add Instagram</Button>;
  return (
    <Button
      type="button"
      disabled={busy || !artist}
      onClick={async () => {
        if (!artist) return;
        await fetch(`/api/creative-lab/artists/${artist.id}/find-clips`, { method: "POST" });
        onFound();
      }}
    >
      Find clips
    </Button>
  );
}

function Profile({ row }: { row: LabLineupRow }) {
  const when = row.enrichedAt ? clearedOn(row.enrichedAt) : null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-muted-foreground">ⓘ</summary>
      <div className="mt-1 rounded border border-dashed border-border p-2">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored profile photo
          <img src={row.imageUrl} alt="" className="mb-2 h-16 w-16 rounded object-cover" />
        ) : null}
        <p>{row.genres.length ? row.genres.join(", ") : "No genres stored."}</p>
        <p>{row.playedBefore.length ? `Played before: ${row.playedBefore.join(", ")}` : "No played-before cities stored."}</p>
        {when ? <p className="text-muted-foreground">Enriched {when}</p> : null}
      </div>
    </details>
  );
}

function EditRow({
  row,
  artist,
  adAccountId,
  busy,
  onSave,
}: {
  row: LabLineupRow;
  artist: CreativeLabCardData["artists"][number] | undefined;
  adAccountId: string | null;
  busy: boolean;
  onSave: Save;
}) {
  const [caption, setCaption] = useState(artist?.startingCaption ?? "");
  const [cities, setCities] = useState((artist?.playedCities ?? []).join(", "));
  const [folder, setFolder] = useState(artist?.clipFolderUrl ?? "");
  const [source, setSource] = useState(artist?.clipSource ?? "file");
  const [voice, setVoice] = useState(Boolean(artist?.metaPageId));
  const [pageId, setPageId] = useState(artist?.metaPageId ?? row.metaPageId ?? "");
  const [actorId, setActorId] = useState(artist?.instagramActorId ?? "");
  const [pages, setPages] = useState<{ id: string; name?: string }[]>([]);

  useEffect(() => {
    if (!adAccountId) return;
    let cancelled = false;
    void fetch(`/api/meta/pages?adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(async (res) => (res.ok ? (await res.json()) as { pages?: { id: string; name?: string }[] } : { pages: [] }))
      .then((json) => {
        if (!cancelled) setPages(json.pages ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [adAccountId]);

  useEffect(() => {
    if (!adAccountId || !pageId) return;
    let cancelled = false;
    void fetch(`/api/meta/page-identity?pageId=${encodeURIComponent(pageId)}&adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(async (res) => (res.ok ? await res.json() as { ig?: { state?: string; account?: { igActorId?: string } } } : null))
      .then((json) => {
        if (cancelled) return;
        const actor = json?.ig?.state === "linked" ? json.ig.account?.igActorId ?? "" : "";
        if (actor) setActorId(actor);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [adAccountId, pageId]);

  return (
    <div className="mt-2 grid gap-2">
      <label className="block">Played before
        <input className="mt-1 w-full rounded border border-border bg-background p-2" value={cities} onChange={(event) => setCities(event.target.value)} />
      </label>
      <label className="block">Starting caption
        <input className="mt-1 w-full rounded border border-border bg-background p-2" value={caption} onChange={(event) => setCaption(event.target.value)} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={voice || Boolean(pageId)} disabled={Boolean(pageId)} onChange={(event) => setVoice(event.target.checked)} />
        Artist voice
      </label>
      {adAccountId ? (
        <select className="rounded border border-border bg-background p-2" value={pageId} onChange={(event) => { setPageId(event.target.value); if (event.target.value) setVoice(true); }}>
          <option value="">Page</option>
          {pages.map((page) => <option key={page.id} value={page.id}>{page.name || page.id}</option>)}
        </select>
      ) : <p className="text-muted-foreground">No ad account on this client.</p>}
      <label className="block">Clip folder
        <input className="mt-1 w-full rounded border border-border bg-background p-2" value={folder} onChange={(event) => setFolder(event.target.value)} />
      </label>
      <label className="block">Clip source
        <select className="mt-1 w-full rounded border border-border bg-background p-2" value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="file">file</option>
          <option value="instagram">instagram — artist feed</option>
          <option value="spark">spark</option>
          <option value="presskit">presskit</option>
        </select>
      </label>
      <Button
        type="button"
        disabled={busy}
        onClick={() => onSave({
          action: "saveLineupArtist",
          libraryArtistId: row.artistId,
          name: row.name,
          startingCaption: caption,
          playedCities: cities.split(/,|\n/).map((city) => city.trim()).filter(Boolean),
          clipFolderUrl: folder,
          clipSource: source,
          artistVoice: voice || Boolean(pageId),
          metaPageId: pageId || null,
          instagramActorId: actorId || null,
          rightsDocRef: artist?.rightsDocRef ?? "",
        })}
      >
        Save
      </Button>
    </div>
  );
}
