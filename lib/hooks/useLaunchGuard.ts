"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createLiveIdentityReader } from "@/lib/launch-guard/live-identity";
import type { LaunchGuardResult, LiveIdentity } from "@/lib/launch-guard/types";
import type { CampaignDraft } from "@/lib/types";

async function fetchLive(draft: CampaignDraft): Promise<LiveIdentity | null> {
  const res = await fetch("/api/launch-guard/live-identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  const body = (await res.json()) as { ok?: boolean; live?: LiveIdentity | null };
  return body.ok ? (body.live ?? null) : null;
}

/**
 * The pre-launch check for the draft on Review & launch (record RC3).
 * Re-runs 400 ms after the parts the checks read change. A failed read
 * leaves the last result; the launch route runs the same check and
 * refuses on a blocker either way.
 *
 * RC8 (#1362): when Review & launch opens on a published draft, the live
 * ads' page and Instagram are read once (createLiveIdentityReader) and sent
 * with every later check, which compares them with the draft as it stands.
 * Nothing reads Meta while the draft is edited or re-rendered.
 */
export function useLaunchGuard(draft: CampaignDraft, enabled: boolean) {
  const [result, setResult] = useState<LaunchGuardResult | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<{ review: number; identity: LiveIdentity | null } | null>(null);
  const seq = useRef(0);
  const review = useRef(0);
  const reader = useRef(createLiveIdentityReader(fetchLive));

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  // One live read per open of Review & launch.
  useEffect(() => {
    if (!enabled) return;
    const open = ++review.current;
    let cancelled = false;
    void reader.current.read(open, draftRef.current).then((identity) => {
      if (!cancelled) setLive({ review: open, identity });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const liveIdentity = live && live.review === review.current ? live.identity : null;

  // Only the fields the checks read; autosave timestamps don't re-run it.
  const key = useMemo(
    () =>
      JSON.stringify({
        s: draft.settings,
        st: draft.status,
        c: draft.creatives.map((c) => [c.name, c.destinationUrl, c.headline, c.captions, c.identity]),
        a: draft.audiences,
        x: draft.adSetSuggestions.map((s) => [s.name, s.enabled]),
        l: liveIdentity ? [liveIdentity.campaignId, liveIdentity.readAt] : null,
      }),
    [draft.settings, draft.status, draft.creatives, draft.audiences, draft.adSetSuggestions, liveIdentity],
  );

  const liveRef = useRef(liveIdentity);
  useEffect(() => {
    liveRef.current = liveIdentity;
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
          body: JSON.stringify({ draft: draftRef.current, live: liveRef.current }),
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
