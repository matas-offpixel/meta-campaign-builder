/**
 * Dashboard widget — authoritative Meta / Facebook connection status.
 *
 * Server component; reads `user_facebook_tokens` directly via the SSR Supabase
 * client and verifies the token round-trip against Meta's `/debug_token`
 * endpoint (the user-level equivalent of the per-client check that
 * `/api/meta/verify-client` runs in Slice F.1).
 *
 * States rendered:
 *   - disconnected   no row in DB
 *   - expired        DB row exists but `expires_at` < now, or `/debug_token`
 *                    returns `valid: false`
 *   - unknown_expiry row exists, `expires_at` is null (legacy pre-extension
 *                    Mode B token), but `/debug_token` says valid
 *   - connected      row exists, future expiry, `/debug_token` says valid
 */

import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { validateMetaToken } from "@/lib/meta/server-token";

type Status = "disconnected" | "expired" | "unknown_expiry" | "connected";

interface ConnectionState {
  status: Status;
  expiresAt: string | null;
  /** Days until expiry (rounded down, can be negative for already-expired). */
  daysRemaining: number | null;
  /** Optional /debug_token error string when validation flagged stale credentials. */
  validationError?: string;
  scopes?: string[];
}

const RECONNECT_HREF = "/api/auth/facebook-start?next=/";

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor((ms - Date.now()) / 86_400_000);
}

async function loadConnection(): Promise<ConnectionState | { status: "anon" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "anon" };

  const { data, error } = await supabase
    .from("user_facebook_tokens")
    .select("provider_token, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("[MetaConnectionWidget] DB read error:", error.message);
    return { status: "disconnected", expiresAt: null, daysRemaining: null };
  }
  if (!data?.provider_token) {
    return { status: "disconnected", expiresAt: null, daysRemaining: null };
  }

  const expiresAt = (data as { expires_at?: string | null }).expires_at ?? null;
  const days = daysFromNow(expiresAt);
  if (days !== null && days < 0) {
    return { status: "expired", expiresAt, daysRemaining: days };
  }

  // Round-trip /debug_token. Failing-open: if Meta is unreachable we still
  // surface the DB-derived state rather than blanket-marking as expired.
  const validation = await validateMetaToken(data.provider_token);
  if (!validation.valid) {
    return {
      status: "expired",
      expiresAt,
      daysRemaining: days,
      validationError: validation.error,
    };
  }

  return {
    status: expiresAt ? "connected" : "unknown_expiry",
    expiresAt,
    daysRemaining: days,
    scopes: validation.scopes,
  };
}

export async function MetaConnectionWidget() {
  const state = await loadConnection();
  if (state.status === "anon") return null;

  const { status, daysRemaining, validationError } = state;

  // Visual treatment per state.
  const tone =
    status === "connected"
      ? "border-green-500/30 bg-green-500/5"
      : status === "unknown_expiry"
        ? "border-warning/40 bg-warning/5"
        : status === "expired"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border";

  return (
    <Card className={`${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            {status === "connected" && (
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
            )}
            {status === "unknown_expiry" && (
              <Clock className="h-4 w-4 text-warning-foreground" aria-hidden />
            )}
            {status === "expired" && (
              <XCircle className="h-4 w-4 text-destructive" aria-hidden />
            )}
            {status === "disconnected" && (
              <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
            )}
            <CardTitle className="text-base">Meta connection</CardTitle>
          </div>

          {status === "connected" && (
            <CardDescription>
              Connected.{" "}
              {typeof daysRemaining === "number" ? (
                <span className="text-foreground">
                  {daysRemaining > 0
                    ? `Expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`
                    : "Expires today."}
                </span>
              ) : null}
            </CardDescription>
          )}
          {status === "unknown_expiry" && (
            <CardDescription>
              Connected, but the stored token has no recorded expiry.
              Reconnect to refresh it to a 60-day long-lived token.
            </CardDescription>
          )}
          {status === "expired" && (
            <CardDescription>
              Token has expired{validationError ? ` — ${validationError}` : ""}.
              Reconnect to restore Meta access.
            </CardDescription>
          )}
          {status === "disconnected" && (
            <CardDescription>
              No Facebook account connected. Connect to load pages, ad
              accounts, pixels, and audiences.
            </CardDescription>
          )}
        </div>

        <div className="shrink-0">
          <Link
            href={RECONNECT_HREF}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {status === "disconnected" ? "Connect Facebook" : "Reconnect"}
          </Link>
        </div>
      </div>
    </Card>
  );
}
