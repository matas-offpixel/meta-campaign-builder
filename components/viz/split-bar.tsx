"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  applySplitPreset,
  boundaryCount,
  moveSplitBoundary,
  splitProvenance,
  type SplitBarPreset,
  type SplitBarSegment,
} from "@/lib/viz/split-bar";
import { VIZ_PLATFORMS, type VizPlatform } from "@/lib/viz/tokens";

import { FunnelBarSegments } from "./funnel-stage-bar";
import { InfoTip } from "./info-tip";
import { PlatformGlyph } from "./platform-glyph";
import { ProvenanceBadge } from "./provenance-badge";

export function SplitBar({
  segments,
  editable = false,
  onChange,
  presets,
  platforms = [...VIZ_PLATFORMS],
  tip,
}: {
  segments: SplitBarSegment[];
  editable?: boolean;
  onChange?: (segments: SplitBarSegment[]) => void;
  presets?: SplitBarPreset[];
  platforms?: VizPlatform[];
  tip?: string;
}) {
  const provenance = splitProvenance(segments, presets, platforms);
  const [focusBoundary, setFocusBoundary] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);

  const trackSegments = useMemo(
    () =>
      segments.map((segment) => ({
        platform: segment.platform,
        pct: segment.pct,
        label: segment.platform,
      })),
    [segments],
  );

  const boundaries = boundaryCount(segments);

  function emit(next: SplitBarSegment[]) {
    onChange?.(next);
  }

  function onBoundaryKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!editable) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    emit(moveSplitBoundary(segments, index, delta));
  }

  function onBoundaryPointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(index);
    setFocusBoundary(index);
  }

  function onBoundaryPointerMove(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (dragging !== index || !editable) return;
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0) return;
    const leftPct = segments.slice(0, index).reduce((sum, segment) => sum + segment.pct, 0);
    const pointerPct = ((event.clientX - rect.left) / rect.width) * 100;
    emit(moveSplitBoundary(segments, index, pointerPct - (leftPct + segments[index]!.pct)));
  }

  function onBoundaryPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end gap-1.5">
        <ProvenanceBadge provenance={provenance} />
        {tip ? <InfoTip label={tip} /> : null}
      </div>
      <div
        className="relative h-6 overflow-hidden rounded-sm bg-muted/50"
        role="img"
        aria-label={segments.map((s) => `${s.platform} ${Math.round(s.pct)}`).join(" · ")}
      >
        <FunnelBarSegments segments={trackSegments} />
        {editable
          ? Array.from({ length: boundaries }, (_, index) => {
              const left = segments.slice(0, index + 1).reduce((sum, segment) => sum + segment.pct, 0);
              return (
                <button
                  key={index}
                  type="button"
                  className="absolute top-0 z-10 h-full w-2 -translate-x-1 cursor-ew-resize bg-transparent"
                  style={{ left: `${left}%` }}
                  aria-label={`split boundary ${index + 1}`}
                  aria-valuenow={Math.round(segments[index]!.pct)}
                  tabIndex={focusBoundary === index ? 0 : -1}
                  onFocus={() => setFocusBoundary(index)}
                  onKeyDown={(event) => onBoundaryKey(event, index)}
                  onPointerDown={(event) => onBoundaryPointerDown(event, index)}
                  onPointerMove={(event) => onBoundaryPointerMove(event, index)}
                  onPointerUp={onBoundaryPointerUp}
                />
              );
            })
          : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {segments.map((segment) => (
          <span key={segment.platform} className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
            <PlatformGlyph platform={segment.platform} size="sm" />
            {Math.round(segment.pct)}
          </span>
        ))}
        {editable && presets
          ? presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground hover:bg-muted"
                onClick={() => emit(applySplitPreset(platforms, preset.pct))}
              >
                {preset.label}
              </button>
            ))
          : null}
      </div>
    </div>
  );
}
