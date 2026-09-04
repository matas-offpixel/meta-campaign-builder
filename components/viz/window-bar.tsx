"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  applyWindowHandle,
  dateToRatio,
  momentGlyph,
  nudgeWindowHandle,
  relativeMomentLabel,
  snapToMoments,
  windowSpanMs,
  type WindowHandle,
  type WindowMoment,
} from "@/lib/viz/window-bar";

import { InfoTip } from "./info-tip";

export function WindowBar({
  moments,
  start,
  end,
  onChange,
  min,
  now,
  tip,
}: {
  moments: WindowMoment[];
  start: Date;
  end: Date;
  onChange: (next: { start: Date; end: Date }) => void;
  min?: Date;
  now?: Date;
  tip?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<WindowHandle | null>(null);
  const [clamped, setClamped] = useState(false);
  const clock = now ?? new Date();
  const { from, to } = windowSpanMs(start, end, min);

  function commit(handle: WindowHandle, raw: Date) {
    const trackPx = trackRef.current?.getBoundingClientRect().width ?? 0;
    const snapped = snapToMoments(raw, moments, from, to, trackPx);
    setClamped(snapped.clamped);
    onChange(applyWindowHandle(handle, snapped.at, { start, end }, min));
  }

  function onHandlePointerDown(event: PointerEvent<HTMLButtonElement>, handle: WindowHandle) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(handle);
  }

  function onHandlePointerMove(event: PointerEvent<HTMLButtonElement>, handle: WindowHandle) {
    if (dragging !== handle || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const raw = new Date(from + Math.max(0, Math.min(1, ratio)) * (to - from));
    commit(handle, raw);
  }

  function onHandlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, handle: WindowHandle) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = nudgeWindowHandle(handle, { start, end }, direction, event.shiftKey, min);
    const trackPx = trackRef.current?.getBoundingClientRect().width ?? 0;
    const snapped = snapToMoments(
      handle === "start" ? next.start : next.end,
      moments,
      from,
      to,
      trackPx,
    );
    setClamped(snapped.clamped);
    onChange(applyWindowHandle(handle, snapped.at, next, min));
  }

  const startPct = dateToRatio(start, from, to) * 100;
  const endPct = dateToRatio(end, from, to) * 100;

  return (
    <div className="space-y-2" data-state={clamped ? "clamped" : dragging ? "dragging" : "default"}>
      <div className="flex justify-end">{tip ? <InfoTip label={tip} /> : null}</div>
      <div ref={trackRef} className="relative h-8">
        <div className="absolute inset-x-0 top-3.5 h-px bg-border" />
        <div
          className="absolute top-3.5 h-px bg-foreground/40"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        {moments.map((moment) => {
          const pct = dateToRatio(moment.at, from, to) * 100;
          return (
            <div
              key={moment.id}
              className="absolute top-0 -translate-x-1/2 text-center"
              style={{ left: `${pct}%` }}
            >
              <span className="block text-[11px] leading-none" aria-hidden="true">
                {momentGlyph(moment.label)}
              </span>
              <span className="mt-3 block text-[10px] text-muted-foreground">{moment.label}</span>
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {relativeMomentLabel(moment.at, clock)}
              </span>
            </div>
          );
        })}
        <Handle
          name="start"
          pct={startPct}
          dragging={dragging === "start"}
          onPointerDown={(event) => onHandlePointerDown(event, "start")}
          onPointerMove={(event) => onHandlePointerMove(event, "start")}
          onPointerUp={onHandlePointerUp}
          onKeyDown={(event) => onHandleKey(event, "start")}
        />
        <Handle
          name="end"
          pct={endPct}
          dragging={dragging === "end"}
          onPointerDown={(event) => onHandlePointerDown(event, "end")}
          onPointerMove={(event) => onHandlePointerMove(event, "end")}
          onPointerUp={onHandlePointerUp}
          onKeyDown={(event) => onHandleKey(event, "end")}
        />
      </div>
    </div>
  );
}

function Handle({
  name,
  pct,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  name: WindowHandle;
  pct: number;
  dragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={dragging}
      className="absolute top-2 h-3 w-3 -translate-x-1/2 rounded-full border border-foreground bg-background"
      style={{ left: `${pct}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
