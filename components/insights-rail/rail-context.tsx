"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import type { RailContext, RailData } from "@/lib/insights-rail/model";

/** Remembered per user in the browser (R2). One state for every page. */
export const RAIL_STORAGE_KEY = "op.insightsRail";

export type RailFixture = { context: RailContext; data: RailData; open: boolean };

type RailState = {
  /** Only operators see the rail (rule 12). */
  operator: boolean;
  context: RailContext | null;
  setContext: (context: RailContext | null) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Frames: the data to draw instead of fetching. */
  fixture: RailData | null;
};

const Ctx = createContext<RailState | null>(null);

// ── The stored open state, as an external store ─────────────────────────
// localStorage is read on the client only; the server snapshot is closed,
// so the first paint is the collapsed tab and the stored state applies
// right after hydration without a mismatch.

const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

function writeStored(open: boolean): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    /* private mode or blocked storage: the rail still toggles for this page */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const serverSnapshot = () => false;

export function InsightsRailProvider({
  operator,
  fixture = null,
  children,
}: {
  operator: boolean;
  fixture?: RailFixture | null;
  children: ReactNode;
}) {
  const [context, setContext] = useState<RailContext | null>(fixture?.context ?? null);
  const stored = useSyncExternalStore(subscribe, readStored, serverSnapshot);
  const [fixtureOpen, setFixtureOpen] = useState(fixture?.open ?? false);
  const open = fixture ? fixtureOpen : stored;
  const setOpen = fixture ? setFixtureOpen : writeStored;

  const value = useMemo<RailState>(
    () => ({ operator, context, setContext, open, setOpen, fixture: fixture?.data ?? null }),
    [operator, context, open, setOpen, fixture],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInsightsRail(): RailState {
  const value = useContext(Ctx);
  if (!value) {
    return { operator: false, context: null, setContext: () => undefined, open: false, setOpen: () => undefined, fixture: null };
  }
  return value;
}

/**
 * A page declares what it is (R4). Rendered anywhere on the page; the
 * rail reads it. Leaving the page clears it.
 */
export function InsightsPageContext(props: RailContext) {
  const { setContext } = useInsightsRail();
  const key = JSON.stringify(props);
  useEffect(() => {
    setContext(JSON.parse(key) as RailContext);
    return () => setContext(null);
  }, [key, setContext]);
  return null;
}
