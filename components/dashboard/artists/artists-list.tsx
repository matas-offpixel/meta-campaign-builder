"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtistRow } from "@/lib/types/intelligence";

interface ArtistEnrichmentCandidate {
  name: string;
  spotify_id: string | null;
  musicbrainz_id: string | null;
  genres: string[];
  popularity_score: number | null;
  profile_image_url: string | null;
  instagram_handle: string | null;
  facebook_page_url: string | null;
  tiktok_handle: string | null;
  soundcloud_url: string | null;
  beatport_url: string | null;
  bandcamp_url: string | null;
  website: string | null;
  profile_jsonb: Record<string, unknown>;
}

const GENRES = [
  "Melodic Techno",
  "Afro House",
  "House",
  "Techno",
  "Drum & Bass",
  "Garage",
  "Disco",
  "Hip-Hop",
  "R&B",
];

type FormState = {
  id?: string;
  name: string;
  genres: string[];
  meta_page_id: string;
  meta_page_name: string;
  instagram_handle: string;
  spotify_id: string;
  website: string;
  notes: string;
  // Enrichment-only fields, populated by the search panel + persisted
  // on save. They aren't surfaced as edit inputs (Spotify is the
  // canonical source — typing them by hand would be busywork) but we
  // still round-trip them so a re-save doesn't blank them out.
  musicbrainz_id: string | null;
  facebook_page_url: string | null;
  tiktok_handle: string | null;
  soundcloud_url: string | null;
  beatport_url: string | null;
  bandcamp_url: string | null;
  profile_image_url: string | null;
  popularity_score: number | null;
  profile_jsonb: Record<string, unknown> | null;
};

const EMPTY: FormState = {
  name: "",
  genres: [],
  meta_page_id: "",
  meta_page_name: "",
  instagram_handle: "",
  spotify_id: "",
  website: "",
  notes: "",
  musicbrainz_id: null,
  facebook_page_url: null,
  tiktok_handle: null,
  soundcloud_url: null,
  beatport_url: null,
  bandcamp_url: null,
  profile_image_url: null,
  popularity_score: null,
  profile_jsonb: null,
};

function rowToForm(a: ArtistRow): FormState {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    meta_page_id: a.meta_page_id ?? "",
    meta_page_name: a.meta_page_name ?? "",
    instagram_handle: a.instagram_handle ?? "",
    spotify_id: a.spotify_id ?? "",
    website: a.website ?? "",
    notes: a.notes ?? "",
    musicbrainz_id: a.musicbrainz_id ?? null,
    facebook_page_url: a.facebook_page_url ?? null,
    tiktok_handle: a.tiktok_handle ?? null,
    soundcloud_url: a.soundcloud_url ?? null,
    beatport_url: a.beatport_url ?? null,
    bandcamp_url: a.bandcamp_url ?? null,
    profile_image_url: a.profile_image_url ?? null,
    popularity_score: a.popularity_score ?? null,
    profile_jsonb:
      (a.profile_jsonb as Record<string, unknown> | null) ?? null,
  };
}

function formToPayload(f: FormState) {
  return {
    name: f.name.trim(),
    genres: f.genres,
    meta_page_id: f.meta_page_id.trim() || null,
    meta_page_name: f.meta_page_name.trim() || null,
    instagram_handle: f.instagram_handle.trim() || null,
    spotify_id: f.spotify_id.trim() || null,
    website: f.website.trim() || null,
    notes: f.notes.trim() || null,
    musicbrainz_id: f.musicbrainz_id,
    facebook_page_url: f.facebook_page_url,
    tiktok_handle: f.tiktok_handle,
    soundcloud_url: f.soundcloud_url,
    beatport_url: f.beatport_url,
    bandcamp_url: f.bandcamp_url,
    profile_image_url: f.profile_image_url,
    popularity_score: f.popularity_score,
    profile_jsonb: f.profile_jsonb ?? {},
  };
}

function applyCandidateToForm(
  prev: FormState,
  c: ArtistEnrichmentCandidate,
): FormState {
  return {
    ...prev,
    // Sticky merge — never overwrite a manually-typed value with a
    // candidate-derived one. Matas owns the manual fields.
    name: prev.name.trim() ? prev.name : c.name,
    genres: prev.genres.length > 0 ? prev.genres : c.genres,
    spotify_id: prev.spotify_id.trim() ? prev.spotify_id : c.spotify_id ?? "",
    instagram_handle: prev.instagram_handle.trim()
      ? prev.instagram_handle
      : c.instagram_handle ?? "",
    website: prev.website.trim() ? prev.website : c.website ?? "",
    musicbrainz_id: prev.musicbrainz_id ?? c.musicbrainz_id,
    facebook_page_url: prev.facebook_page_url ?? c.facebook_page_url,
    tiktok_handle: prev.tiktok_handle ?? c.tiktok_handle,
    soundcloud_url: prev.soundcloud_url ?? c.soundcloud_url,
    beatport_url: prev.beatport_url ?? c.beatport_url,
    bandcamp_url: prev.bandcamp_url ?? c.bandcamp_url,
    profile_image_url: prev.profile_image_url ?? c.profile_image_url,
    popularity_score: prev.popularity_score ?? c.popularity_score,
    profile_jsonb: c.profile_jsonb,
  };
}

