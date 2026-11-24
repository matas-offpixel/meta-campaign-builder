"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LaunchGuardResult } from "@/lib/launch-guard/types";
import type { CampaignDraft } from "@/lib/types";

/**
 * The pre-launch check for the draft on Review & launch (record RC3).
 * Re-runs 400 ms after the parts the checks read change. A failed read
 * leaves the last result; the launch route runs the same check and
 * refuses on a blocker either way.
 */
export function useLaunchGuard(draft: CampaignDraft, enabled: boolean) {
  const [result, setResult] = useState<LaunchGuardResult | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Only the fields the checks read; autosave timestamps don't re-run it.
  const key = useMemo(
    () =>
      JSON.stringify({
        s: draft.settings,
        c: draft.creatives.map((c) => [c.name, c.destinationUrl, c.headline, c.captions, c.identity]),
        a: draft.audiences,
        x: draft.adSetSuggestions.map((s) => [s.name, s.enabled]),
      }),
    [draft.settings, draft.creatives, draft.audiences, draft.adSetSuggestions],
  );

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/launch-guard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: draftRef.current }),
        });
        const body = (await res.json()) as { ok?: boolean; result?: LaunchGuardResult; viewer?: string };
        if (id !== seq.current) return;
        if (body.ok && body.result) {
          setResult(body.result);
          setViewer(body.viewer ?? null);
        }
      } catch {
        /* the launch route re-checks */
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [enabled, key]);

  return { result: enabled ? result : null, viewer, loading };
}
