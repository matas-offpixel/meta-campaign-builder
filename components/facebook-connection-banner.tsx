"use client";

import { AlertCircle } from "lucide-react";
import { useFacebookConnectionStatus } from "@/lib/hooks/useMeta";

/**
 * Dashboard-level chrome: shows a thin warning bar when the user hasn't
 * connected Facebook (or the in-session token went stale via an OAuth error).
 * Authoritative status (token expiry / scopes) is rendered separately by
 * `<MetaConnectionWidget />` on the dashboard index — this banner is the
 * always-visible fallback CTA.
 */
export function FacebookConnectionBanner() {
  const { connected, loading } = useFacebookConnectionStatus();

  if (loading || connected) return null;

  return (
    <div className="border-b border-warning/40 bg-warning/10 px-6 py-3 text-sm">
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground">Connect Facebook</p>
          <p className="text-xs text-muted-foreground">
            Pages, ad accounts, pixels, and audiences require your personal Facebook access.{" "}
            <a
              href="/api/auth/facebook-start?next=/"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
            >
              Connect Facebook
            </a>
            {" "}to enable Meta features.
          </p>
        </div>
      </div>
    </div>
  );
}
