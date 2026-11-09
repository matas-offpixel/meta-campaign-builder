"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HeldLabel } from "@/components/dashboard/events/creative-lab/held-label";
import type { LabLineupRow } from "@/lib/db/creative-lab";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { artistPrimaryAction, clearedOn, showClearForArtistChannels, type LibrarySuggestion, type SpotifySuggestion } from "@/lib/creative-lab/lineup";
import { findClipsErrorSentence, findClipsReadingLine } from "@/lib/creative-lab/surface";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

/** Find clips on one lineup row: reading Instagram, or the one sentence it failed with. */
type FindState = { state: "finding" } | { state: "error"; message: string };

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
  const [card, setCard] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [finding, setFinding] = useState<Record<string, FindState>>({});

  useEffect(() => {
    setOrder(rows);
  }, [rows]);

  function setFind(artistId: string, next: FindState | null) {
    setFinding((current) => {
      const rest = { ...current };
      delete rest[artistId];
      return next ? { ...rest, [artistId]: next } : rest;
    });
  }

  /** Make the Lab artist if the row has none, then read the artist's Instagram. The row says so until it resolves. */
  async function findClips(row: LabLineupRow, artist: CreativeLabCardData["artists"][number] | undefined) {
    setFind(row.artistId, { state: "finding" });
    try {
      let labId = artist?.id ?? null;
      if (!labId) {
        const made = await onSave({ action: "labArtist", libraryArtistId: row.artistId, name: row.name });
        labId = made?.ok ? String(made.json.artistId ?? "") || null : null;
      }
      if (!labId) {
        setFind(row.artistId, { state: "error", message: findClipsErrorSentence(null, row.instagramHandle) });
        return;
      }
      const res = await fetch(`/api/creative-lab/artists/${labId}/find-clips`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setFind(row.artistId, { state: "error", message: findClipsErrorSentence(json.error, row.instagramHandle) });
        return;
      }
      setFind(row.artistId, null);
      router.refresh();
    } catch {
      setFind(row.artistId, { state: "error", message: findClipsErrorSentence(null, row.instagramHandle) });
    }
  }

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
          const find = finding[row.artistId] ?? null;
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
                  <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => setCard(card === row.artistId ? null : row.artistId)}>
                    {row.name}
                  </button>
                  {handles(row) ? <p className="text-muted-foreground">{handles(row)}</p> : <p className="text-muted-foreground">no Instagram yet</p>}
                  {find?.state === "finding" ? (
                    <p data-find-state="finding" className="text-muted-foreground" role="status">{findClipsReadingLine(row.instagramHandle)}</p>
                  ) : find?.state === "error" ? (
                    <p data-find-state="error" className="text-destructive" role="alert">{find.message}</p>
                  ) : null}
                  <Rights row={row} busy={busy} onSave={onSave} />
                  <p className="tabular-nums text-muted-foreground">{row.clipCount} {row.clipCount === 1 ? "clip" : "clips"}</p>
                  {!row.spotifyId && row.spotifyCandidates.length > 1 ? (
                    <button type="button" className="underline" onClick={() => setPick(pick === row.artistId ? null : row.artistId)}>Pick the right {row.name}</button>
                  ) : null}
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <RowAction row={row} busy={busy} finding={find?.state === "finding"} onEdit={() => setOpen(row.artistId)} onFind={() => void findClips(row, artist)} />
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
              {card === row.artistId ? <ArtistCard row={row} /> : null}
              {pick === row.artistId ? (
                <ul className="mt-2 space-y-1 rounded border border-border p-2">
                  {row.spotifyCandidates.map((candidate) => (
                    <li key={candidate.spotifyId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 py-1 text-left"
                        disabled={busy}
                        onClick={() => void onSave({
                          action: "pickSpotify",
                          libraryArtistId: row.artistId,
                          spotify: { spotifyId: candidate.spotifyId, name: candidate.name, imageUrl: candidate.imageUrl, genres: candidate.genres },
                        })}
                      >
                        {candidate.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Spotify artist photo
                          <img src={candidate.imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : null}
                        <span>{candidate.name}{candidate.genres.length ? ` · ${candidate.genres.slice(0, 2).join(", ")}` : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {open === row.artistId ? (
                <EditRow row={row} artist={artist} adAccountId={adAccountId} busy={busy} onSave={onSave} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Rights({ row, busy, onSave }: { row: LabLineupRow; busy: boolean; onSave: Save }) {
  const when = row.clearedAt ? clearedOn(row.clearedAt) : null;
  const clear = showClearForArtistChannels(row);
  return (
    <p title={row.rightsNote || undefined}>
      {row.clearedAt ? (
        <span className="text-success">✓ Cleared — artist channels too{row.clearedBy || when ? ` · ${[row.clearedBy, when].filter(Boolean).join(", ")}` : ""}</span>
      ) : (
        <span className="rounded border border-foreground px-1.5 py-0.5 text-xs">Promoter page only</span>
      )}
      {clear ? (
        <button type="button" className="ml-2 underline" disabled={busy} onClick={() => onSave({ action: "clearLibrary", libraryArtistId: row.artistId, name: row.name, cleared: true })}>
          Clear for artist channels
        </button>
      ) : null}
    </p>
  );
}

function RowAction({
  row,
  busy,
  finding,
  onEdit,
  onFind,
}: {
  row: LabLineupRow;
  busy: boolean;
  finding: boolean;
  onEdit: () => void;
  onFind: () => void;
}) {
  const action = artistPrimaryAction(row);
  if (action === "add_instagram") return <Button type="button" disabled={busy} onClick={onEdit}>Add Instagram</Button>;
  return (
    <Button type="button" disabled={busy || finding} aria-busy={finding} onClick={onFind}>
      <HeldLabel
        idle="Find clips"
        pending={
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Finding…
          </>
        }
        active={finding}
      />
    </Button>
  );
}

function ArtistCard({ row }: { row: LabLineupRow }) {
  const when = row.enrichedAt ? clearedOn(row.enrichedAt) : null;
  return (
    <div className="mt-2 rounded border border-border p-2">
      <div className="flex items-center gap-2">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored profile photo
          <img src={row.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded border border-border text-xs">{initials(row.name)}</span>
        )}
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-muted-foreground">{handles(row) || "no Instagram yet"}</p>
        </div>
      </div>
      <p className="mt-2">{row.playedBefore.length ? row.playedBefore.join(" · ") : "First time on one of your bills."}</p>
      <p>{row.genres.length ? row.genres.join(", ") : "No genres stored."}</p>
      {when ? <p className="text-muted-foreground">Checked on Spotify {when}</p> : null}
      {row.spotifyId ? <p><a className="underline" href={`https://open.spotify.com/artist/${row.spotifyId}`}>Open in Spotify</a></p> : null}
    </div>
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
