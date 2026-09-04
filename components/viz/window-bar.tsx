"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { formatVizMoment, formatVizRelative } from "@/lib/viz/format-moment";
import {
  applyWindowHandle,
  dateToRatio,
  momentGlyph,
  nudgeWindowHandle,
  snapToMoments,
  windowPlaceholders,
  windowSpanMs,
  type WindowHandle,
  type WindowMoment,
} from "@/lib/viz/window-bar";
import { VIZ_TYPE, VIZ_TYPE_NUM } from "@/lib/viz/tokens";

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
  const [flash, setFlash] = useState(false);
  const clock = now ?? new Date();
  const { from, to } = windowSpanMs(start, end, min);
  const placeholders = windowPlaceholders(moments, from, to);

  useEffect(() => {
    if (!clamped) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 400);
    return () => window.clearTimeout(timer);
  }, [clamped]);

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
    <div className="space-y-1" data-state={clamped ? "clamped" : dragging ? "dragging" : "default"}>
      <div className="flex justify-end">{tip ? <InfoTip label={tip} /> : null}</div>
      <div ref={trackRef} className="relative h-16">
        <div
          className={`absolute inset-x-0 top-[26px] h-1 rounded-full bg-foreground/10 ${
            flash ? "shadow-[inset_0_0_0_2px_var(--warning)]" : ""
          }`}
        />
        <div
          className="absolute top-[26px] h-1 rounded-full bg-foreground/45"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        {moments.map((moment) => {
          const pct = dateToRatio(moment.at, from, to) * 100;
          return (
            <MomentMark
              key={moment.id}
              pct={pct}
              glyph={momentGlyph(moment.label)}
              noun={moment.label}
            />
          );
        })}
        {placeholders.map((placeholder) => (
          <MomentMark
            key={placeholder.id}
            pct={placeholder.ratio * 100}
            glyph={momentGlyph(placeholder.label)}
            noun={placeholder.label}
            missing
            tip={placeholder.tip}
          />
        ))}
        <Handle
          name="start"
          pct={startPct}
          at={start}
          dragging={dragging === "start"}
          onPointerDown={(event) => onHandlePointerDown(event, "start")}
          onPointerMove={(event) => onHandlePointerMove(event, "start")}
          onPointerUp={onHandlePointerUp}
          onKeyDown={(event) => onHandleKey(event, "start")}
        />
        <Handle
          name="end"
          pct={endPct}
          at={end}
          relative={formatVizRelative(end, clock)}
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

function MomentMark({
  pct,
  glyph,
  noun,
  missing = false,
  tip,
}: {
  pct: number;
  glyph: string;
  noun: string;
  missing?: boolean;
  tip?: string;
}) {
  return (
    <div
      className={`absolute top-0 -translate-x-1/2 text-center ${missing ? "opacity-35" : "text-foreground/70"}`}
      style={{ left: `${pct}%` }}
    >
      <span className={`block ${VIZ_TYPE.body} leading-none`} aria-hidden="true">
        {glyph}
      </span>
      {missing ? (
        <span className="mx-auto mt-0.5 block h-3 border-l border-dashed border-border" />
      ) : (
        <span className="mx-auto mt-0.5 block h-3 border-l border-border" />
      )}
      <span className={`mt-0.5 flex items-center justify-center gap-0.5 ${VIZ_TYPE.label}`}>
        {noun}
        {missing && tip ? <InfoTip label={tip} /> : null}
      </span>
    </div>
  );
}

function Handle({
  name,
  pct,
  at,
  relative,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  name: WindowHandle;
  pct: number;
  at: Date;
  relative?: string;
  dragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const end = name === "end";
  return (
    <>
      <button
        type="button"
        aria-label={name}
        aria-pressed={dragging}
        className="absolute top-5 flex h-6 w-[27px] -translate-x-1/2 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
        style={{ left: `${pct}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span className="h-4 w-[3px] bg-foreground" aria-hidden="true" />
      </button>
      <div
        className={`absolute top-11 ${end ? "-translate-x-full text-right" : "text-left"}`}
        style={{ left: `${pct}%` }}
      >
        <span className={`block ${VIZ_TYPE.label}`}>{name}</span>
        <span className={`block ${VIZ_TYPE_NUM.body}`}>
          {formatVizMoment(at)}
          {end && relative ? (
            <span className={`ml-1 ${VIZ_TYPE_NUM.micro} text-muted-foreground`}>· {relative}</span>
          ) : null}
        </span>
      </div>
    </>
  );
}
