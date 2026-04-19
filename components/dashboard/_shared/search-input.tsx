"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Debounced URL-driven search input.
 *
 * Behaviour:
 *  - Local useState mirror so typing stays responsive.
 *  - 250ms debounce before pushing the value upstream.
 *  - IME-safe: pushes are suppressed while a composition session is
 *    active (CJK input). The final composed value is mirrored on
 *    onCompositionEnd and picked up by the next debounce tick.
 *  - lastPushedRef guards against the URL→prop→state round-trip that
 *    would otherwise re-fire writeQuery for the value we just pushed.
 *  - Clear button bypasses the debounce — explicit user gesture.
 *
 * The `writeQuery` callback is expected to use the shared
 * `useWriteParams` hook so unrelated query params are preserved.
 */
export function SearchInput({
  initialQuery,
  writeQuery,
  placeholder = "Search…",
  ariaLabel = "Search",
  widthClass = "w-56",
}: {
  initialQuery: string;
  writeQuery: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Tailwind width utility — pass e.g. "w-72" for wider inputs. */
  widthClass?: string;
}) {
  const [value, setValue] = useState(initialQuery);
  const composingRef = useRef(false);
  const lastPushedRef = useRef(initialQuery);

  useEffect(() => {
    if (composingRef.current) return;
    if (value === lastPushedRef.current) return;
    const t = setTimeout(() => {
      lastPushedRef.current = value;
      writeQuery(value);
    }, 250);
    return () => clearTimeout(t);
  }, [value, writeQuery]);

  const clear = () => {
    setValue("");
    lastPushedRef.current = "";
    writeQuery("");
  };

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          setValue(e.currentTarget.value);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`${widthClass} rounded-md border border-border bg-card pl-7 pr-7 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:border-border-strong focus:outline-none`}
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
