"use client";

/**
 * The Lab's "Render a package" and "Renders" (RT1, RT2), live: reads
 * /api/creative-lab/events/[eventId]/render-package and posts Render,
 * Try again and Render as round {round+1}. Polls every 15 s while a package
 * renders, so each file appears under Renders as it finishes.
 */

import { useCallback, useEffect, useState } from "react";

import type { RecipeCard } from "@/lib/render-templates/package-view";
import type { renderRowView } from "@/lib/render-templates/report";
import { RenderPackagePicker, RenderRowsList } from "@/components/render-templates/render-package-view";

type View = {
  header: { title: string; forLine: string; rights: string };
  cards: RecipeCard[];
  running: boolean;
  rows: ReturnType<typeof renderRowView>[];
};

export function RenderPackagePanel({ eventId }: { eventId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/creative-lab/events/${eventId}/render-package`, { cache: "no-store" });
    if (!res.ok) return;
    setView((await res.json()) as View);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!view?.running) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [view?.running, load]);

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: { started?: string; error?: string } }> {
    const res = await fetch(`/api/creative-lab/events/${eventId}/render-package`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as { started?: string; error?: string } };
  }

  async function render() {
    setBusy(true);
    setError(null);
    try {
      const out = await post({ action: "render" });
      if (!out.ok) setError(out.json.error || null);
      else setStarted(out.json.started ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rowAction(action: "retry" | "rerender" | "copy", renderId: string) {
    setBusyId(renderId);
    setError(null);
    try {
      const out = await post({ action, renderId });
      if (!out.ok) setError(out.json.error || null);
      else if (out.json.started) setStarted(out.json.started);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!view) return null;
  return (
    <div className="space-y-6">
      <RenderPackagePicker header={view.header} cards={view.cards} busy={busy || view.running} started={started} error={error} onRender={render} />
      {view.rows.length ? <RenderRowsList rows={view.rows} busyId={busyId} onRetry={(id) => rowAction("retry", id)} onRerender={(id) => rowAction("rerender", id)} onCopy={(id) => rowAction("copy", id)} /> : null}
    </div>
  );
}
