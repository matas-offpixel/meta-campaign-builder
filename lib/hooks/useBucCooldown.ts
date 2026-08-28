"use client";

import { useEffect, useState } from "react";
import {
  formatCooldownLabel,
  readBucCooldown,
  remainingCooldownMs,
  type RateLimitUiState,
} from "@/lib/meta/rate-limit-ui";

export function useBucCooldown(
  adAccountId: string | null | undefined,
  rateLimit: RateLimitUiState | null,
): { remainingMs: number; label: string | null; blocked: boolean } {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    const tick = () => {
      const fromState = rateLimit?.resumeAt
        ? remainingCooldownMs(rateLimit.resumeAt)
        : 0;
      const fromStore =
        adAccountId && typeof window !== "undefined"
          ? readBucCooldown(window.localStorage, adAccountId)
          : null;
      setRemainingMs(Math.max(fromState, fromStore?.remainingMs ?? 0));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [adAccountId, rateLimit?.resumeAt]);

  return {
    remainingMs,
    label: remainingMs > 0 ? formatCooldownLabel(remainingMs) : null,
    blocked: remainingMs > 0,
  };
}
