"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Select } from "@/components/ui/select";
import type { ExternalEventSummary } from "@/lib/ticketing/types";

/**
 * components/dashboard/events/external-event-picker.tsx
 *
 * Searchable dropdown for picking one event from a (potentially long)
 * list of external ticketing-provider events.
 *
 * Why a dedicated component?
 *
 *   4thefans currently has 60+ live Eventbrite events; other clients
 *   will land in the same shape as they onboard. A bare <Select>
 *   becomes an unusable scroll-fest at that size. Rather than ship a
 *   bespoke filter inside <EventbriteLinkPanel> we lift it here so
 *   the same UI can wrap the 4thefans-internal-API picker (and any
 *   future provider) without duplicating debounce/filter wiring.
 *
 * Behaviour:
 *
 *   - 200ms debounced, case-insensitive substring match against the
 *     event name and the ISO date prefix (`2026-04-22`) plus a small
 *     set of human-formatted dates (`22 Apr 2026`, `22 April 2026`).
 *     A user typing "april" or "26" or "fans" all hits intuitively.
 *   - The currently-selected event is always pinned visible even
 *     when filtered out, so the native <select>'s value stays valid
 *     and the user can always see what they're about to overwrite.
 *   - Empty input shows the full list (the parent's existing sort,
 *     usually soonest-first, is preserved verbatim).
 *   - "X of Y" counter on the right of the search input gives quick
 *     feedback that the filter actually did something.
 *   - "no events match" empty state replaces the dropdown so the
 *     user isn't stuck staring at a placeholder-only <select>.
 *
 * The component is intentionally provider-agnostic — it only knows
 * about ExternalEventSummary, which is the normalized cross-provider
 * shape from lib/ticketing/types.ts.
 */

interface Props {
  events: ExternalEventSummary[];
  value: string;
  onChange: (id: string, event: ExternalEventSummary | null) => void;
  /** Placeholder for the underlying <select>. */
  placeholder?: string;
  /**
   * Skip rendering the search input when the list is short enough
   * that a plain dropdown is fine. Default 8 — at 60+ items the
   * filter is essential, at 5 it's noise.
   */
  showSearchAtLeast?: number;
  /** id forwarded to the search <input> for label associations. */
  searchInputId?: string;
}

export function ExternalEventPicker({
  events,
  value,
  onChange,
  placeholder = "Select an event",
  showSearchAtLeast = 8,
  searchInputId,
}: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Build a per-event lowercased haystack once per render of `events`.
  // Keeping this outside the filter loop matters at 200+ events where
  // recomputing locale strings on every keystroke shows up in profiles.
  const haystack = useMemo(() => {
    const map = new Map<string, string>();
    for (const ev of events) {
      map.set(ev.externalEventId, buildHaystack(ev));
    }
    return map;
  }, [events]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return events;
    return events.filter((ev) => {
      const hay = haystack.get(ev.externalEventId);
      return hay ? hay.includes(q) : false;
    });
  }, [events, debounced, haystack]);

  // Pin the current selection so the native <select> never goes into
  // an "unknown value" state when the user filters past it.
  const visible = useMemo(() => {
    if (!value) return filtered;
    if (filtered.some((e) => e.externalEventId === value)) return filtered;
    const selected = events.find((e) => e.externalEventId === value);
    return selected ? [selected, ...filtered] : filtered;
  }, [events, filtered, value]);

  const showSearch = events.length >= showSearchAtLeast;
  const filterActive = debounced.trim().length > 0;
  const showEmptyState = filterActive && filtered.length === 0;

  return (
    <div className="space-y-2">
      {showSearch ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id={searchInputId}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${events.length} events…`}
            className="h-9 w-full rounded-md border border-border-strong bg-background pl-8 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Filter events by name or date"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {filterActive ? (
            <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
              {filtered.length}/{events.length}
            </span>
          ) : null}
        </div>
      ) : null}

      {showEmptyState ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No events match{" "}
          <span className="font-medium text-foreground">
            &ldquo;{debounced.trim()}&rdquo;
          </span>
          .
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            const match = events.find((x) => x.externalEventId === v) ?? null;
            onChange(v, match);
          }}
          placeholder={placeholder}
          options={visible.map((ev) => ({
            value: ev.externalEventId,
            label: formatExternalEventLabel(ev),
          }))}
        />
      )}
    </div>
  );
}

/** Shared label formatter — exported so panels can render the same
 * short string elsewhere (e.g. the "Bound to X" summary). */
export function formatExternalEventLabel(ev: ExternalEventSummary): string {
  const parts: string[] = [ev.name];
  if (ev.startsAt) {
    const formatted = tryFormatDate(ev.startsAt);
    if (formatted) parts.push(formatted);
  }
  if (ev.status) parts.push(ev.status);
  return parts.join(" · ");
}

function tryFormatDate(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

/**
 * Pre-compute the lowercased searchable string for an event. We
 * include several date renderings so a user typing "april", "apr",
 * "2026", or "26" all match the same event, regardless of which
 * format the dropdown happens to display.
 */
function buildHaystack(ev: ExternalEventSummary): string {
  const parts: string[] = [ev.name];
  if (ev.status) parts.push(ev.status);
  if (ev.startsAt) {
    const d = new Date(ev.startsAt);
    if (Number.isFinite(d.getTime())) {
      parts.push(d.toISOString().slice(0, 10));
      parts.push(
        d.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      );
      parts.push(
        d.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      );
      parts.push(
        d.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "2-digit",
        }),
      );
    }
  }
  return parts.join(" ").toLowerCase();
}
