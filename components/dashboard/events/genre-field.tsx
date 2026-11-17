"use client";

import { useId, useState } from "react";

import {
  GENRE_FAMILIES,
  GENRE_FIELD_LABEL,
  GENRE_HELPER,
  GENRE_USE_IT,
  genreFieldText,
  genreSuggestionLine,
  visibleSuggestion,
  type GenreFamilyKey,
  type GenreSuggestion,
} from "@/lib/learning/genre/families";

/**
 * The event form's "Genre" field (design record 2026-11-16-genre-key.html,
 * GK1–GK2, frames G1–G2). Starts at "Not set"; the suggestion, when there is
 * one, sits under the field with "Use it" and is never selected for the
 * operator. Choosing (or "Use it") only changes the form: the event row is
 * written when the operator saves, and only that event.
 */
export function GenreField({
  id = "event-genre-family",
  value,
  onChange,
  suggestion,
  openList = false,
}: {
  id?: string;
  value: GenreFamilyKey | null;
  onChange: (value: GenreFamilyKey) => void;
  suggestion: GenreSuggestion | null;
  /** Frames only: draw the list open. */
  openList?: boolean;
}) {
  const [open, setOpen] = useState(openList);
  const listId = useId();
  const labelId = `${id}-label`;
  const shown = visibleSuggestion(value, suggestion);

  return (
    <div className="flex flex-col gap-1.5" data-genre-field>
      <span id={labelId} className="text-sm font-medium text-foreground">
        {GENRE_FIELD_LABEL}
      </span>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        onClick={() => setOpen((was) => !was)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-border-strong bg-background px-3 text-left text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>{genreFieldText(value)}</span>
        <span aria-hidden className="text-muted-foreground">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <div id={listId} role="listbox" aria-labelledby={labelId} className="overflow-hidden rounded-md border border-border bg-background">
          {GENRE_FAMILIES.map((family) => (
            <button
              key={family.key}
              type="button"
              role="option"
              aria-selected={value === family.key}
              onClick={() => {
                onChange(family.key);
                setOpen(false);
              }}
              className={`block w-full border-b border-border px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted ${
                value === family.key ? "bg-muted font-semibold text-foreground" : family.key === "no_single_genre" ? "text-muted-foreground" : "text-foreground"
              }`}
            >
              {family.label}
            </button>
          ))}
        </div>
      ) : null}
      {shown ? (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground" data-genre-suggestion={shown.key}>
          <span className="min-w-0">{genreSuggestionLine(shown)}</span>
          <button
            type="button"
            onClick={() => onChange(shown.key)}
            className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-foreground underline underline-offset-2"
          >
            {GENRE_USE_IT}
          </button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{GENRE_HELPER}</p>
    </div>
  );
}
