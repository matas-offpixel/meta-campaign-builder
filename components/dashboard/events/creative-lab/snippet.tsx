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
 *
 * Variant pairs (docs/design-record/2026-11-18-creative-test-variant-pairs.html,
 * VP2, VP7; frame VP-A): the "Pair" switch turns the open track's one window
 * into two boxes, each with its own drop marker, label, "Starts at" and
 * "Window from". "Make pair · {Track}" renders both; "Sign off", "Record
 * artist-page approval" and "Approve variants" sit beside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AudioEdit } from "@/lib/creative-tests/audio-edits";
import {
  APPROVE_VARIANTS,
  ONE_WINDOW,
  PAIR,
  PAIR_SWITCH,
  RECORD_ARTIST_PAGE,
  SIGN_OFF,
  STARTS_AT,
  WINDOW_FROM,
  boxLine,
  clampPairStart,
  makePairText,
  orderBoxes,
  parseStartsAt,
  preciseSpan,
  preciseTime,
  trackPairLabels,
  trackPairRefusal,
  type PairBox,
} from "@/lib/creative-tests/pair";
import { LENGTHS, NO_CLEAR_DROP, PREVIEW_FAILED, SNIPPET, SNIPPET_TAB, dropLabel, spanText, mmss } from "@/lib/creative-tests/snippet";
import { pressSeconds } from "@/lib/creative-tests/press";
import { makeButtonText, pickerHeading, pickerHeadingShort, type FileView, type PairView, type PickerRow, type RenderView, type SnippetView } from "@/lib/creative-tests/snippet-view";

type Preview = { audioUrl: string | null; imageUrl: string | null; failed: boolean };

/** The pair being set on the open track: box 0 is the earlier drop (the operator's), box 1 the later (CT4's drop, VP2). */
export type PairForm = { fileId: string; lengthS: number; boxes: [PairBox, PairBox] };

