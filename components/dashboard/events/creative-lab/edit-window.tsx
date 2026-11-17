"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  VW_LINES,
  dropLines,
  stepDropIn,
  stepLength,
  timelineTicks,
  windowState,
  type EditWindow,
  type StoredDrops,
  type WindowChoice,
  type WindowRequest,
} from "@/lib/creative-lab/edit-window";

/** A run of stepper clicks saves once, this long after the last. */
const SAVE_AFTER_MS = 700;

/**
 * VW4 and VW5 (docs/design-record/2026-11-17-creative-lab-video-window.html):
 * the edit window on a clip. The waveform marks the window and the drop
 * ("DROP"), the drops list says which is in use, and the two steppers move
 * the window inside VW2's limits. A refused clip shows VW3's chip and
 * sentence, with "Use the drop at …" when another drop fits. At 393 it is
 * the same, stacked, with the timeline every 20 s.
 */
export function EditWindowPicker({
  clipName,
  drops,
  choice,
  busy = false,
  onSave,
}: {
  clipName: string;
  drops: StoredDrops;
  choice: WindowChoice;
  busy?: boolean;
  onSave?: (request: WindowRequest) => void;
}) {
  const state = windowState(drops, choice);
  const [draft, setDraft] = useState<EditWindow | null>(state.kind === "ok" ? state.window : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateKey = state.kind === "ok" ? `${state.window.inS}-${state.window.outS}-${state.window.dropS}` : state.kind;
  useEffect(() => {
    if (state.kind === "ok") setDraft(state.window);
    // Only when the stored window itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const heading = `${VW_LINES.heading} · ${clipName}`;
  if (state.kind === "pending") return null;

  if (state.kind === "refused") {
    return (
      <section className="w-full max-w-[640px] space-y-2 rounded border border-border bg-card p-3 text-sm">
        <h3 className="font-medium">{heading}</h3>
        <RefusalBlock chip={state.chip} sentence={state.sentence} useDropS={state.useDrop?.tS ?? null} busy={busy} onUse={(dropS) => onSave?.({ action: "useDrop", dropS })} />
      </section>
    );
  }

  const durationS = state.drops.durationS;
  const shown = draft ?? state.window;
  const byHand = state.byHand || (!!state.detected && (Math.abs(shown.inS - state.detected.inS) > 0.0005 || Math.abs(shown.outS - state.detected.outS) > 0.0005));
  const lines = dropLines(state);

  const nudge = (next: EditWindow | null) => {
    if (!next || busy) return;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave?.({ action: "nudge", dropS: next.dropS, dropInS: next.dropInS, lengthS: next.lengthS }), SAVE_AFTER_MS);
  };

  return (
    <section className="w-full max-w-[640px] space-y-3 rounded border border-border bg-card p-3 text-sm">
      <div>
        <h3 className="font-medium">{heading}</h3>
        <p className="text-xs text-muted-foreground tabular-nums">{VW_LINES.summary(shown, byHand)}</p>
      </div>
      <Waveform peaks={state.drops.peaks} durationS={durationS} window={shown} others={lines.filter((l) => !l.inUse).map((l) => l.tS)} />
      <ul className="divide-y divide-border border-y border-border">
        {lines.map((line) => (
          <li key={line.tS} className="flex items-center justify-between gap-2 py-1.5">
            <span className="tabular-nums">
              {line.main ? <b className="font-semibold">{line.label}</b> : line.label} · {line.rises}
              {line.fits ? null : <span className="text-muted-foreground"> · {VW_LINES.doesntFit}</span>}
            </span>
            {line.inUse ? (
              <span className="text-xs text-muted-foreground">{VW_LINES.inUse}</span>
            ) : line.fits ? (
              <button type="button" className="shrink-0 rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => onSave?.({ action: "useDrop", dropS: line.tS })}>
                {VW_LINES.useThisDrop}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stepper
          label={VW_LINES.dropInAt}
          value={`${shown.dropInS.toFixed(1)} s`}
          range={VW_LINES.dropInRange}
          onLess={stepDropIn(shown, -1, durationS) ? () => nudge(stepDropIn(shown, -1, durationS)) : null}
          onMore={stepDropIn(shown, 1, durationS) ? () => nudge(stepDropIn(shown, 1, durationS)) : null}
          busy={busy}
        />
        <Stepper
          label={VW_LINES.length}
          value={`${Math.round(shown.lengthS)} s`}
          range={VW_LINES.lengthRange}
          onLess={stepLength(shown, -1, durationS) ? () => nudge(stepLength(shown, -1, durationS)) : null}
          onMore={stepLength(shown, 1, durationS) ? () => nudge(stepLength(shown, 1, durationS)) : null}
          busy={busy}
        />
      </div>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" disabled={busy || !byHand} onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        if (state.detected) setDraft(state.detected);
        onSave?.({ action: "reset" });
      }}>
        {VW_LINES.back}
      </Button>
    </section>
  );
}

/** VW3 as VW-B draws it: the chip, the sentence, and "Use the drop at …" when another drop fits. */
export function RefusalBlock({ chip, sentence, useDropS, busy = false, onUse }: { chip: string; sentence: string; useDropS: number | null; busy?: boolean; onUse?: (dropS: number) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="inline-block rounded border border-destructive px-1.5 py-0.5 text-xs font-medium text-destructive">{chip}</span>
      <p className="text-xs">{sentence}</p>
      {useDropS != null ? (
        <button type="button" className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => onUse?.(useDropS)}>
          {VW_LINES.dropAction(useDropS)}
        </button>
      ) : null}
    </div>
  );
}

function Stepper({ label, value, range, onLess, onMore, busy }: { label: string; value: string; range: string; onLess: (() => void) | null; onMore: (() => void) | null; busy: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`${label} less`} className="h-7 w-7 rounded border border-border disabled:opacity-40" disabled={busy || !onLess} onClick={onLess ?? undefined}>−</button>
        <b className="min-w-12 text-center font-semibold tabular-nums">{value}</b>
        <button type="button" aria-label={`${label} more`} className="h-7 w-7 rounded border border-border disabled:opacity-40" disabled={busy || !onMore} onClick={onMore ?? undefined}>+</button>
        <span className="text-xs text-muted-foreground">{range}</span>
      </div>
    </div>
  );
}

/** The clip's sound with the window boxed and the drop marked (VW5, as CT4's marker). */
function Waveform({ peaks, durationS, window, others }: { peaks: number[]; durationS: number; window: EditWindow; others: number[] }) {
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / Math.max(0.001, durationS)) * 100))}%`;
  const bars = peaks.length ? peaks : [0];
  return (
    <div>
      <div className="relative mt-7 h-14">
        <div className="absolute inset-0 flex items-center gap-px" aria-hidden>
          {bars.map((p, i) => (
            <span key={i} className="flex-1 rounded-sm bg-muted-foreground/40" style={{ height: `${Math.max(4, p * 100)}%` }} />
          ))}
        </div>
        <div className="absolute -inset-y-1 rounded border-2 border-foreground bg-card/40" style={{ left: pct(window.inS), width: pct(window.outS - window.inS) }} />
        {others.map((t) => (
          <div key={t} className="absolute -inset-y-2 w-0.5 bg-destructive opacity-35" style={{ left: pct(t) }} />
        ))}
        <div className="absolute -inset-y-2 w-0.5 bg-destructive" style={{ left: pct(window.dropS) }}>
          <span className="absolute -top-4 -left-4 font-mono text-[9px] font-bold tracking-widest text-destructive">{VW_LINES.dropMarker}</span>
        </div>
      </div>
      <div className="mt-2 hidden justify-between font-mono text-[10px] text-muted-foreground sm:flex">
        {timelineTicks(durationS, false).map((t) => <span key={t}>{t}</span>)}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground sm:hidden">
        {timelineTicks(durationS, true).map((t) => <span key={t}>{t}</span>)}
      </div>
    </div>
  );
}
