"use client";

/**
 * The Lab's Snippet tab (docs/design-record/2026-11-16-creative-testing.html,
 * CT3–CT5, CT10; frames CT-A and CT-B). Act chips, the track picker, then
 * the waveform with the drop marker and window and the 9:16 preview for the
 * track that's open, the static, "Make Test 1", and the snippet renders.
 *
 * At 393 the editor stacks: title, source line, the 9:16 preview, then the
 * waveform and the length chips (CT-B 393). Every string is the record's or
 * lib/creative-tests/snippet.ts's.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AudioEdit } from "@/lib/creative-tests/audio-edits";
import { LENGTHS, NO_CLEAR_DROP, PREVIEW_FAILED, SNIPPET, SNIPPET_TAB, SUPPLIER_QUESTION, dropLabel, spanText, mmss } from "@/lib/creative-tests/snippet";
import { makeButtonText, pickerHeading, type FileView, type PickerRow, type RenderView, type SnippetView } from "@/lib/creative-tests/snippet-view";

type Preview = { audioUrl: string | null; imageUrl: string | null; failed: boolean };

async function call(eventId: string, body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await fetch(`/api/creative-lab/events/${eventId}/snippet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function LabSnippet({
  eventId,
  initial = null,
  initialPicks = [],
  initialOpen = null,
  initialStatic = null,
  previewFixture = null,
}: {
  eventId: string;
  /** Frames pass a built view and never fetch. */
  initial?: SnippetView | null;
  initialPicks?: string[];
  initialOpen?: string | null;
  initialStatic?: string | null;
  previewFixture?: Preview | null;
}) {
  const frame = initial != null;
  const [view, setView] = useState<SnippetView | null>(initial);
  const [actId, setActId] = useState<string | null>(initial?.acts.find((a) => a.open)?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Set<string>>(new Set(initialPicks));
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [staticId, setStaticId] = useState<string | null>(initialStatic ?? initial?.statics[0]?.driveFileId ?? null);
  const [preview, setPreview] = useState<Preview | null>(previewFixture);

  const load = useCallback(
    async (artist: string | null) => {
      if (frame) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/creative-lab/events/${eventId}/snippet${artist ? `?artist=${encodeURIComponent(artist)}` : ""}`);
        const json = (await res.json()) as { view?: SnippetView; error?: string };
        if (!res.ok || !json.view) setError(json.error ?? "The Snippet tab didn't load.");
        else {
          setView(json.view);
          setError(null);
          setStaticId((s) => s ?? json.view!.statics[0]?.driveFileId ?? null);
        }
      } finally {
        setBusy(false);
      }
    },
    [eventId, frame],
  );

  useEffect(() => {
    void load(actId);
  }, [load, actId]);

  const allRows = useMemo(() => (view ? [...view.rows, ...view.extras] : []), [view]);
  const open = allRows.find((r) => r.file?.id === openId)?.file ?? null;
  const openRow = allRows.find((r) => r.file?.id === openId) ?? null;
  const picked = allRows.filter((r) => r.file && picks.has(r.file.id));
  const held = picked.some((r) => !r.file!.pickable);
  const chosenStatic = view?.statics.find((s) => s.driveFileId === staticId) ?? null;

  async function edit(fileId: string, change: AudioEdit) {
    if (frame) return;
    setBusy(true);
    const res = await call(eventId, { action: "edit", fileId, edit: change });
    setBusy(false);
    if (!res.ok) setError(String(res.json.error ?? "That didn't save."));
    await load(actId);
  }

  // CT5: the preview re-renders a second after the marker, window or length stops moving.
  const previewKey = open ? `${open.id}:${open.startS}:${open.lengthS}:${staticId}` : null;
  useEffect(() => {
    if (frame || !open || open.dropS == null) return;
    const timer = setTimeout(async () => {
      const res = await call(eventId, { action: "preview", fileId: open.id, static: chosenStatic ? { driveFileId: chosenStatic.driveFileId, fileName: chosenStatic.fileName } : undefined });
      setPreview(res.ok ? { audioUrl: String(res.json.audioUrl ?? ""), imageUrl: (res.json.imageUrl as string | null) ?? null, failed: false } : { audioUrl: null, imageUrl: null, failed: true });
    }, SNIPPET.previewDebounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, frame]);

  function toggle(row: PickerRow) {
    const file = row.file;
    if (!file) return;
    const next = new Set(picks);
    if (next.has(file.id)) next.delete(file.id);
    else {
      if (next.size >= SNIPPET.maxPicks) return;
      next.add(file.id);
      // CT3: a Drive file in no top track is picked as itself.
      if (!row.trackId && file.suggestion == null && !frame) void edit(file.id, { kind: "own_track" });
    }
    setPicks(next);
  }

  async function makeTest() {
    if (!chosenStatic || frame) return;
    setBusy(true);
    const res = await call(eventId, { action: "makeTest", fileIds: picked.map((r) => r.file!.id), static: { driveFileId: chosenStatic.driveFileId, fileName: chosenStatic.fileName } });
    setBusy(false);
    if (!res.ok) setError(String(res.json.error ?? "Test 1 wasn't made."));
    await load(actId);
  }

  async function renderAction(action: "approve" | "retryDrive" | "retryRender", renderId: string) {
    if (frame) return;
    const res = await call(eventId, { action, renderId });
    if (!res.ok) setError(String(res.json.error ?? "That didn't save."));
    await load(actId);
  }

  if (!view) return <section className="space-y-2"><h3 className="font-medium">{SNIPPET_TAB}</h3>{error ? <p className="text-destructive">{error}</p> : null}</section>;

  return (
    <section className="space-y-4" aria-busy={busy}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{view.eventCode ? `${view.eventCode} · ${SNIPPET_TAB}` : SNIPPET_TAB}</p>
      {error ? <p className="text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2" role="tablist">
        {view.acts.map((act) => (
          <button
            key={act.id}
            type="button"
            role="tab"
            aria-selected={act.open}
            onClick={() => setActId(act.id)}
            className={`rounded-full border px-3 py-1 text-xs ${act.open ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
          >
            {act.name}
          </button>
        ))}
      </div>

      {view.spotifyLine ? <p className="text-sm text-muted-foreground">{view.spotifyLine}</p> : null}
      {view.actName && view.rows.length ? <p className="text-sm font-medium">{pickerHeading(view.actName, picked.length)}</p> : null}

      <div>
        {view.rows.map((row) => (
          <PickerLine key={row.key} row={row} picked={Boolean(row.file && picks.has(row.file.id))} open={row.file?.id === openId} onToggle={() => toggle(row)} onOpen={() => row.file && setOpenId(row.file.id)} onEdit={edit} />
        ))}
        {view.extras.map((row) => (
          <PickerLine key={row.key} row={row} extra picked={Boolean(row.file && picks.has(row.file.id))} open={row.file?.id === openId} onToggle={() => toggle(row)} onOpen={() => row.file && setOpenId(row.file.id)} onEdit={edit} />
        ))}
      </div>

      {open && openRow ? <TrackEditor title={openRow.trackId ? openRow.title.replace(/^\d+ · /, "") : open.fileName} file={open} preview={preview} onEdit={(change) => edit(open.id, change)} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        {view.statics.length ? (
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border border-border-strong bg-background px-3 py-1.5 text-sm">{chosenStatic?.label ?? view.statics[0]!.label}</summary>
            <div className="absolute z-10 mt-1 max-h-64 w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded border border-border bg-card p-1 shadow">
              {view.statics.map((s) => (
                <button key={s.driveFileId} type="button" className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-background" onClick={() => setStaticId(s.driveFileId)}>
                  {s.label}
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <button
          type="button"
          disabled={busy || held || picked.length < SNIPPET.minPicks || !chosenStatic}
          onClick={makeTest}
          className="rounded bg-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-background disabled:opacity-40"
        >
          {makeButtonText(picked.length)}
        </button>
      </div>

      {view.renders.length ? <SnippetRenders renders={view.renders} onAction={renderAction} /> : null}
    </section>
  );
}

function PickerLine({ row, picked, open, extra = false, onToggle, onOpen, onEdit }: { row: PickerRow; picked: boolean; open: boolean; extra?: boolean; onToggle: () => void; onOpen: () => void; onEdit: (fileId: string, change: AudioEdit) => void }) {
  const file = row.file;
  const n = row.trackId ? row.title.split(" · ")[0] : "·";
  const title = row.trackId ? row.title.replace(/^\d+ · /, "") : row.title;
  const canTick = Boolean(file) && !file?.flagged && (file?.pickable || !file?.suggestion);
  return (
    <div className={`grid grid-cols-[1.375rem_1.625rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-t border-border py-2 sm:grid-cols-[1.375rem_1.625rem_minmax(0,1fr)_auto] ${open ? "bg-background/50" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        aria-label={title}
        disabled={!canTick}
        onClick={onToggle}
        className={`h-4 w-4 rounded-[3px] border-[1.5px] ${picked ? "border-foreground bg-foreground" : "border-foreground"} disabled:border-muted-foreground disabled:opacity-45`}
      />
      <span className="font-mono text-xs text-muted-foreground">{n}</span>
      <div className="min-w-0">
        <button type="button" onClick={onOpen} disabled={!file} className="block max-w-full truncate text-left text-sm disabled:cursor-default">
          {extra ? <span className="font-mono text-xs">{title}</span> : title}
        </button>
        {row.empty ? <p className="text-[11.5px] text-muted-foreground">{row.empty}</p> : null}
        {file?.note ? <p className={`text-[11.5px] ${file.noteTone === "plain" ? "text-muted-foreground" : "text-destructive"}`}>{file.note}</p> : null}
      </div>
      <div className="col-start-3 flex flex-wrap items-center justify-start gap-2 empty:hidden sm:col-start-auto sm:justify-end">
        {file?.suggestion ? (
          <button type="button" onClick={() => onEdit(file.id, { kind: "match", trackId: file.suggestion!.trackId, title: file.suggestion!.title })} className="rounded border border-foreground px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]">
            Match
          </button>
        ) : null}
        {file?.supplierAsk && !file.suggestion ? <SupplierAsk file={file} onEdit={onEdit} /> : null}
        {file?.dropLabel && !file.suggestion ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">{file.dropLabel}</span> : null}
      </div>
    </div>
  );
}

function SupplierAsk({ file, onEdit }: { file: FileView; onEdit: (fileId: string, change: AudioEdit) => void }) {
  const ask = file.supplierAsk!;
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded bg-foreground px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-background">{ask.question}</summary>
      <div className="absolute right-0 z-10 mt-1 w-56 rounded border border-border bg-card p-2 shadow">
        <p className="mb-1 text-xs text-muted-foreground">{SUPPLIER_QUESTION}</p>
        {ask.choices.map((choice) => (
          <button key={choice.value} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-background" onClick={() => onEdit(file.id, { kind: "supplier", supplier: choice.value as "client" | "artist_team" })}>
            {choice.label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** CT4 / CT5: the waveform with the drop marker and the window, the length chips, and the 9:16 preview. */
export function TrackEditor({ title, file, preview, onEdit }: { title: string; file: FileView; preview: Preview | null; onEdit: (change: AudioEdit) => void }) {
  const [drag, setDrag] = useState<{ kind: "drop" | "window"; at: number; offset: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const duration = Math.max(1, file.durationS);
  const dropS = drag?.kind === "drop" ? drag.at : file.dropS;
  const startS = drag?.kind === "window" ? drag.at : drag?.kind === "drop" ? Math.max(0, drag.at - SNIPPET.preDrop) : file.startS;
  const x = (s: number) => (s / duration) * 1000;
  const secondsAt = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.min(duration, Math.max(0, ((clientX - box.left) / box.width) * duration));
  };
  const ticks = (step: number) => Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  const line = file.dropSource ? `${file.dropSource} · ${spanText(startS, file.lengthS)}` : null;

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_11.25rem]">
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {line ? <p className="text-xs text-muted-foreground">{line}</p> : <p className="text-xs text-destructive">{NO_CLEAR_DROP}</p>}
        <div className="sm:hidden">
          <PreviewPane preview={preview} lengthS={file.lengthS} startS={startS} />
        </div>
        <svg
          ref={svg}
          viewBox="0 0 1000 120"
          preserveAspectRatio="none"
          className="h-28 w-full touch-none select-none"
          onPointerMove={(e) => {
            if (!drag) return;
            const s = secondsAt(e.clientX);
            setDrag({ ...drag, at: drag.kind === "window" ? Math.max(0, Math.min(duration - file.lengthS, s - drag.offset)) : s });
          }}
          onPointerUp={() => {
            if (!drag) return;
            onEdit(drag.kind === "drop" ? { kind: "drop", dropS: drag.at } : { kind: "window", startS: drag.at });
            setDrag(null);
          }}
          onPointerLeave={() => setDrag(null)}
        >
          {file.waveform.map((peak, i) => {
            const w = 1000 / Math.max(1, file.waveform.length);
            const h = Math.max(1, peak * 90);
            return <rect key={i} x={i * w} y={55 - h / 2} width={Math.max(0.6, w * 0.7)} height={h} className="fill-foreground/35" />;
          })}
          <rect
            x={x(startS)}
            y={4}
            width={x(file.lengthS)}
            height={102}
            className="cursor-grab fill-foreground/10 stroke-foreground"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag({ kind: "window", at: startS, offset: secondsAt(e.clientX) - startS });
            }}
          />
          {dropS != null ? (
            <g
              className="cursor-ew-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDrag({ kind: "drop", at: dropS, offset: 0 });
              }}
            >
              <line x1={x(dropS)} x2={x(dropS)} y1={0} y2={110} className="stroke-destructive" strokeWidth={3} vectorEffect="non-scaling-stroke" />
              <rect x={x(dropS) - 12} y={0} width={24} height={110} fill="transparent" />
            </g>
          ) : null}
        </svg>
        {dropS != null ? <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">{dropLabel(dropS)}</p> : null}
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground max-sm:hidden">
          {ticks(60).map((t) => <span key={t}>{mmss(t)}</span>)}
        </div>
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground sm:hidden">
          {[0, Math.floor(duration / 2 / 30) * 30, Math.floor(duration / 30) * 30].map((t, i) => <span key={i}>{mmss(t)}</span>)}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Length">
          {LENGTHS.map((len, i) => (
            <button
              key={len}
              type="button"
              aria-pressed={file.lengthS === len}
              onClick={() => onEdit({ kind: "length", lengthS: len })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${file.lengthS === len ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
            >
              <span className="max-sm:hidden">{`${len} s`}</span>
              <span className="sm:hidden">{i === LENGTHS.length - 1 ? `${len} s` : String(len)}</span>
            </button>
          ))}
        </div>
        {file.note && file.noteTone === "plain" ? <p className="text-[11.5px] text-muted-foreground">{file.note}</p> : null}
      </div>
      <div className="max-sm:hidden">
        <PreviewPane preview={preview} lengthS={file.lengthS} startS={startS} />
      </div>
    </div>
  );
}

function PreviewPane({ preview, lengthS, startS }: { preview: Preview | null; lengthS: number; startS: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="relative mx-auto aspect-[9/16] w-[11.25rem] overflow-hidden rounded bg-black">
        {preview?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/60">9:16 static</span>
        )}
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!preview?.audioUrl}
          onClick={() => {
            const el = audio.current;
            if (!el) return;
            if (el.paused) void el.play().then(() => setPlaying(true));
            else {
              el.pause();
              setPlaying(false);
            }
          }}
          className="absolute bottom-2 left-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white disabled:opacity-40"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        {preview?.audioUrl ? <audio ref={audio} src={preview.audioUrl} preload="auto" onEnded={() => setPlaying(false)} /> : null}
      </div>
      <p className="text-center font-mono text-[10px] text-muted-foreground">{spanText(startS, lengthS)}</p>
      {preview?.failed ? <p className="text-center text-xs text-destructive">{PREVIEW_FAILED}</p> : null}
    </div>
  );
}

const RENDER_STATUS: Record<string, string> = { queued: "Queued", rendering: "Rendering", done: "Ready", failed: "Failed" };

function SnippetRenders({ renders, onAction }: { renders: RenderView[]; onAction: (action: "approve" | "retryDrive" | "retryRender", id: string) => void }) {
  return (
    <div className="space-y-1">
      {renders.map((r) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border py-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm">{r.tag ?? r.fileName}</p>
            {r.tag && r.fileName ? <p className="truncate font-mono text-[11px] text-muted-foreground">{r.fileName}</p> : null}
            {r.note ? <p className="text-[11.5px] text-muted-foreground">{r.note}</p> : null}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={r.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{RENDER_STATUS[r.status] ?? r.status}</span>
            {r.status === "done" && !r.approved ? (
              <button type="button" onClick={() => onAction("approve", r.id)} className="rounded bg-foreground px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-background">
                Approve
              </button>
            ) : null}
            {r.status === "failed" ? (
              <button type="button" onClick={() => onAction("retryRender", r.id)} className="underline">
                Retry
              </button>
            ) : null}
            {r.driveFailed ? (
              <button type="button" onClick={() => onAction("retryDrive", r.id)} className="underline">
                Drive copy failed — retry
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
