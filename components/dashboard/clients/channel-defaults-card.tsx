"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { useFetchPages } from "@/lib/hooks/useMeta";
import type { TikTokAccount } from "@/lib/types/tiktok";

/**
 * Reuses the Meta wizard page Combobox (`useFetchPages` + `Combobox`,
 * same as `components/steps/creatives.tsx`) and the TikTok wizard
 * identity Select (`GET /api/tiktok/identities`, same as
 * `components/tiktok-wizard/steps/account-setup.tsx`). Advertiser and
 * Google account stay on PlatformAccountsCard — this card does not
 * duplicate those pickers.
 */

interface TikTokIdentityOption {
  identity_id: string;
  display_name: string;
  identity_type: string | null;
  identity_bc_id?: string | null;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function ChannelDefaultsCard({
  clientId,
  metaAdAccountId,
  initialPageIds,
  initialInstagramActorId,
  tiktokAccountId,
  initialTikTokIdentityId,
}: {
  clientId: string;
  metaAdAccountId: string | null;
  initialPageIds: string[];
  initialInstagramActorId: string | null;
  tiktokAccountId: string | null;
  initialTikTokIdentityId: string | null;
}) {
  const pages = useFetchPages(metaAdAccountId ?? undefined);
  const [pageId, setPageId] = useState(initialPageIds[0] ?? "");
  const [igId, setIgId] = useState(initialInstagramActorId ?? "");
  const [identityId, setIdentityId] = useState(initialTikTokIdentityId ?? "");
  const [identities, setIdentities] = useState<TikTokIdentityOption[]>([]);
  const [advertiserId, setAdvertiserId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [migrationMissing, setMigrationMissing] = useState(false);

  const selectedPage = pages.data.find((p) => p.id === pageId);
  const igOptions = useMemo(() => {
    const id = selectedPage?.instagramAccountId;
    if (!id) return [];
    return [
      {
        value: id,
        label: selectedPage?.instagramUsername
          ? `${selectedPage.instagramUsername} (${id})`
          : id,
      },
    ];
  }, [selectedPage]);

  useEffect(() => {
    if (!tiktokAccountId) {
      setAdvertiserId(null);
      setIdentities([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/tiktok/accounts");
      const json = (await res.json()) as { ok?: boolean; accounts?: TikTokAccount[] };
      const account = (json.accounts ?? []).find((row) => row.id === tiktokAccountId);
      const adv = account?.tiktok_advertiser_id ?? null;
      if (cancelled) return;
      setAdvertiserId(adv);
      if (!adv) {
        setIdentities([]);
        return;
      }
      const idRes = await fetch(
        `/api/tiktok/identities?advertiser_id=${encodeURIComponent(adv)}`,
      );
      const idJson = (await idRes.json()) as {
        ok?: boolean;
        identities?: TikTokIdentityOption[];
      };
      if (!cancelled) setIdentities(idJson.identities ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [tiktokAccountId]);

  async function patch(body: Record<string, unknown>) {
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        const message = json.error ?? `HTTP ${res.status}`;
        if (/default_instagram_actor_id|default_tiktok_identity|does not exist/i.test(message)) {
          setMigrationMissing(true);
        }
        throw new Error(message);
      }
      setSave({ kind: "saved" });
    } catch (err) {
      setSave({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="font-heading text-base tracking-wide">Channel defaults</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Set once. Plan prepare and the wizards pick these up when a draft has
          no identity of its own. Advertiser and Google account are on Platform
          accounts above.
        </p>
      </div>

      {migrationMissing ? (
        <p className="text-xs text-muted-foreground">
          Migration 160 is not applied — identity defaults cannot be saved yet.
          Page allow-list still writes to default_page_ids.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Combobox
            label="Default Facebook page"
            value={pageId}
            onChange={(next) => {
              setPageId(next);
              const page = pages.data.find((p) => p.id === next);
              const nextIg = page?.instagramAccountId ?? "";
              setIgId(nextIg);
              void patch({
                default_page_ids: next ? [next] : [],
                default_instagram_actor_id: nextIg || null,
              });
            }}
            placeholder={pages.loading ? "Loading pages…" : "Select page…"}
            loading={pages.loading && pages.data.length === 0}
            emptyText="No pages found"
            options={pages.data.map((p) => ({
              value: p.id,
              label: p.name,
              sublabel: p.category ?? undefined,
            }))}
          />
        </div>
        <div>
          <Select
            id="client-default-ig"
            label="Default Instagram"
            value={igId}
            onChange={(e) => {
              const next = e.target.value;
              setIgId(next);
              void patch({ default_instagram_actor_id: next || null });
            }}
            placeholder={igOptions.length === 0 ? "No IG on this page" : "Select IG…"}
            options={igOptions}
            disabled={igOptions.length === 0}
          />
        </div>
        <div className="md:col-span-2">
          <Select
            id="client-default-tiktok-identity"
            label="Default TikTok identity"
            value={identityId}
            onChange={(e) => {
              const next = e.target.value;
              setIdentityId(next);
              const match = identities.find((row) => row.identity_id === next);
              void patch({
                default_tiktok_identity_id: next || null,
                default_tiktok_identity_type: match?.identity_type ?? null,
                default_tiktok_identity_bc_id: match?.identity_bc_id ?? null,
              });
            }}
            placeholder={
              !tiktokAccountId
                ? "Link a TikTok advertiser above first"
                : identities.length === 0
                  ? "No identities for this advertiser"
                  : "Select identity…"
            }
            options={identities.map((identity) => ({
              value: identity.identity_id,
              label: `${identity.display_name} · ${identity.identity_type ?? "type unknown"}`,
            }))}
            disabled={!advertiserId || identities.length === 0}
          />
        </div>
      </div>

      {save.kind === "saving" ? (
        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </p>
      ) : null}
      {save.kind === "saved" ? <p className="text-[11px] text-emerald-600">Saved</p> : null}
      {save.kind === "error" ? (
        <p className="text-[11px] text-destructive">Save failed: {save.message}</p>
      ) : null}
    </section>
  );
}
