"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Calendar, Loader2, Search, X } from "lucide-react";

import {
  highlightMatch,
  searchCmdKIndex,
  type CmdKSearchIndex,
  type RankedCmdKSearchResult,
} from "@/lib/dashboard/cmd-k-search";

const REFRESH_MS = 5 * 60 * 1000;
export const CMD_K_OPEN_EVENT = "cmdk:open";

export function CmdKPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<CmdKSearchIndex>({ clients: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/search-index", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`Search unavailable (${res.status})`);
      const json = (await res.json()) as CmdKSearchIndex;
      setIndex({
        clients: Array.isArray(json.clients) ? json.clients : [],
        events: Array.isArray(json.events) ? json.events : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
    const interval = window.setInterval(() => void loadIndex(), REFRESH_MS);
    const onFocus = () => void loadIndex();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
    document.body.focus();
  }, []);

  useEffect(() => {
    const openPalette = () => setOpen(true);
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      const isShortcut =
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "p");
      if (!isShortcut) return;
      event.preventDefault();
      if (!open && isTyping) target?.blur();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(CMD_K_OPEN_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(CMD_K_OPEN_EVENT, openPalette);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (open) close();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(
    () => searchCmdKIndex(index, query, 10),
    [index, query],
  );

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const activate = useCallback(
    (result: RankedCmdKSearchResult | undefined) => {
      if (!result) return;
      close();
      router.push(result.item.href);
    },
    [close, router],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setHighlighted((idx) => Math.min(idx + 1, Math.max(0, results.length - 1)));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlighted((idx) => Math.max(0, idx - 1));
        } else if (event.key === "Enter") {
          event.preventDefault();
          activate(results[highlighted]);
        } else if (event.key === "Tab") {
          const focusable = [inputRef.current, closeButtonRef.current].filter(
            Boolean,
          ) as HTMLElement[];
          if (focusable.length === 0) return;
          const current = document.activeElement as HTMLElement | null;
          const index = focusable.indexOf(current as HTMLElement);
          const next =
            event.shiftKey
              ? focusable[(index - 1 + focusable.length) % focusable.length]
              : focusable[(index + 1) % focusable.length];
          event.preventDefault();
          next?.focus();
        }
      }}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close search"
        onClick={close}
      />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients or events..."
            aria-label="Search clients or events"
            className="h-9 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Close search"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {error ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {error}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No clients or events match "{query}".
            </p>
          ) : (
            <SearchResults
              results={results}
              query={query}
              highlighted={highlighted}
              onHover={setHighlighted}
              onActivate={close}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SearchResults({
  results,
  query,
  highlighted,
  onHover,
  onActivate,
}: {
  results: RankedCmdKSearchResult[];
  query: string;
  highlighted: number;
  onHover: (idx: number) => void;
  onActivate: () => void;
}) {
  return (
    <ul className="space-y-1">
      {results.map((result, idx) => {
        const item = result.item;
        const active = idx === highlighted;
        const Icon = item.kind === "client" ? Building2 : Calendar;
        const meta =
          item.kind === "client"
            ? [item.slug, item.type].filter(Boolean).join(" · ")
            : [
                item.event_code,
                item.venue_name,
                item.venue_city,
                item.client_name,
                item.event_date,
              ]
                .filter(Boolean)
                .join(" · ");
        return (
          <li key={`${item.kind}:${item.id}`}>
            <Link
              href={item.href}
              onMouseEnter={() => onHover(idx)}
              onClick={onActivate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active ? "bg-primary-light text-foreground" : "text-foreground hover:bg-muted"
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-background text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <Highlighted text={item.name} query={query} />
                </span>
                {meta ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    <Highlighted text={meta} query={query} />
                  </span>
                ) : null}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.kind}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightMatch(text, query).map((part, idx) =>
        part.match ? (
          <mark key={idx} className="bg-yellow-200 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={idx}>{part.text}</span>
        ),
      )}
    </>
  );
}