export function ArtistsList({
  initialArtists,
  eventCounts,
}: {
  initialArtists: ArtistRow[];
  eventCounts: Record<string, number>;
}) {
  const [artists, setArtists] = useState<ArtistRow[]>(initialArtists);
  const [query, setQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState<string>("");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [enrichmentEnabled, setEnrichmentEnabled] = useState<boolean>(false);
  const [reEnriching, setReEnriching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/artists/enrichment-health", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setEnrichmentEnabled(Boolean(j.enabled));
      } catch {
        if (!cancelled) setEnrichmentEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reEnrichRow = async (id: string) => {
    setReEnriching(id);
    try {
      const res = await fetch(`/api/artists/${id}/enrich`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { artist: ArtistRow };
      setArtists((prev) => prev.map((a) => (a.id === id ? j.artist : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setReEnriching(null);
    }
  };

  const filtered = useMemo(() => {
    return artists.filter((a) => {
      if (genreFilter && !a.genres.includes(genreFilter)) return false;
      if (query.trim()) {
        const needle = query.trim().toLowerCase();
        if (
          !a.name.toLowerCase().includes(needle) &&
          !(a.instagram_handle ?? "").toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [artists, genreFilter, query]);

  const refreshOne = async (id: string) => {
    const res = await fetch(`/api/artists/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const j = (await res.json()) as { artist: ArtistRow };
    setArtists((prev) => prev.map((a) => (a.id === id ? j.artist : a)));
  };

  const submit = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing.id) {
        const res = await fetch(`/api/artists/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(editing)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await refreshOne(editing.id);
      } else {
        const res = await fetch("/api/artists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(editing)),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { artist: ArtistRow };
        setArtists((prev) =>
          [...prev, j.artist].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setPendingDelete(id);
    try {
      const res = await fetch(`/api/artists/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArtists((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setPendingDelete(null);
    }
  };

  const toggleGenre = (g: string) => {
    if (!editing) return;
    setEditing({
      ...editing,
      genres: editing.genres.includes(g)
        ? editing.genres.filter((x) => x !== g)
        : [...editing.genres, g],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search by name or Instagram…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-64 rounded border border-border-strong bg-background px-3 text-sm focus:border-primary focus:outline-none"
          />
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="h-9 rounded border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">All genres</option>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
          <Plus className="h-3.5 w-3.5" />
          New artist
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Genres</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2 text-left">Meta page</th>
              <th className="px-3 py-2 text-left">Instagram</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {artists.length === 0
                    ? "No artists yet. Click 'New artist' to add one."
                    : "No artists match your filters."}
                </td>
              </tr>
            ) : (
              filtered.map((a) => (
                <tr key={a.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2">
                    {a.genres.length === 0 ? (
                      <span className="text-muted-foreground/60">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {a.genres.map((g) => (
                          <span
                            key={g}
                            className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {eventCounts[a.id] ?? 0}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {a.meta_page_name ? (
                      <span className="text-foreground">
                        {a.meta_page_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">
                        Not linked
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {a.instagram_handle ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {enrichmentEnabled &&
                        (a.enriched_at ? (
                          <span
                            className="inline-flex h-2 w-2 rounded-full bg-emerald-500"
                            title={`Enriched ${new Date(
                              a.enriched_at,
                            ).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`}
                            aria-label="Enriched"
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void reEnrichRow(a.id)}
                            disabled={reEnriching === a.id}
                            aria-label="Enrich"
                            title="Enrich from Spotify + MusicBrainz"
                          >
                            {reEnriching === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(rowToForm(a))}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove(a.id)}
                        disabled={pendingDelete === a.id}
                        aria-label="Delete"
                      >
                        {pendingDelete === a.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <SlideOver
          title={editing.id ? "Edit artist" : "New artist"}
          onClose={() => (saving ? null : setEditing(null))}
          footer={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {enrichmentEnabled && (
              <ArtistEnrichmentSearch
                seed={editing.name}
                onPick={(c) =>
                  setEditing((prev) => (prev ? applyCandidateToForm(prev, c) : prev))
                }
              />
            )}
            <Input
              label="Name *"
              value={editing.name}
              onChange={(e) =>
                setEditing({ ...editing, name: e.target.value })
              }
            />
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Genres
              </p>
              <div className="flex flex-wrap gap-1">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      editing.genres.includes(g)
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-border-strong"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Instagram handle"
                value={editing.instagram_handle}
                onChange={(e) =>
                  setEditing({ ...editing, instagram_handle: e.target.value })
                }
              />
              <Input
                label="Spotify ID"
                value={editing.spotify_id}
                onChange={(e) =>
                  setEditing({ ...editing, spotify_id: e.target.value })
                }
              />
            </div>
            <Input
              label="Website"
              value={editing.website}
              onChange={(e) =>
                setEditing({ ...editing, website: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Meta page ID"
                value={editing.meta_page_id}
                onChange={(e) =>
                  setEditing({ ...editing, meta_page_id: e.target.value })
                }
              />
              <Input
                label="Meta page name"
                value={editing.meta_page_name}
                onChange={(e) =>
                  setEditing({ ...editing, meta_page_name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Notes
              </label>
              <textarea
                value={editing.notes}
                onChange={(e) =>
                  setEditing({ ...editing, notes: e.target.value })
                }
                rows={3}
                className="w-full rounded border border-border-strong bg-background p-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </SlideOver>
      )}
    </div>
  );
}

/**
 * Search Spotify + MusicBrainz from inside the artist slide-over.
 * Renders up to 5 candidate cards; "Use this artist" hands the
 * picked candidate back to the parent which sticky-merges it into
 * the form (manual values always win).
 */
function ArtistEnrichmentSearch({
  seed,
  onPick,
}: {
  seed: string;
  onPick: (candidate: ArtistEnrichmentCandidate) => void;
}) {
  const [q, setQ] = useState(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ArtistEnrichmentCandidate[] | null>(
    null,
  );

  // Sync the input when the parent slide-over opens for a different
  // artist — otherwise the previous query's text would persist.
  useEffect(() => {
    setQ(seed);
    setCandidates(null);
    setError(null);
  }, [seed]);

  const submit = async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      const res = await fetch("/api/artists/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (j?.error === "ARTIST_ENRICHMENT_DISABLED") {
          throw new Error(
            "Enrichment is disabled. Ask the admin to add SPOTIFY_CLIENT_ID + SECRET.",
          );
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { candidates: ArtistEnrichmentCandidate[] };
      setCandidates(j.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Search Spotify &amp; MusicBrainz
      </p>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Artist name…"
          className="h-8 flex-1 rounded border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none"
        />
        <Button size="sm" onClick={() => void submit()} disabled={loading || !q.trim()}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Search
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-destructive">{error}</p>
      )}
      {candidates && candidates.length === 0 && !error && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No matches. Try a different spelling.
        </p>
      )}
      {candidates && candidates.length > 0 && (
        <ul className="mt-2 space-y-2">
          {candidates.map((c) => (
            <li
              key={c.spotify_id ?? c.name}
              className="flex items-center gap-3 rounded border border-border bg-card p-2"
            >
              {c.profile_image_url ? (
                <Image
                  src={c.profile_image_url}
                  alt={c.name}
                  width={40}
                  height={40}
                  unoptimized
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {c.genres.slice(0, 3).join(" · ") || "no genres"}
                  {c.popularity_score != null
                    ? ` · ${c.popularity_score}/100`
                    : ""}
                </p>
                <SocialIcons candidate={c} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => onPick(c)}>
                <Check className="h-3.5 w-3.5" />
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SocialIcons({ candidate }: { candidate: ArtistEnrichmentCandidate }) {
  const items: { label: string; present: boolean }[] = [
    { label: "IG", present: !!candidate.instagram_handle },
    { label: "FB", present: !!candidate.facebook_page_url },
    { label: "TT", present: !!candidate.tiktok_handle },
    { label: "SC", present: !!candidate.soundcloud_url },
    { label: "BC", present: !!candidate.bandcamp_url },
    { label: "BP", present: !!candidate.beatport_url },
    { label: "Web", present: !!candidate.website },
  ];
  return (
    <p className="mt-0.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/70">
      {items
        .filter((i) => i.present)
        .map((i) => (
          <span
            key={i.label}
            className="rounded bg-muted px-1 py-px text-foreground/80"
          >
            {i.label}
          </span>
        ))}
      {items.every((i) => !i.present) && (
        <span className="italic">no socials found</span>
      )}
    </p>
  );
}

function SlideOver({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        className="flex-1 bg-black/40"
        onClick={onClose}
        aria-label="Close panel"
      />
      <aside className="flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-heading text-sm tracking-wide">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footer}
        </div>
      </aside>
    </div>
  );
}
