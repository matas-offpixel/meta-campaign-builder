"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtistRow } from "@/lib/types/intelligence";

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
