"use client";

import { useEffect, useRef, useState } from "react";

import { copyLabel, fanUrl, type CopyState } from "@/lib/admin/pages-list";

/**
 * components/admin/copy-path-button.tsx
 *
 * The mono path shown under a page title. Click copies the FULL fan-facing
 * URL (origin + /l/{client}/{event}) to the clipboard and swaps the text to
 * "Copied" for 2s. Pure state logic (copyLabel) is pinned in
 * lib/admin/pages-list.ts; this only wires the clipboard + timer.
 *
 * `origin` is passed in from the server so the copied URL matches the
 * deployment (app.offpixel.co.uk today, op909.com after the domain move).
 */
export function CopyPathButton({
  origin,
  clientSlug,
  eventSlug,
}: {
  origin: string;
  clientSlug: string;
  eventSlug: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const path = `/l/${clientSlug}/${eventSlug}`;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    const url = fanUrl(origin, clientSlug, eventSlug);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (insecure context / permissions) — still flash
      // the confirmation so the click feels responsive; the URL is visible
      // in the path text for manual copy.
    }
    setState("copied");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy fan-facing URL"
      className="mt-0.5 block max-w-full truncate text-left font-[family-name:var(--admin-mono)] text-[11px] text-[#666] hover:text-black hover:underline"
    >
      {copyLabel(state, path)}
    </button>
  );
}
