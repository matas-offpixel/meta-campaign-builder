"use client";

import { useEffect, useMemo, useState } from "react";

import {
  EmptyHint,
  MetaCampaignBreakdownSection,
  MetaCampaignStatsSection,
} from "@/components/report/meta-insights-sections";
import type {
  CustomDateRange,
  DatePreset,
  InsightsResult,
} from "@/lib/insights/types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; result: InsightsResult }
  | { kind: "error"; message: string };

export function VenueLiveReportInsights({
  clientId,
  eventCode,
  shareToken,
  datePreset,
  customRange,
  isInternal,
  refreshNonce = 0,
}: {
  clientId: string;
  eventCode: string;
  shareToken: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  isInternal: boolean;
  refreshNonce?: number;
}) {
  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("datePreset", datePreset);
    if (datePreset === "custom" && customRange) {
      params.set("since", customRange.since);
      params.set("until", customRange.until);
    }
    if (refreshNonce > 0) {
      params.set("force", "1");
      params.set("nonce", String(refreshNonce));
    }
    const query = params.toString();
    if (isInternal) {
      return `/api/insights/venue/${encodeURIComponent(clientId)}/${encodeURIComponent(eventCode)}?${query}`;
    }
    return `/api/share/venue/${encodeURIComponent(shareToken)}/insights?${query}`;
  }, [
    clientId,
    customRange,
    datePreset,
    eventCode,
    isInternal,
    refreshNonce,
    shareToken,
  ]);

  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        const json = (await res.json()) as InsightsResult | { error?: string };
        if (!res.ok) {
          const message =
            "error" in json
              ? typeof json.error === "string"
                ? json.error
                : json.error?.message
              : null;
          throw new Error(message ?? `HTTP ${res.status}`);
        }
        if (!cancelled) setState({ kind: "ready", result: json as InsightsResult });
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Meta campaign stats unavailable",
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url]);

  if (state.kind === "loading") {
    return (
      <EmptyHint>
        Loading venue-scoped Meta campaign stats for the selected timeframe…
      </EmptyHint>
    );
  }
  if (state.kind === "error") {
    return <EmptyHint>{state.message}</EmptyHint>;
  }
  if (!state.result.ok) {
    return <EmptyHint>{state.result.error.message}</EmptyHint>;
  }

  return (
    <>
      <MetaCampaignStatsSection meta={state.result.data} />
      <MetaCampaignBreakdownSection meta={state.result.data} />
    </>
  );
}
