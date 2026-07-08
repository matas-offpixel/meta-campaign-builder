"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { AudienceTag } from "@/lib/d2c/audience/tag-registry";

/**
 * components/dashboard/d2c/audience-picker.tsx
 *
 * Multi-tag "Sending to" picker for announce / gen_sale email sends (Goal 5).
 * Loads the tag universe (recommended + other) from the send's audience-tags
 * route, lets the operator toggle chips, shows an estimated reach, and saves
 * the selection back via PATCH. Operator-only (never rendered on the public
 * share view).
 */

interface TagData {
  recommended: AudienceTag[];
  other: AudienceTag[];
  selected: string[];
  persisted: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function AudiencePicker({ sendId }: { sendId: string }) {
  const [data, setData] = useState<TagData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/d2c/scheduled-sends/${sendId}/audience-tags`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? "Could not load tags");
        } else {
          const d: TagData = {
            recommended: json.recommended ?? [],
            other: json.other ?? [],
            selected: json.selected ?? [],
            persisted: json.persisted ?? [],
          };
          setData(d);
          setSelected(d.selected);
        }
      } catch {
        if (!cancelled) setError("Could not load tags");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sendId]);

  const allTags = useMemo(
    () => (data ? [...data.recommended, ...data.other] : []),
    [data],
  );
  const countByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of allTags) m.set(t.name, t.member_count);
    return m;
  }, [allTags]);

  // Reach estimate: sum of selected tag member counts (upper bound — a
  // "match any" union may be lower where tags overlap).
  const reach = selected.reduce((sum, name) => sum + (countByName.get(name) ?? 0), 0);

  const persisted = data?.persisted ?? [];
  const effectivePersisted = persisted.length > 0 ? persisted : data?.selected ?? [];
  const dirty = data ? !sameSet(selected, effectivePersisted) : false;

  function toggle(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  async function save() {
    if (saving || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/d2c/scheduled-sends/${sendId}/audience-tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: selected }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Save failed");
      } else {
        setData((d) => (d ? { ...d, persisted: selected, selected } : d));
      }
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setSelected(effectivePersisted);
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading audience tags…</p>;
  }
  if (error && !data) {
    return <p className="text-xs text-muted-foreground">Audience tags unavailable: {error}</p>;
  }
  if (!data) return null;

  const chip = (tag: AudienceTag) => {
    const on = selected.includes(tag.name);
    return (
      <button
        key={tag.name}
        type="button"
        onClick={() => toggle(tag.name)}
        title={`${tag.member_count.toLocaleString()} members`}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
          on
            ? "bg-foreground text-background"
            : "border border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        {tag.name}
        <span className={on ? "opacity-70" : "opacity-50"}>
          {tag.member_count.toLocaleString()}
        </span>
        {on && <X size={11} aria-hidden />}
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sending to
        </p>
        <p className="text-xs text-muted-foreground">
          Reaches ~{reach.toLocaleString()} fans
        </p>
      </div>

      {data.recommended.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Recommended
          </p>
          <div className="flex flex-wrap gap-1.5">{data.recommended.map(chip)}</div>
        </div>
      )}
      {data.other.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            All other tags
          </p>
          <div className="flex flex-wrap gap-1.5">{data.other.map(chip)}</div>
        </div>
      )}

      {dirty && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || selected.length === 0}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Discard
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
    </div>
  );
}
