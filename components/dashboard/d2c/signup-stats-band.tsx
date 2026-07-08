"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { CountResult, EventSignupStats } from "@/lib/d2c/stats";

/** Local structural guard — avoids importing the server-only stats module
 *  (which transitively pulls pgcrypto secrets) into this client bundle. */
function isCountOk(r: CountResult): r is { count: number; asOf: string } {
  return typeof (r as { count?: unknown }).count === "number";
}

/**
 * components/dashboard/d2c/signup-stats-band.tsx
 *
 * Live signup-count band (Goal 8). Renders the metric cards and polls the
 * given endpoint every 30s, pausing while the tab is backgrounded to avoid
 * burning Mailchimp/Bird calls. Manual Refresh + "Last updated Xs ago". Used
 * on both the operator page and the public share view (the endpoint differs).
 */

const POLL_MS = 30_000;

export interface SignupStatsBandProps {
  initial: EventSignupStats | null;
  /** Poll target: /api/d2c/event/{id}/signup-stats or the share equivalent. */
  endpoint: string;
}

function StatCard({
  label,
  result,
  asOfLabel,
}: {
  label: string;
  result: CountResult | { count: number; asOf: string } | null;
  asOfLabel?: boolean;
}) {
  let value = "—";
  let sub: string | null = null;
  if (result && isCountOk(result)) {
    value = result.count.toLocaleString();
    if (asOfLabel) {
      const d = new Date(result.asOf);
      sub = Number.isNaN(d.getTime())
        ? null
        : `as of ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d)}`;
    }
  } else if (result && !isCountOk(result)) {
    sub = result.error;
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function SignupStatsBand({ initial, endpoint }: SignupStatsBandProps) {
  const [stats, setStats] = useState<EventSignupStats | null>(initial);
  const [fetching, setFetching] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(() => Date.now());
  const [, forceTick] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFetching(true);
    try {
      const res = await fetch(endpoint);
      const json = await res.json();
      if (json.ok && json.stats) {
        setStats(json.stats as EventSignupStats);
        setLastUpdated(Date.now());
      }
    } catch {
      /* keep prior stats on failure */
    } finally {
      inFlight.current = false;
      setFetching(false);
    }
  }, [endpoint]);

  // 30s poll, paused when the tab is hidden.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // "Last updated Xs ago" ticker.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const secsAgo = Math.max(0, Math.round((Date.now() - lastUpdated) / 1000));
  const showLp = Boolean(stats?.landing_page && stats.landing_page.count > 0);

  return (
    <section>
      <div className="mb-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>Last updated {secsAgo}s ago</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={fetching}
          className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw size={12} className={fetching ? "animate-spin" : ""} aria-hidden />
          Refresh
        </button>
      </div>
      <div className={`grid grid-cols-2 gap-3 ${showLp ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <StatCard
          label="Total signups"
          result={stats ? { count: stats.total_unique_estimate, asOf: new Date(lastUpdated).toISOString() } : null}
        />
        <StatCard label="Mailchimp members" result={stats?.mailchimp ?? null} asOfLabel />
        <StatCard label="Bird contacts" result={stats?.bird ?? null} asOfLabel />
        {showLp && <StatCard label="Landing-page signups" result={stats?.landing_page ?? null} />}
      </div>
    </section>
  );
}
