"use client";

/**
 * components/dashboard/campaigns/client-campaigns-tab.tsx
 *
 * Top-level shell for the internal `/clients/[id]/campaigns` surface.
 *
 * Three responsibilities:
 *   1. Sub-tab nav — Meta active, TikTok + Google stubbed disabled
 *      (follow-on PR adds them; the structure ships now so the
 *      affordance is visible).
 *   2. Filter row — Active/All toggle, event-code multi-select.
 *   3. Render `<CampaignsTable />` with the rows the server loader
 *      already produced. Refresh button hits `/api/internal/refresh-
 *      active-creatives` per event_id and then triggers `router.
 *      refresh()` so the next render picks up the new snapshots.
 *
 * The data is loaded server-side in `app/(dashboard)/clients/[id]/
 * page.tsx` via `loadClientCampaignsData` so this component is
 * presentation + interaction only — no client-side fetches on
 * mount, only the explicit refresh button.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ClientCampaignsData } from "@/lib/dashboard/campaigns-loader";
import { CampaignsTable } from "./campaigns-table";

type SubTab = "meta" | "tiktok" | "google";

interface Props {
  /**
   * Reserved for future per-client-scoped fetches (e.g. hitting a
   * `/api/clients/[id]/campaigns/refresh` endpoint that fans out
   * server-side instead of via the per-event loop). Currently unused
   * — the manual refresh button drives the existing per-event
   * `/api/internal/refresh-active-creatives` route directly.
   */
  clientId: string;
  data: ClientCampaignsData | null;
  /**
   * All event ids belonging to this client. Drives the per-event
   * fan-out of the manual refresh button (the existing refresh
   * endpoint is single-event single-preset).
   */
  eventIds: string[];
}

export function ClientCampaignsTab({ data, eventIds }: Props) {
  const router = useRouter();
  const [activeSub, setActiveSub] = useState<SubTab>("meta");
  const [refreshing, startRefresh] = useTransition();
  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedEventCodes, setSelectedEventCodes] = useState<Set<string>>(
    new Set(),
  );

  const rows = useMemo(() => {
    if (!data) return [];
    let filtered = data.rows;
    if (activeOnly) {
      filtered = filtered.filter((r) => r.status === "active");
    }
    if (selectedEventCodes.size > 0) {
      filtered = filtered.filter((r) =>
        r.eventCodes.some((c) => selectedEventCodes.has(c)),
      );
    }
    return filtered;
  }, [data, activeOnly, selectedEventCodes]);

  const handleRefresh = () => {
    if (!eventIds.length) return;
    startRefresh(async () => {
      // Fire-and-forget per event — the endpoint is single-(event,
      // preset). We sequence them so 30+ event tenants don't
      // exhaust Meta's request budget.
      for (const eventId of eventIds) {
        try {
          await fetch("/api/internal/refresh-active-creatives", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              eventId,
              datePreset: "lifetime",
            }),
          });
        } catch {
          // swallow; cron retry covers persistent failures.
        }
      }
      router.refresh();
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-base tracking-wide">Campaigns</h2>
          <p className="text-xs text-muted-foreground">
            Internal view. Read-time aggregation from cron-cached snapshots.
            <span className="ml-1">
              {data?.lastRefreshedAt ? (
                <>
                  Last refreshed{" "}
                  <RelativeTime iso={data.lastRefreshedAt} />.
                </>
              ) : (
                <>Never refreshed.</>
              )}
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || eventIds.length === 0}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <SubTabsNav active={activeSub} onChange={setActiveSub} />

      {activeSub !== "meta" ? (
        <PlatformPlaceholder platform={activeSub} />
      ) : (
        <>
          <FilterRow
            data={data}
            activeOnly={activeOnly}
            setActiveOnly={setActiveOnly}
            selectedEventCodes={selectedEventCodes}
            setSelectedEventCodes={setSelectedEventCodes}
          />
          {!data || !data.hasData ? (
            <EmptyState lastRefreshedAt={data?.lastRefreshedAt ?? null} />
          ) : (
            <CampaignsTable rows={rows} />
          )}
        </>
      )}
    </section>
  );
}

