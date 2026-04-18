"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  type KeyboardEvent,
} from "react";
import { ChevronDown, Check, Search, X } from "lucide-react";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ComboboxOption {
  value: string;
  /** Primary label shown in the trigger and the list. */
  label: string;
  /** Smaller second line in the dropdown (e.g. "act_xxx · USD"). */
  sublabel?: string;
  /**
   * When true the option renders at 50 % opacity — use for non-ideal statuses
   * like Closed / Unsettled without hiding the option entirely.
   */
  dimmed?: boolean;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Text shown when the filtered list is empty. */
  emptyText?: string;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  label,
  disabled,
  loading,
  emptyText = "No results",
  className = "",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selectedOption = options.find((o) => o.value === value);

  // Filter options by query (label + sublabel + value)
  const filtered = query.trim()
    ? options.filter((o) => {
        const q = query.toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.sublabel?.toLowerCase().includes(q) ?? false)
        );
      })
    : options;

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlighted(-1);
  }, []);

  // Click-outside handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        closeAndReset();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closeAndReset]);

  // Focus search input on open; pre-highlight the selected item
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const idx = filtered.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlighted < 0 || !listRef.current) return;
    const item = listRef.current.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  // Recalculate highlight when query changes
  useEffect(() => {
    if (query) setHighlighted(0);
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (
          highlighted >= 0 &&
          filtered[highlighted] &&
          !filtered[highlighted].disabled
        ) {
          onChange(filtered[highlighted].value);
          closeAndReset();
        }
        break;
      case "Escape":
        e.preventDefault();
        closeAndReset();
        break;
      case "Tab":
        closeAndReset();
        break;
    }
  };

  const handleSelect = (opt: ComboboxOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    closeAndReset();
  };

  return (
    <div ref={containerRef} className={`relative flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          id={`${id}-label`}
          className="text-sm font-medium text-foreground"
          onClick={() => !disabled && !loading && setOpen((v) => !v)}
        >
          {label}
        </label>
      )}

      {/* ── Trigger button ─────────────────────────────────────────────────── */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled || loading}
        onClick={() => !open && setOpen(true)}
        onKeyDown={handleKeyDown}
        className={[
          "flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm",
          "focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-40",
          open ? "border-primary ring-1 ring-ring" : "border-border-strong",
          !selectedOption ? "text-muted-foreground" : "text-foreground",
        ].join(" ")}
      >
        <span className="truncate">
          {loading ? "Loading…" : (selectedOption?.label ?? placeholder)}
        </span>
        <ChevronDown
          className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* ── Dropdown ───────────────────────────────────────────────────────── */}
      {open && (
        <div
          role="dialog"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg"
        >
          {/* Search row */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
            />
            {query && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Options list */}
          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            className="max-h-64 overflow-y-auto py-1 text-sm"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">{emptyText}</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isHighlighted = i === highlighted;
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={[
                      "flex cursor-pointer items-start gap-2 px-3 py-2",
                      isHighlighted ? "bg-accent" : "",
                      opt.dimmed ? "opacity-50" : "",
                      opt.disabled ? "cursor-not-allowed opacity-30" : "",
                    ].join(" ")}
                  >
                    {/* Checkmark column — keeps layout stable whether selected or not */}
                    <span className="mt-0.5 h-4 w-4 shrink-0 text-primary">
                      {isSelected && <Check className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{opt.label}</p>
                      {opt.sublabel && (
                        <p className="truncate text-xs text-muted-foreground">
                          {opt.sublabel}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
