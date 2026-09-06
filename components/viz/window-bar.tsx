"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { formatVizMoment, formatVizRelative } from "@/lib/viz/format-moment";
import {
  WINDOW_BAR_HEIGHT_PX,
  WINDOW_HANDLE_LABEL_LANE_PX,
  WINDOW_MOMENT_LABEL_WIDTH,
  WINDOW_MOMENT_LANE_PX,
  WINDOW_RAIL_LANE_PX,
  applyWindowHandle,
  collapseOverlappingMomentLabels,
  dateToRatio,
  estimateHandleLabelWidth,
  handleLabelLeftPx,
  momentGlyph,
  nudgeWindowHandle,
  resolveMomentGlyphCollision,
  snapToMoments,
  windowPlaceholders,
  windowSpanMs,
  type WindowHandle,
  type WindowMoment,
} from "@/lib/viz/window-bar";
import { formatPaceSentence, paceFillRatio, windowPaceState, type WindowPace } from "@/lib/viz/pace";
import { VIZ_LINE_TOKEN, VIZ_TYPE, VIZ_TYPE_NUM } from "@/lib/viz/tokens";

import { InfoTip } from "./info-tip";

export function WindowBar({
  moments,
  start,
  end,
  onChange,
  min,
  now,
  tip,
  empty = false,
  emptyLabel = "set start and end",
  endLabel,
  pace,
}: {
  moments: WindowMoment[];
  start: Date;
  end: Date;
  onChange: (next: { start: Date; end: Date }) => void;
  min?: Date;
  now?: Date;
  tip?: string;
  empty?: boolean;
  emptyLabel?: string;
  /** Replaces the end handle's date when the plan has no valid end (J24). */
  endLabel?: string;
  pace?: WindowPace;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [dragging, setDragging] = useState<WindowHandle | null>(null);
  const [clamped, setClamped] = useState(false);
  const [flash, setFlash] = useState(false);
  const clock = now ?? new Date();
  const { from, to } = windowSpanMs(start, end, min);
  const placeholders = windowPlaceholders(moments, from, to);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setBarWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  const width = barWidth || 1;
  const marks = [
    ...moments.map((moment) => ({
      id: moment.id,
      noun: moment.label,
      x: dateToRatio(moment.at, from, to) * width,
      width: WINDOW_MOMENT_LABEL_WIDTH,
      missing: false,
      tip: undefined as string | undefined,
    })),
    ...placeholders.map((placeholder) => ({
      id: placeholder.id,
      noun: placeholder.label,
      x: placeholder.ratio * width,
      width: WINDOW_MOMENT_LABEL_WIDTH,
      missing: true,
      tip: placeholder.tip,
    })),
  ];
  const hiddenNouns = collapseOverlappingMomentLabels(marks);
  const collision = resolveMomentGlyphCollision(
    marks.map((mark) => ({
      id: mark.id,
      noun: mark.noun,
      ratio: width > 1 ? mark.x / width : 0,
    })),
  );
  const paceState = windowPaceState({
    empty,
    spent: pace?.spent,
    planned: pace?.planned,
    tone: pace?.tone,
  });
  const todayMoment = moments.find((moment) => moment.label === "now" || moment.id === "now");
  const todayPct = dateToRatio(todayMoment?.at ?? clock, from, to) * 100;
  const startToToday = Math.max(0, todayPct - startPct);
  const paceWidth = startToToday * paceFillRatio(pace?.spent ?? 0, pace?.planned ?? 0);
  const paceToneClass =
    pace && paceState !== "no-reads" && paceState !== "junk-window"
      ? pace.tone === "neutral" || pace.tone === "none"
        ? "bg-foreground/45"
        : pace.tone === "above"
          ? "bg-success"
          : "bg-warning"
      : "";

  const startText = formatVizMoment(start);
  const endRelative = endLabel ? undefined : formatVizRelative(end, clock);
  const endText = endLabel ?? `${formatVizMoment(end)} · ${endRelative}`;
  const startLeft = handleLabelLeftPx({
    handlePx: (startPct / 100) * width,
    labelWidth: estimateHandleLabelWidth(startText),
    barWidth: width,
    align: "start",
  });
  const endLeft = handleLabelLeftPx({
    handlePx: (endPct / 100) * width,
    labelWidth: estimateHandleLabelWidth(endText),
    barWidth: width,
    align: "end",
  });

  return (
    <div
      className="relative"
      data-state={empty ? "empty" : clamped ? "clamped" : dragging ? "dragging" : "default"}
      style={{ minHeight: WINDOW_BAR_HEIGHT_PX }}
    >
      <div
        ref={trackRef}
        className="relative"
        style={{ height: WINDOW_MOMENT_LANE_PX + WINDOW_RAIL_LANE_PX + WINDOW_HANDLE_LABEL_LANE_PX }}
      >
        <div className="relative" style={{ height: WINDOW_MOMENT_LANE_PX }}>
          {tip ? (
            <div className="absolute right-0 top-0 z-10">
              <InfoTip variant="card" label={tip} />
            </div>
          ) : null}
          {marks.map((mark) => (
            <MomentMark
              key={mark.id}
              pct={width > 1 ? (mark.x / width) * 100 : 0}
              glyph={momentGlyph(mark.noun)}
              noun={collision.joinedLabel.get(mark.id) ?? mark.noun}
              missing={mark.missing}
              hideNoun={hiddenNouns.has(mark.id)}
              hideGlyph={collision.hideGlyphIds.has(mark.id)}
              tip={
                hiddenNouns.has(mark.id)
                  ? [collision.joinedLabel.get(mark.id) ?? mark.noun, mark.tip].filter(Boolean).join(" · ")
                  : mark.tip
              }
            />
          ))}
        </div>

        <div className="relative" style={{ height: WINDOW_RAIL_LANE_PX }} data-pace={paceState}>
          <div
            className={`absolute inset-x-0 top-[3px] h-1 rounded-full ${
              empty ? "border border-dashed border-muted-foreground/40 bg-transparent" : "bg-foreground/10"
            } ${flash ? "shadow-[inset_0_0_0_2px_var(--warning)]" : ""}`}
          />
          {empty ? null : (
            <div
              className="absolute top-[3px] h-1 rounded-full bg-foreground/45"
              style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
            />
          )}
          {pace && paceState !== "junk-window" ? (
            <>
              <div
                className={`absolute bottom-0 h-1 rounded-full ${pace?.lineKind ? VIZ_LINE_TOKEN[pace.lineKind] : ""} ${
                  paceState === "no-reads" ? "bg-transparent" : paceToneClass
                }`}
                style={{ left: `${startPct}%`, width: `${paceWidth}%` }}
                aria-label={formatPaceSentence(pace.spent, pace.planned)}
              />
              <span
                className="absolute bottom-0 w-0.5 bg-foreground"
                style={{ left: `${todayPct}%`, height: 4 }}
                aria-hidden="true"
              />
            </>
          ) : null}
          <HandleButton
            name="start"
            pct={startPct}
            dragging={dragging === "start"}
            onPointerDown={(event) => onHandlePointerDown(event, "start")}
            onPointerMove={(event) => onHandlePointerMove(event, "start")}
            onPointerUp={onHandlePointerUp}
            onKeyDown={(event) => onHandleKey(event, "start")}
          />
          <HandleButton
            name="end"
            pct={endPct}
            dragging={dragging === "end"}
            onPointerDown={(event) => onHandlePointerDown(event, "end")}
            onPointerMove={(event) => onHandlePointerMove(event, "end")}
            onPointerUp={onHandlePointerUp}
            onKeyDown={(event) => onHandleKey(event, "end")}
          />
        </div>

        <div className="relative" style={{ height: WINDOW_HANDLE_LABEL_LANE_PX }}>
          {empty ? (
            <span className={`absolute left-0 top-0 ${VIZ_TYPE.label} text-muted-foreground`}>
              {emptyLabel}
            </span>
          ) : (
            <>
              <HandleLabel
                name="start"
                left={startLeft}
                width={estimateHandleLabelWidth(startText)}
                at={start}
              />
              <HandleLabel
                name="end"
                left={endLeft}
                width={estimateHandleLabelWidth(endText)}
                at={end}
                relative={endRelative}
                text={endLabel}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MomentMark({
  pct,
  glyph,
  noun,
  missing = false,
  hideNoun = false,
  hideGlyph = false,
  tip,
}: {
  pct: number;
  glyph: string;
  noun: string;
  missing?: boolean;
  hideNoun?: boolean;
  hideGlyph?: boolean;
  tip?: string;
}) {
  return (
    <div
      className={`absolute top-0 -translate-x-1/2 text-center ${missing ? "opacity-35" : "text-foreground/70"}`}
      style={{ left: `${pct}%` }}
    >
      {hideGlyph ? null : (
      <span className={`block ${VIZ_TYPE.body} leading-none`} aria-hidden="true">
        {glyph}
      </span>
      )}
      {hideNoun ? (
        tip ? <InfoTip variant="card" label={tip} /> : null
      ) : (
        <span className={`mt-0.5 flex items-center justify-center gap-0.5 whitespace-nowrap ${VIZ_TYPE.label}`}>
          {noun}
          {missing && tip ? <InfoTip variant="card" label={tip} /> : null}
        </span>
      )}
    </div>
  );
}

function HandleButton({
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
      className="absolute top-1/2 flex h-6 w-[27px] -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
      style={{ left: `${pct}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="h-4 w-[3px] bg-foreground" aria-hidden="true" />
    </button>
  );
}

function HandleLabel({
  name,
  left,
  width,
  at,
  relative,
  text,
}: {
  name: WindowHandle;
  left: number;
  width: number;
  at: Date;
  relative?: string;
  text?: string;
}) {
  const end = name === "end";
  return (
    <div
      data-window-handle-label={name}
      className={`absolute top-0 whitespace-nowrap ${end ? "text-right" : "text-left"}`}
      style={{ left, width }}
    >
      <span className={`block whitespace-nowrap ${VIZ_TYPE.label}`}>{name}</span>
      <span className={`block whitespace-nowrap ${VIZ_TYPE_NUM.body}`}>
        {text ?? formatVizMoment(at)}
        {end && relative && !text ? (
          <span className={`ml-1 whitespace-nowrap ${VIZ_TYPE_NUM.micro} text-muted-foreground`}>
            · {relative}
          </span>
        ) : null}
      </span>
    </div>
  );
}
