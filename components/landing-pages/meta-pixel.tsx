"use client";

import { useEffect } from "react";

import {
  buildPixelInitCommands,
  getOrCreateEventBase,
  pageViewEventId,
  runPixelCommand,
} from "@/lib/landing-pages/pixel-events";

/**
 * components/landing-pages/meta-pixel.tsx
 *
 * Per-tenant Meta Pixel loader (PR 3). Mounts at the LandingPage root.
 *
 * ISOLATION CONTRACT (C+O non-negotiable C):
 *   - `pixelId` arrives as a PROP from the view model
 *     (lib/landing-pages/view.ts) — resolved through the clientSlug chain.
 *     This component has NO other pixel source: no env var, no React
 *     context, no module-level state, no clients.meta_pixel_id.
 *   - null pixelId → renders nothing, loads nothing, fires nothing.
 *   - Every fbq call is `trackSingle` scoped to THIS pixel id (see
 *     lib/landing-pages/pixel-events.ts for why plain 'track' would leak
 *     events to other tenants' pixels after soft navigations).
 *
 * PageView fires on mount with a deterministic event_id derived from the
 * session base uuid (survives reloads via sessionStorage). The rollback
 * gate needs nothing here: provider='evntree' pages 307 before this tree
 * ever renders (PR-1 gate, untouched).
 */

const FBEVENTS_SRC = "https://connect.facebook.net/en_US/fbevents.js";

interface FbqStub {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: FbqStub;
  loaded: boolean;
  version: string;
}

function ensureFbqStub(): void {
  const w = window as unknown as { fbq?: FbqStub; _fbq?: FbqStub };
  if (w.fbq) return;
  // Standard Meta bootstrap stub: queue calls until fbevents.js takes over.
  const fbq = function (this: unknown, ...args: unknown[]) {
    if (fbq.callMethod) {
      fbq.callMethod.apply(this, args);
    } else {
      fbq.queue.push(args);
    }
  } as FbqStub;
  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  w.fbq = fbq;
  w._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = FBEVENTS_SRC;
  document.head.appendChild(script);
}

export function MetaPixel({ pixelId }: { pixelId: string | null }) {
  useEffect(() => {
    if (!pixelId) return;
    try {
      ensureFbqStub();
      const base = getOrCreateEventBase(window.sessionStorage);
      for (const command of buildPixelInitCommands(
        pixelId,
        pageViewEventId(base),
      )) {
        runPixelCommand(command);
      }
    } catch {
      // Pixel failures must never break the fan-facing page.
    }
  }, [pixelId]);

  if (!pixelId) return null;

  // <noscript> fallback per Meta's snippet — img beacon for no-JS browsers.
  return (
    <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element -- Meta beacon */}
      <img
        height="1"
        width="1"
        style={{ display: "none" }}
        alt=""
        src={`https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1`}
      />
    </noscript>
  );
}
