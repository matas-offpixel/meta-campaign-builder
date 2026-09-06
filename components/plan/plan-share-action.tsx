"use client";

import { useState } from "react";

import { planShareHref } from "@/lib/plan/share-role";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Operator header action. One word: `share ↗` mints (or re-enables) and
 * copies. `revoke` disables the token. Client role never mounts this.
 */
export function PlanShareAction({
  planId,
  initialToken,
  initialEnabled,
}: {
  planId: string;
  initialToken: string | null;
  initialEnabled?: boolean;
}) {
  const [token, setToken] = useState(
    initialEnabled === false ? null : initialToken,
  );
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      let next = token;
      if (!next) {
        const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/share`, {
          method: "POST",
        });
        const json = (await res.json()) as { ok?: boolean; token?: string };
        if (!res.ok || !json.token) return;
        next = json.token;
        setToken(next);
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(planShareHref(next, origin));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/share`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${VIZ_TYPE.label}`}>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        disabled={busy}
        onClick={() => void share()}
      >
        share ↗
      </button>
      {token ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => void revoke()}
        >
          revoke
        </button>
      ) : null}
    </span>
  );
}
