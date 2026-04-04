"use client";

import { AlertCircle } from "lucide-react";
import { useFacebookConnectionStatus } from "@/lib/hooks/useMeta";

interface FacebookConnectionBannerProps {
  /** Jump to Account Setup (step 0) in the wizard */
  onGoToAccountSetup?: () => void;
}

/**
 * Shown on wizard steps after Account Setup when the user has not connected Facebook.
 * Meta features that need the user&apos;s Facebook token (e.g. &quot;Load My Pages&quot;) require this.
 */
export function FacebookConnectionBanner({ onGoToAccountSetup }: FacebookConnectionBannerProps) {
  const { connected, loading } = useFacebookConnectionStatus();

  if (loading || connected) return null;

  return (
    <div className="mx-auto mb-4 flex max-w-5xl items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-foreground">Connect Facebook</p>
        <p className="text-xs text-muted-foreground">
          Go to{" "}
          {onGoToAccountSetup ? (
            <button
              type="button"
              onClick={onGoToAccountSetup}
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
            >
              Account Setup
            </button>
          ) : (
            <span className="font-medium">Account Setup</span>
          )}{" "}
          (step 1) and use &quot;Connect Facebook&quot; to load your pages and other Meta assets that need your personal Facebook access.
        </p>
      </div>
    </div>
  );
}