/** A new pair's boxes, or the one being made for this file. */
export function pairFormFor(file: FileView, track: string, made: PairView | null): PairForm {
  if (made && made.windows.length === 2) {
    const boxes = made.windows.map((w, i) => ({ label: made.labels[i] ?? "", startS: w.startS, dropS: w.dropS })) as [PairBox, PairBox];
    return { fileId: file.id, lengthS: made.lengthS, boxes };
  }
  const [earlier, payoff] = trackPairLabels(track);
  const later = file.dropS != null ? { startS: clampPairStart(file.dropS - SNIPPET.preDrop, file.durationS, file.lengthS), dropS: file.dropS } : { startS: null, dropS: null };
  return { fileId: file.id, lengthS: file.lengthS, boxes: [{ label: earlier, startS: null, dropS: null }, { label: payoff, ...later }] };
}

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
  initialPair = false,
  initialPairForm = null,
}: {
  eventId: string;
  /** Frames pass a built view and never fetch. */
  initial?: SnippetView | null;
  initialPicks?: string[];
  initialOpen?: string | null;
  initialStatic?: string | null;
  previewFixture?: Preview | null;
  /** Frames: open the track as a pair (VP-A), with the boxes as given. */
  initialPair?: boolean;
  initialPairForm?: PairForm | null;
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
  const [pairOn, setPairOn] = useState(initialPair);
  const [form, setForm] = useState<PairForm | null>(initialPairForm);
  const [active, setActive] = useState<0 | 1>(1);

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
  const openTitle = openRow ? (openRow.trackId ? openRow.title.replace(/^\d+ · /, "") : open?.fileName ?? "") : "";
  const madePair = open ? (view?.pairs.find((p) => p.fileId === open.id && p.state === "making") ?? null) : null;

  // VP2: the boxes follow the open track; a pair being made for it opens as made.
  useEffect(() => {
    if (!pairOn || !open) return;
    setForm((f) => (f && f.fileId === open.id ? f : pairFormFor(open, openTitle, madePair)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairOn, open?.id, madePair?.testId]);

  async function edit(fileId: string, change: AudioEdit) {
    if (frame) return;
    setBusy(true);
    const res = await call(eventId, { action: "edit", fileId, edit: change });
    setBusy(false);
    if (!res.ok) setError(String(res.json.error ?? "That didn't save."));
    await load(actId);
  }

  // CT5: the preview re-renders a second after the marker, window or length stops moving. VP2: a pair's plays the box touched last.
  const pairBox = pairOn && form ? form.boxes[active] : null;
  const previewKey = open ? `${open.id}:${pairBox ? `${pairBox.startS}:${form!.lengthS}` : `${open.startS}:${open.lengthS}`}:${staticId}` : null;
  useEffect(() => {
    if (frame || !open || open.dropS == null) return;
    if (pairBox && pairBox.startS == null) return;
    const timer = setTimeout(async () => {
      const window = pairBox ? { startS: pairBox.startS, lengthS: form!.lengthS } : {};
      const res = await call(eventId, { action: "preview", fileId: open.id, ...window, static: chosenStatic ? { driveFileId: chosenStatic.driveFileId, fileName: chosenStatic.fileName } : undefined });
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

  async function pairAction(body: Record<string, unknown>, failed: string) {
    if (frame) return;
    setBusy(true);
    const res = await call(eventId, body);
    setBusy(false);
    setError(res.ok ? null : String(res.json.error ?? failed));
    await load(actId);
  }

  async function makePairNow() {
    if (!form || !chosenStatic || frame) return;
    await pairAction({ action: "makePair", fileId: form.fileId, lengthS: form.lengthS, boxes: form.boxes, static: { driveFileId: chosenStatic.driveFileId, fileName: chosenStatic.fileName } }, "The pair wasn't made.");
  }

  async function approvePair(testId: string) {
    if (frame) return;
    setBusy(true);
    const res = await fetch(`/api/creative-lab/tests/${testId}/approve`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setError(res.ok ? null : (json.error ?? "The pair wasn't approved."));
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

      {open && openRow ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={PAIR_SWITCH}>
          {[ONE_WINDOW, PAIR_SWITCH].map((word) => (
            <button
              key={word}
              type="button"
              aria-pressed={(word === PAIR_SWITCH) === pairOn}
              onClick={() => setPairOn(word === PAIR_SWITCH)}
              className={`rounded-full border px-3 py-1 text-xs ${(word === PAIR_SWITCH) === pairOn ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
            >
              {word}
            </button>
          ))}
        </div>
      ) : null}

      {open && openRow ? (
        <TrackEditor
          title={openTitle}
          file={open}
          preview={preview}
          onEdit={(change) => edit(open.id, change)}
          pair={
            pairOn && form && form.fileId === open.id
              ? {
                  form,
                  active,
                  sub: chosenStatic ? `${chosenStatic.label} · ${form.lengthS} s` : `${form.lengthS} s`,
                  onActivate: setActive,
                  onBox: (i, patch) => setForm((f) => (f ? { ...f, boxes: f.boxes.map((b, j) => (j === i ? { ...b, ...patch } : b)) as [PairBox, PairBox] } : f)),
                  onLength: (lengthS) => setForm((f) => (f ? { ...f, lengthS } : f)),
                }
              : null
          }
        />
      ) : null}

      {open && pairOn && form && form.fileId === open.id ? (
        <PairControls
          file={open}
          title={openTitle}
          form={form}
          made={madePair}
          renders={view.renders.filter((r) => r.audioFileId === open.id && r.status === "done" && r.startS != null)}
          view={view}
          busy={busy || !chosenStatic}
          onActivate={setActive}
          onBox={(i, patch) => setForm((f) => (f ? { ...f, boxes: f.boxes.map((b, j) => (j === i ? { ...b, ...patch } : b)) as [PairBox, PairBox] } : f))}
          onLength={(lengthS) => setForm((f) => (f ? { ...f, lengthS } : f))}
          onMake={makePairNow}
          onSignOff={(testId) => pairAction({ action: "signOff", testId }, "The sign-off didn't save.")}
          onArtistPage={(testId) => pairAction({ action: "artistPageApproval", testId }, "The artist-page approval didn't save.")}
          onApprove={approvePair}
        />
      ) : null}

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
        {pairOn && open ? null : (
          <button
            type="button"
            disabled={busy || held || picked.length < SNIPPET.minPicks || !chosenStatic}
            onClick={makeTest}
            className="rounded bg-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-background disabled:opacity-40"
          >
            {makeButtonText(picked.length)}
          </button>
        )}
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

/** VP2: what the waveform needs to draw a pair's two boxes. */
export type PairEditor = {
  form: PairForm;
  active: 0 | 1;
  /** "Static: {name} · {length} s". */
  sub: string;
  onActivate: (i: 0 | 1) => void;
  onBox: (i: 0 | 1, patch: Partial<PairBox>) => void;
  onLength: (lengthS: number) => void;
};

type Drag = { kind: "drop" | "window"; box: 0 | 1 | null; at: number; offset: number };

/** CT4 / CT5: the waveform with the drop marker and the window, the length chips, and the 9:16 preview. VP2: or a pair's two boxes. */
export function TrackEditor({ title, file, preview, onEdit, pair = null }: { title: string; file: FileView; preview: Preview | null; onEdit: (change: AudioEdit) => void; pair?: PairEditor | null }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const duration = Math.max(1, file.durationS);
  const lengthS = pair ? pair.form.lengthS : file.lengthS;
  const x = (s: number) => (s / duration) * 1000;
  const secondsAt = (clientX: number) => pressSeconds(clientX, svg.current?.getBoundingClientRect(), duration);

  // One window, or a pair's two boxes (each its window and its marker), as dragging leaves them.
  const boxes: { box: 0 | 1 | null; startS: number | null; dropS: number | null; active: boolean }[] = pair
    ? pair.form.boxes.map((b, i) => {
        const idx = i as 0 | 1;
        const moving = drag && drag.box === idx ? drag : null;
        const dropS = moving?.kind === "drop" ? moving.at : b.dropS;
        const startS = moving?.kind === "window" ? moving.at : moving?.kind === "drop" ? movedStart(b, moving.at, duration, lengthS) : b.startS;
        return { box: idx, startS, dropS, active: pair.active === idx };
      })
    : [
        {
          box: null,
          dropS: drag?.kind === "drop" ? drag.at : file.dropS,
          startS: drag?.kind === "window" ? drag.at : drag?.kind === "drop" ? Math.max(0, drag.at - SNIPPET.preDrop) : file.startS,
          active: true,
        },
      ];
  const shown = boxes.find((b) => b.active) ?? boxes[0]!;
  const line = pair ? pair.sub : file.dropSource ? `${file.dropSource} · ${spanText(shown.startS ?? 0, lengthS)}` : null;

  function release() {
    if (!drag) return;
    if (pair && drag.box != null) {
      const b = pair.form.boxes[drag.box];
      if (drag.kind === "drop") pair.onBox(drag.box, { dropS: round2(drag.at), startS: round2(movedStart(b, drag.at, duration, lengthS)) });
      else pair.onBox(drag.box, { startS: round2(drag.at) });
    } else onEdit(drag.kind === "drop" ? { kind: "drop", dropS: drag.at } : { kind: "window", startS: drag.at });
    setDrag(null);
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_11.25rem]">
      <div className="min-w-0 space-y-2">
        <p style={FILE_NAME_STYLE} className="text-sm font-medium">{title}</p>
        {line ? <p className="text-xs text-muted-foreground">{line}</p> : <p className="text-xs text-destructive">{NO_CLEAR_DROP}</p>}
        <div className="sm:hidden">
          <PreviewPane preview={preview} lengthS={lengthS} startS={shown.startS ?? 0} precise={Boolean(pair)} />
        </div>
        {/* Design, 17 Nov: the drop label sits above the marker line, not loose under the waveform.
            Design, 26 Nov: the row keeps its height with no drop set, so the waveform doesn't jump when a press places one. */}
        <div className="relative h-4" aria-hidden={boxes.every((b) => b.dropS == null) || undefined}>
            {boxes.map((b, i) =>
              b.dropS != null ? (
                <span
                  key={i}
                  className="absolute bottom-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-destructive"
                  style={{ left: `${(b.dropS / duration) * 100}%`, transform: `translateX(${labelShift(b.dropS / duration)})` }}
                >
                  {pair ? `DROP · ${preciseTime(b.dropS)}` : dropLabel(b.dropS)}
                </span>
              ) : null,
            )}
        </div>
        <svg
          ref={svg}
          viewBox="0 0 1000 120"
          preserveAspectRatio="none"
          className="h-28 w-full touch-none select-none"
          onPointerDown={(e) => {
            // VP2: on a pair, a press on the waveform places the active box's drop marker.
            // CT4: on one window (a file with no drop too), a press places the drop marker there and saves it, as releasing a drag does.
            if (e.target !== e.currentTarget) return;
            const at = secondsAt(e.clientX);
            if (!pair) {
              onEdit({ kind: "drop", dropS: at });
              return;
            }
            const b = pair.form.boxes[pair.active];
            pair.onBox(pair.active, { dropS: round2(at), startS: round2(movedStart(b, at, duration, lengthS)) });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const s = secondsAt(e.clientX);
            setDrag({ ...drag, at: drag.kind === "window" ? Math.max(0, Math.min(duration - lengthS, s - drag.offset)) : s });
          }}
          onPointerUp={release}
          onPointerLeave={() => setDrag(null)}
        >
          {file.waveform.map((peak, i) => {
            const w = 1000 / Math.max(1, file.waveform.length);
            const h = Math.max(1, peak * 90);
            return <rect key={i} x={i * w} y={55 - h / 2} width={Math.max(0.6, w * 0.7)} height={h} className="pointer-events-none fill-foreground/35" />;
          })}
          {boxes.map((b, i) =>
            b.startS != null ? (
              <rect
                key={`w${i}`}
                x={x(b.startS)}
                y={4}
                width={x(lengthS)}
                height={102}
                className={`cursor-grab stroke-foreground ${b.active || !pair ? "fill-foreground/10" : "fill-foreground/5"}`}
                strokeWidth={b.active || !pair ? 2 : 1}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  if (pair && b.box != null) pair.onActivate(b.box);
                  setDrag({ kind: "window", box: b.box, at: b.startS!, offset: secondsAt(e.clientX) - b.startS! });
                }}
              />
            ) : null,
          )}
          {boxes.map((b, i) =>
            b.dropS != null ? (
              <g
                key={`d${i}`}
                className="cursor-ew-resize"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  if (pair && b.box != null) pair.onActivate(b.box);
                  setDrag({ kind: "drop", box: b.box, at: b.dropS!, offset: 0 });
                }}
              >
                <line x1={x(b.dropS)} x2={x(b.dropS)} y1={0} y2={110} className="stroke-destructive" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                <rect x={x(b.dropS) - 12} y={0} width={24} height={110} fill="transparent" />
              </g>
            ) : null,
          )}
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
              aria-pressed={lengthS === len}
              onClick={() => (pair ? pair.onLength(len) : onEdit({ kind: "length", lengthS: len }))}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${lengthS === len ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
            >
              <span className="max-sm:hidden">{`${len} s`}</span>
              <span className="sm:hidden">{i === LENGTHS.length - 1 ? `${len} s` : String(len)}</span>
            </button>
          ))}
        </div>
        {file.note && file.noteTone === "plain" && !pair ? <p className="text-[11.5px] text-muted-foreground">{file.note}</p> : null}
      </div>
      <div className="max-sm:hidden">
        <PreviewPane preview={preview} lengthS={lengthS} startS={shown.startS ?? 0} precise={Boolean(pair)} />
      </div>
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** CT4 on a box: moving the marker moves the box with it, keeping the drop where it sat in the box (4 s in for a box with no window yet). */
function movedStart(box: PairBox, dropAt: number, durationS: number, lengthS: number): number {
  const offset = box.startS != null && box.dropS != null ? box.dropS - box.startS : SNIPPET.preDrop;
  return clampPairStart(dropAt - offset, durationS, lengthS);
}

/** VP2's rows under the waveform: each box's label, "Starts at", its line and "Window from"; then the refusal and the pair's buttons (VP7). */
function PairControls({
  file,
  title,
  form,
  made,
  renders,
  view,
  busy,
  onActivate,
  onBox,
  onLength,
  onMake,
  onSignOff,
  onArtistPage,
  onApprove,
}: {
  file: FileView;
  title: string;
  form: PairForm;
  made: PairView | null;
  renders: RenderView[];
  view: SnippetView;
  busy: boolean;
  onActivate: (i: 0 | 1) => void;
  onBox: (i: 0 | 1, patch: Partial<PairBox>) => void;
  onLength: (lengthS: number) => void;
  onMake: () => void;
  onSignOff: (testId: string) => void;
  onArtistPage: (testId: string) => void;
  onApprove: (testId: string) => void;
}) {
  const refusal = trackPairRefusal({ lengthS: form.lengthS, boxes: form.boxes });
  const order = orderBoxes(form.boxes.map((b, i) => ({ ...b, i: i as 0 | 1 }))).map((b) => b.i);
  const approveOff = !made || !view.isMatas || !made.signedOff || !made.rendered || busy;
  return (
    <div className="space-y-3">
      <table className="w-full text-sm max-sm:hidden">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="py-1 pr-3 font-normal">Label</th>
            <th className="py-1 pr-3 font-normal">{STARTS_AT}</th>
            <th className="py-1 pr-3 font-normal">Span</th>
            <th className="py-1 font-normal">{WINDOW_FROM}</th>
          </tr>
        </thead>
        <tbody>
          {order.map((i) => (
            <PairBoxRow key={i} i={i} box={form.boxes[i]} form={form} file={file} renders={renders} onActivate={onActivate} onBox={onBox} onLength={onLength} />
          ))}
        </tbody>
      </table>
      <div className="space-y-2 sm:hidden">
        {order.map((i) => {
          const b = form.boxes[i];
          return (
            <div key={i} className="space-y-1 rounded bg-card px-2.5 py-2 text-xs">
              <p>{b.startS != null ? `${b.label} · ${boxLine(b.startS, form.lengthS, b.dropS)}` : b.label}</p>
              <div className="flex gap-2">
                <LabelInput value={b.label} onChange={(label) => onBox(i, { label })} onFocus={() => onActivate(i)} />
                <StartInput key={`${i}:${b.startS}`} value={b.startS} onCommit={(startS) => onBox(i, { startS: clampPairStart(startS, file.durationS, form.lengthS) })} onFocus={() => onActivate(i)} />
              </div>
            </div>
          );
        })}
      </div>
      {made?.approvalLines.map((line) => (
        <p key={line} className="text-xs text-success">
          {line}
        </p>
      ))}
      {refusal ? <p className="text-xs text-destructive">{refusal}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || Boolean(refusal)} onClick={onMake} className="rounded bg-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-background disabled:opacity-40">
          {makePairText(title)}
        </button>
        {made && view.isMatas && !made.signedOff ? (
          <button type="button" disabled={busy} onClick={() => onSignOff(made.testId)} className="rounded border border-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] disabled:opacity-40">
            {SIGN_OFF}
          </button>
        ) : null}
        {made && view.isMatas && view.actHasPage && !made.artistPageRecorded ? (
          <button type="button" disabled={busy} onClick={() => onArtistPage(made.testId)} className="rounded border border-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] disabled:opacity-40">
            {RECORD_ARTIST_PAGE}
          </button>
        ) : null}
        {made?.approveBlock ? <p className="w-full text-xs text-muted-foreground sm:order-last">{made.approveBlock}</p> : null}
        <button type="button" disabled={approveOff} onClick={() => made && onApprove(made.testId)} className="rounded bg-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-background disabled:opacity-40">
          {APPROVE_VARIANTS}
        </button>
      </div>
    </div>
  );
}

function PairBoxRow({ i, box, form, file, renders, onActivate, onBox, onLength }: { i: 0 | 1; box: PairBox; form: PairForm; file: FileView; renders: RenderView[]; onActivate: (i: 0 | 1) => void; onBox: (i: 0 | 1, patch: Partial<PairBox>) => void; onLength: (lengthS: number) => void }) {
  return (
    <tr className="border-t border-border align-middle">
      <td className="py-1.5 pr-3">
        <LabelInput value={box.label} onChange={(label) => onBox(i, { label })} onFocus={() => onActivate(i)} />
      </td>
      <td className="py-1.5 pr-3">
        <StartInput key={`${i}:${box.startS}`} value={box.startS} onCommit={(startS) => onBox(i, { startS: clampPairStart(startS, file.durationS, form.lengthS) })} onFocus={() => onActivate(i)} />
      </td>
      <td className="py-1.5 pr-3 font-mono text-xs">{box.startS != null ? boxLine(box.startS, form.lengthS, box.dropS) : "—"}</td>
      <td className="py-1.5">
        {renders.length ? (
          <select
            aria-label={WINDOW_FROM}
            value=""
            onFocus={() => onActivate(i)}
            onChange={(e) => {
              // VP2: picking one of the app's own snippets of this file copies its start and length.
              const r = renders.find((x) => x.id === e.target.value);
              if (!r || r.startS == null) return;
              if (r.lengthS != null) onLength(r.lengthS);
              onBox(i, { startS: r.startS });
            }}
            className="max-w-[16rem] truncate rounded border border-border-strong bg-background px-2 py-1 text-xs"
            style={FILE_NAME_STYLE}
          >
            <option value="">—</option>
            {renders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fileName ?? r.id}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function LabelInput({ value, onChange, onFocus }: { value: string; onChange: (v: string) => void; onFocus: () => void }) {
  return <input aria-label="Label" value={value} maxLength={PAIR.labelMax} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} className="w-full min-w-0 rounded border border-border-strong bg-background px-2 py-1 text-sm max-sm:text-xs" />;
}

/** "Starts at": m:ss with up to two decimals, saved on Enter or leaving the field. */
function StartInput({ value, onCommit, onFocus }: { value: number | null; onCommit: (s: number) => void; onFocus: () => void }) {
  const [text, setText] = useState(value != null ? preciseTime(value) : "");
  const commit = () => {
    const s = parseStartsAt(text);
    if (s != null) onCommit(s);
    else setText(value != null ? preciseTime(value) : "");
  };
  return (
    <input
      aria-label={STARTS_AT}
      value={text}
      inputMode="decimal"
      placeholder="m:ss"
      onChange={(e) => setText(e.target.value)}
      onFocus={onFocus}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className="w-20 rounded border border-border-strong bg-background px-2 py-1 font-mono text-sm max-sm:text-xs"
    />
  );
}

function PreviewPane({ preview, lengthS, startS, precise = false }: { preview: Preview | null; lengthS: number; startS: number; precise?: boolean }) {
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
      {/* CT5's span; a pair's keeps its decimals, as its box line does (VP2). */}
      <p className="text-center font-mono text-[10px] text-muted-foreground">{precise ? `${preciseSpan(startS, lengthS)} · ${lengthS} s` : spanText(startS, lengthS)}</p>
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
