"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";

export interface AudienceBuilderClientCard {
  id: string;
  name: string;
  metaAdAccountId: string;
  counts: {
    draft: number;
    ready: number;
    failed: number;
  };
}

/**
 * Best-effort prewarm of the audience-source DB cache (mig 087) for
 * the most recently used client. Fires on mount; never blocks the
 * picker render. By the time the user navigates to
 * `/audiences/[clientId]/new` and picks a Video Views preset on a
 * recent campaign, the cache has been populated by the prewarm
 * route's Promise.allSettled fan-out.
 */
function prewarmAudienceSources(clientId: string) {
  if (typeof window === "undefined") return;
  void fetch("/api/audiences/sources/prewarm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId }),
    cache: "no-store",
    keepalive: true,
  }).catch(() => {
    // Prewarm is opportunistic; swallow network failures so the
    // picker UI never surfaces them.
  });
}

export function AudienceBuilderClientPicker({
  clients,
}: {
  clients: AudienceBuilderClientCard[];
}) {
  const [lastClientId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem("lastAudienceClientId"),
  );

  const lastClient = clients.find((client) => client.id === lastClientId) ?? null;

  useEffect(() => {
    if (lastClient) prewarmAudienceSources(lastClient.id);
  }, [lastClient]);

  return (
    <div className="space-y-5">
      {lastClient && (
        <Link
          href={`/audiences/${lastClient.id}`}
          className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/10 p-4 hover:bg-primary/15"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Continue where you left off
            </p>
            <p className="mt-1 font-heading text-lg tracking-wide">
              {lastClient.name}
            </p>
          </div>
          <Badge variant="primary">{lastClient.metaAdAccountId}</Badge>
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => (
          <Link
            key={client.id}
            href={`/audiences/${client.id}`}
            onClick={() => {
              window.localStorage.setItem("lastAudienceClientId", client.id);
              prewarmAudienceSources(client.id);
            }}
            className="rounded-md border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg tracking-wide">
                  {client.name}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Meta ad account
                </p>
              </div>
              <Badge variant="outline">{client.metaAdAccountId}</Badge>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
              <Count label="Drafts" value={client.counts.draft} />
              <Count label="Ready" value={client.counts.ready} />
              <Count label="Failed" value={client.counts.failed} />
            </div>
          </Link>
        ))}
      </div>

      {clients.length === 0 && (
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <p className="font-heading text-xl tracking-wide">
            No Meta-connected clients
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Link a Meta ad account in client settings before creating audiences.
          </p>
        </div>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted px-2 py-3">
      <p className="font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-muted-foreground">{label}</p>
    </div>
  );
}