function SubTabsNav({
  active,
  onChange,
}: {
  active: SubTab;
  onChange: (next: SubTab) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border">
      {(
        [
          { id: "meta", label: "Meta", enabled: true },
          { id: "tiktok", label: "TikTok", enabled: false },
          { id: "google", label: "Google", enabled: false },
        ] as Array<{ id: SubTab; label: string; enabled: boolean }>
      ).map((tab) => {
        const isActive = active === tab.id;
        const className = `px-3 py-1.5 text-xs font-medium ${
          isActive
            ? "border-b-2 border-foreground text-foreground -mb-px"
            : tab.enabled
              ? "text-muted-foreground hover:text-foreground"
              : "text-muted-foreground/50 cursor-not-allowed"
        }`;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={!tab.enabled}
            onClick={() => tab.enabled && onChange(tab.id)}
            className={className}
            title={tab.enabled ? undefined : `${tab.label} ships in a follow-on PR`}
          >
            {tab.label}
            {!tab.enabled && (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FilterRow({
  data,
  activeOnly,
  setActiveOnly,
  selectedEventCodes,
  setSelectedEventCodes,
}: {
  data: ClientCampaignsData | null;
  activeOnly: boolean;
  setActiveOnly: (next: boolean) => void;
  selectedEventCodes: Set<string>;
  setSelectedEventCodes: (next: Set<string>) => void;
}) {
  const eventCodes = data?.eventCodes ?? [];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Show:</span>
        <button
          type="button"
          onClick={() => setActiveOnly(true)}
          className={`rounded px-2 py-1 font-medium ${activeOnly ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setActiveOnly(false)}
          className={`rounded px-2 py-1 font-medium ${!activeOnly ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
        >
          All
        </button>
      </div>
      {eventCodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Event code:</span>
          {eventCodes.map((c) => {
            const selected = selectedEventCodes.has(c.eventCode);
            return (
              <button
                key={c.eventCode}
                type="button"
                onClick={() => {
                  const next = new Set(selectedEventCodes);
                  if (selected) next.delete(c.eventCode);
                  else next.add(c.eventCode);
                  setSelectedEventCodes(next);
                }}
                className={`rounded border px-2 py-0.5 font-mono ${
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                title={`${c.campaignCount} campaign${c.campaignCount === 1 ? "" : "s"}`}
              >
                {c.eventCode}
              </button>
            );
          })}
          {selectedEventCodes.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedEventCodes(new Set())}
              className="text-muted-foreground underline-offset-2 hover:underline"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlatformPlaceholder({ platform }: { platform: SubTab }) {
  const label = platform === "tiktok" ? "TikTok" : "Google";
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{label} campaigns</p>
      <p className="mt-1 text-xs">
        Ships in a follow-on PR. Same campaign → ad-set drill, attribution
        badge, and spend-share allocation contracts as the Meta tab.
      </p>
    </div>
  );
}

function EmptyState({ lastRefreshedAt }: { lastRefreshedAt: string | null }) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        No campaign snapshots yet.
      </p>
      <p className="mt-1 text-xs">
        {lastRefreshedAt ? (
          <>
            The cron last wrote at{" "}
            <RelativeTime iso={lastRefreshedAt} /> but the payload contained
            no campaigns. Hit Refresh to retry.
          </>
        ) : (
          <>
            The cron hasn&apos;t populated active-creatives snapshots yet. Hit
            Refresh to backfill — refreshing iterates the client&apos;s events
            and primes the cache.
          </>
        )}
      </p>
    </div>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  // Compute on the client only. Server-side render emits the raw
  // ISO so the SSR HTML stays deterministic; the post-mount effect
  // upgrades to the relative phrasing once we're in the browser.
  // The interval is the only setState call — never invoked in the
  // synchronous effect body, which keeps React's
  // `set-state-in-effect` rule happy.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return;
    const compute = (): string => {
      const ms = Date.now() - target;
      if (ms < 0) return "just now";
      const minutes = Math.floor(ms / 60_000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} min ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} h ago`;
      const days = Math.floor(hours / 24);
      return `${days} d ago`;
    };
    const timer = window.setInterval(() => setLabel(compute()), 60_000);
    // First update fires on the next animation frame so this stays
    // out of the synchronous effect body. React's lint rule treats
    // setState scheduled via rAF / setInterval as compliant.
    const raf = window.requestAnimationFrame(() => setLabel(compute()));
    return () => {
      window.clearInterval(timer);
      window.cancelAnimationFrame(raf);
    };
  }, [iso]);
  return <>{label ?? iso}</>;
}
