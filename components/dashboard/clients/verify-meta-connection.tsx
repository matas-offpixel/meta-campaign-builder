"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Mirrors the response shape of /api/meta/verify-client ─────────────────────

type BusinessStatus = "ok" | "not_found" | "no_access";
type ResourceStatus = "ok" | "wrong_bm" | "not_found" | "no_access";

interface BusinessResult {
  status: BusinessStatus;
  name?: string;
  error?: string;
}

interface ResourceResult {
  status: ResourceStatus;
  name?: string;
  ownerBusinessId?: string;
  error?: string;
}

interface VerifyResponse {
  business: BusinessResult;
  adAccount: ResourceResult;
  pixel: ResourceResult;
}

interface Props {
  clientId: string;
  /**
   * When true, no Meta IDs are set — the button still renders but warns the
   * user the verify call will return only "not_found" rows.
   */
  hasAnyMetaId: boolean;
}

/**
 * Trigger a verification of all three Meta IDs (Business / Ad Account / Pixel)
 * on a single client and render the per-resource result inline.
 *
 * The endpoint is POST so we don't pollute browser history / GET caches and so
 * the call is auth-checked on the server (RLS scopes the client lookup).
 */
export function VerifyMetaConnection({ clientId, hasAnyMetaId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/meta/verify-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
        cache: "no-store",
      });
      const json = (await res.json()) as Partial<VerifyResponse> & {
        error?: string;
      };
      if (!res.ok || json.error) {
        setError(json.error ?? `Verify failed (HTTP ${res.status})`);
        return;
      }
      setResult({
        business: json.business as BusinessResult,
        adAccount: json.adAccount as ResourceResult,
        pixel: json.pixel as ResourceResult,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Meta connection</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Round-trip the Business, Ad Account and Pixel against the Graph API
            using your Facebook session.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={loading || !hasAnyMetaId}
          title={
            !hasAnyMetaId
              ? "Set at least one Meta ID on this client first"
              : undefined
          }
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Verify Meta connection
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {result && (
        <ul className="rounded-md border border-border divide-y divide-border bg-card text-sm">
          <ResultRow label="Business" result={result.business} />
          <ResultRow label="Ad Account" result={result.adAccount} />
          <ResultRow label="Pixel" result={result.pixel} />
        </ul>
      )}
    </div>
  );
}

// ── Row renderer ──────────────────────────────────────────────────────────────

function ResultRow({
  label,
  result,
}: {
  label: string;
  result: BusinessResult | ResourceResult;
}) {
  const { Icon, tone, summary } = renderStatus(result);
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-sm break-words">
          {result.name ? <span className="font-medium">{result.name}</span> : null}
          {result.name ? <span className="text-muted-foreground"> — </span> : null}
          <span className={tone}>{summary}</span>
        </p>
        {"ownerBusinessId" in result && result.status === "wrong_bm" && (
          <p className="text-xs text-muted-foreground mt-0.5 break-all">
            Returned business id: {result.ownerBusinessId}
          </p>
        )}
        {result.error && result.status !== "ok" && (
          <p className="text-xs text-muted-foreground mt-0.5 break-words">
            {result.error}
          </p>
        )}
      </div>
    </li>
  );
}

function renderStatus(result: BusinessResult | ResourceResult): {
  Icon: typeof CheckCircle2;
  tone: string;
  summary: string;
} {
  switch (result.status) {
    case "ok":
      return {
        Icon: CheckCircle2,
        tone: "text-green-600 dark:text-green-400",
        summary: "Connected",
      };
    case "wrong_bm":
      return {
        Icon: AlertCircle,
        tone: "text-amber-600 dark:text-amber-400",
        summary: "Wrong Business",
      };
    case "not_found":
      return {
        Icon: XCircle,
        tone: "text-destructive",
        summary: "Not found",
      };
    case "no_access":
    default:
      return {
        Icon: XCircle,
        tone: "text-destructive",
        summary: "No access",
      };
  }
}
