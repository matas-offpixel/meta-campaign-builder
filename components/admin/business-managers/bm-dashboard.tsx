"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  describeGrantResult,
  type BusinessManagerSummary,
  type DetectedNewPage,
  type GrantResult,
} from "@/lib/bm/types";
import type { AppUsageSnapshot } from "@/lib/meta/app-usage";

function isGrantResult(value: unknown): value is GrantResult {
  return (
    !!value &&
    typeof value === "object" &&
    "attempted" in value &&
    "granted" in value &&
    "failed" in value
  );
}

interface Props {
  initialBusinessManagers: BusinessManagerSummary[];
  initialNewPages: DetectedNewPage[];
  /** Best-effort last-observed Meta app-level quota usage. Null until a call lands on this instance. */
  metaAppUsage: { snapshot: AppUsageSnapshot; capturedAt: string } | null;
}

function quotaBadgeClass(percent: number): string {
  if (percent >= 90) return "bg-red-100 text-red-800";
  if (percent >= 70) return "bg-amber-100 text-amber-800";
  return "bg-muted text-muted-foreground";
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

async function postJson(url: string): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  try {
    const res = await fetch(url, { method: "POST" });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; result?: unknown; needsReconnect?: boolean }
      | null;
    if (!res.ok || !body?.ok) {
      return { ok: false, error: body?.error ?? `Request failed (${res.status})` };
    }
    return { ok: true, result: body.result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export function BusinessManagersDashboard({
  initialBusinessManagers,
  initialNewPages,
  metaAppUsage,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const businessManagers = initialBusinessManagers;
  const newPages = initialNewPages;
  const hasExpiredToken = businessManagers.some((b) => b.token_expired);

  const run = async (key: string, url: string, successText: string) => {
    setBusyKey(key);
    setNotice(null);
    const res = await postJson(url);
    if (!res.ok) {
      setNotice({ kind: "error", text: res.error ?? "Action failed" });
      setBusyKey(null);
      return;
    }
    // Grant endpoints return a GrantResult — prefer its real granted/failed
    // counts over the static successText so a partial failure (or a run
    // that granted 0/N) is never reported as a flat success.
    const text = isGrantResult(res.result) ? describeGrantResult(res.result) : successText;
    setNotice({ kind: "ok", text });
    // router.refresh() re-fetches the server component tree (page.tsx is
    // force-dynamic) so businessManagers/newPages below reflect the fresh
    // missing_access_count immediately after a grant/scan.
    startTransition(() => router.refresh());
    setBusyKey(null);
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="h-6 w-6" aria-hidden="true" />
            Business Managers
          </h1>
          <p className="text-sm text-muted-foreground">
            Keep your page asset-user access in sync across every client Business
            Manager. Grants give you the <span className="font-medium">ADVERTISER</span>{" "}
            role — enough to boost posts and run ads, no owner-level actions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {metaAppUsage ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${quotaBadgeClass(metaAppUsage.snapshot.maxPercent)}`}
              title={`Meta app quota as of ${formatTimestamp(metaAppUsage.capturedAt)} (this server instance only)`}
            >
              App quota: {Math.round(metaAppUsage.snapshot.maxPercent)}%
            </span>
          ) : null}
          <Button
            onClick={() => run("connect", "/api/business-managers/connect", "Business Managers refreshed.")}
            disabled={busyKey === "connect" || isPending}
          >
            {busyKey === "connect" ? "Connecting…" : "Connect / refresh BMs"}
          </Button>
        </div>
      </div>

      {notice ? (
        <div
          className={`mb-6 rounded-md border px-4 py-2.5 text-sm ${
            notice.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {hasExpiredToken ? (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">A Facebook token has expired.</p>
            <p className="mt-0.5">
              Scans and grants for the affected Business Manager will fail until
              you reconnect.{" "}
              <a
                href="/api/auth/facebook-start?next=/business-managers"
                className="font-medium underline"
              >
                Reconnect Facebook
              </a>
              , then press <span className="font-medium">Connect / refresh BMs</span>.
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {businessManagers.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Connect your first Business Manager</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Press <span className="font-medium">Connect / refresh BMs</span> to
            discover every Business Manager your Facebook account is a member of.
            We&apos;ll enumerate their pages and flag any you can&apos;t yet
            advertise on.
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* ── Section 1: New pages detected ─────────────────────────── */}
          <section>
            <h2 className="pb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              New pages detected (last 7 days)
            </h2>
            {newPages.length === 0 ? (
              <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing new. The daily scan (08:00 UTC) flags freshly-added pages
                here.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {newPages.map((p) => {
                  const key = `grant:${p.business_id}:${p.page_id}`;
                  return (
                    <div
                      key={`${p.business_id}:${p.page_id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {p.page_name ?? p.page_id}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {(p.client_name ?? p.business_name ?? p.business_id)}
                          {p.category ? ` · ${p.category}` : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          detected {formatTimestamp(p.detected_at)}
                        </p>
                      </div>
                      {p.user_has_access ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          <ShieldCheck className="h-3.5 w-3.5" /> Access
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() =>
                            run(
                              key,
                              `/api/business-managers/${p.business_id}/pages/${p.page_id}/grant`,
                              "Access granted.",
                            )
                          }
                          disabled={busyKey === key || isPending}
                        >
                          {busyKey === key ? "Granting…" : "Grant me access"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Section 2: Connected BMs ───────────────────────────────── */}
          <section>
            <h2 className="pb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Connected Business Managers
            </h2>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Client / BM</th>
                    <th className="px-4 py-2.5 font-medium">Pages</th>
                    <th className="px-4 py-2.5 font-medium">Missing access</th>
                    <th className="px-4 py-2.5 font-medium">Last scan</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {businessManagers.map((bm) => {
                    const scanKey = `scan:${bm.business_id}`;
                    const grantKey = `grantall:${bm.business_id}`;
                    return (
                      <tr key={bm.business_id}>
                        <td className="px-4 py-3">
                          <p className="font-medium">
                            {bm.client_name ?? bm.business_name ?? bm.business_id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {bm.business_name ? `${bm.business_name} · ` : ""}
                            {bm.business_id}
                          </p>
                          {bm.token_expired ? (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              <AlertTriangle className="h-3 w-3" /> Token expired
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{bm.total_pages}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {bm.missing_access_count > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                              {bm.missing_access_count}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatTimestamp(bm.last_scanned_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                run(
                                  scanKey,
                                  `/api/business-managers/${bm.business_id}/scan`,
                                  "Scan complete.",
                                )
                              }
                              disabled={busyKey === scanKey || isPending}
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${busyKey === scanKey ? "animate-spin" : ""}`}
                              />
                              {busyKey === scanKey ? "Syncing…" : "Sync now"}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                run(
                                  grantKey,
                                  `/api/business-managers/${bm.business_id}/pages/grant-all`,
                                  "Missing access resolved.",
                                )
                              }
                              disabled={
                                busyKey === grantKey ||
                                isPending ||
                                bm.missing_access_count === 0
                              }
                            >
                              {busyKey === grantKey ? "Granting…" : "Grant all missing"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
