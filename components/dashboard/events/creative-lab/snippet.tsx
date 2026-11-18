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
import { LENGTHS, NO_CLEAR_DROP, PREVIEW_FAILED, SNIPPET, SNIPPET_TAB, dropLabel, spanText, mmss } from "@/lib/creative-tests/snippet";
import { makeButtonText, pickerHeading, pickerHeadingShort, type FileView, type PickerRow, type RenderView, type SnippetView } from "@/lib/creative-tests/snippet-view";

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
      {view.actName && view.rows.length ? (
        <p className="text-sm font-medium">
          <span className="max-sm:hidden">{pickerHeading(view.actName, picked.length)}</span>
          <span className="sm:hidden">{pickerHeadingShort(view.actName, picked.length)}</span>
        </p>
      ) : null}

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
            <summary style={FILE_NAME_STYLE} className="cursor-pointer list-none rounded border border-border-strong bg-background px-3 py-1.5 text-sm">{chosenStatic?.label ?? view.statics[0]!.label}</summary>
            <div className="absolute z-10 mt-1 max-h-64 w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded border border-border bg-card p-1 shadow">
              {view.statics.map((s) => (
                <button key={s.driveFileId} type="button" style={FILE_NAME_STYLE} className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-background" onClick={() => setStaticId(s.driveFileId)}>
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
  // AU2 / AU3: a matched file that passes AU1 and isn't flagged; a Drive file in no top track picks as itself (CT3).
  const canTick = Boolean(file) && !file!.flagged && file!.noteTone !== "failed" && (file!.pickable || (!row.trackId && !file!.suggestion));
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
        <button type="button" onClick={onOpen} disabled={!file} style={FILE_NAME_STYLE} className="block max-w-full truncate text-left text-sm disabled:cursor-default">
          {extra ? <span className="font-mono text-xs">{title}</span> : title}
        </button>
        {row.empty ? <p className="text-[11.5px] text-muted-foreground">{row.empty}</p> : null}
        {file?.note ? <p style={FILE_NAME_STYLE} className={`text-[11.5px] ${file.noteTone === "plain" ? "text-muted-foreground" : "text-destructive"}`}>{file.note}</p> : null}
      </div>
      <div className="col-start-3 flex flex-wrap items-center justify-start gap-2 empty:hidden sm:col-start-auto sm:justify-end">
        {file?.suggestion ? (
          <button type="button" onClick={() => onEdit(file.id, { kind: "match", trackId: file.suggestion!.trackId, title: file.suggestion!.title })} className="rounded border border-foreground px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]">
            Match
          </button>
        ) : null}
        {file?.dropLabel && !file.suggestion && file.noteTone !== "failed" ? <span className="max-sm:hidden font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">{file.dropLabel}</span> : null}
      </div>
    </div>
  );
}

/** A label at a fraction of the track: start-aligned at the left edge, end-aligned at the right, centred between. */
function labelShift(fraction: number): string {
  if (fraction < 0.04) return "0%";
  if (fraction > 0.96) return "-100%";
  return "-50%";
}

/** Whole minutes before the end, then the end itself when it is at least 6 % of the track past the last minute. */
function timeLabels(durationS: number): { s: number; end: boolean }[] {
  const labels: { s: number; end: boolean }[] = [];
  for (let s = 0; s < durationS; s += 60) labels.push({ s, end: false });
  const last = labels[labels.length - 1]?.s ?? 0;
  if ((durationS - last) / durationS >= 0.06) labels.push({ s: durationS, end: true });
  return labels;
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
  const line = file.dropSource ? `${file.dropSource} · ${spanText(startS, file.lengthS)}` : null;

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_11.25rem]">
      <div className="min-w-0 space-y-2">
        <p style={FILE_NAME_STYLE} className="text-sm font-medium">{title}</p>
        {line ? <p className="text-xs text-muted-foreground">{line}</p> : <p className="text-xs text-destructive">{NO_CLEAR_DROP}</p>}
        <div className="sm:hidden">
          <PreviewPane preview={preview} lengthS={file.lengthS} startS={startS} />
        </div>
        {dropS != null ? (
          // Design, 17 Nov: the drop label sits above the marker line, not loose under the waveform.
          <div className="relative h-4">
            <span
              className="absolute bottom-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-destructive"
              style={{ left: `${(dropS / duration) * 100}%`, transform: `translateX(${labelShift(dropS / duration)})` }}
            >
              {dropLabel(dropS)}
            </span>
          </div>
        ) : null}
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
        {/* Design, 17 Nov: each minute label at its real time on the track; the end label is the track's length, or nothing when it would crowd the last minute. */}
        <div className="relative h-3.5 font-mono text-[10px] text-muted-foreground">
          {timeLabels(duration).map((label) => (
            <span
              key={label.s}
              className={`absolute top-0 whitespace-nowrap ${label.end ? "max-sm:hidden" : ""}`}
              style={{ left: `${(label.s / duration) * 100}%`, transform: `translateX(${label.end ? "-100%" : labelShift(label.s / duration)})` }}
            >
              {mmss(label.s)}
            </span>
          ))}
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

/** Design, 17 Nov: file names keep their x — the font's contextual alternates turn "9x16" into "9×16". */
const FILE_NAME_STYLE = { fontFeatureSettings: '"calt" 0' } as const;

const RENDER_STATUS: Record<string, string> = { queued: "Queued", rendering: "Rendering", done: "Ready", failed: "Failed" };

function SnippetRenders({ renders, onAction }: { renders: RenderView[]; onAction: (action: "approve" | "retryDrive" | "retryRender", id: string) => void }) {
  return (
    <div className="space-y-1">
      {renders.map((r) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border py-1.5">
          <div className="min-w-0">
            <p style={FILE_NAME_STYLE} className="truncate text-sm">{r.tag ?? r.fileName}</p>
            {r.tag && r.fileName ? <p style={FILE_NAME_STYLE} className="truncate font-mono text-[11px] text-muted-foreground">{r.fileName}</p> : null}
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
