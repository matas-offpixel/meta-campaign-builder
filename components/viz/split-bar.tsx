"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  applySplitPreset,
  boundaryCount,
  moveSplitBoundary,
  splitBarLegendPlacement,
  splitProvenance,
  type SplitBarPreset,
  type SplitBarSegment,
} from "@/lib/viz/split-bar";
import {
  VIZ_ON_PLATFORM_INK,
  VIZ_PLATFORMS,
  VIZ_PLATFORM_BAR,
  VIZ_PLATFORM_INK,
  VIZ_TYPE,
  VIZ_TYPE_NUM,
  type VizPlatform,
} from "@/lib/viz/tokens";

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
  const outside = segments.filter((segment) => splitBarLegendPlacement(segment.pct) === "outside");

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

  let leftAcc = 0;
  const legendSlots = segments.map((segment) => {
    const left = leftAcc;
    leftAcc += segment.pct;
    return { segment, left };
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <ProvenanceBadge provenance={provenance} />
        {tip ? <InfoTip label={tip} /> : null}
        <div
          className="relative h-7 min-w-0 flex-1"
          role="img"
          aria-label={segments.map((s) => `${s.platform} ${Math.round(s.pct)}`).join(" · ")}
        >
          <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-sm border border-border bg-foreground/[0.06]">
            <FunnelBarSegments segments={trackSegments} />
          </div>
          {legendSlots
            .filter(({ segment }) => splitBarLegendPlacement(segment.pct) === "inside")
            .map(({ segment, left }) => (
              <span
                key={segment.platform}
                className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-1 px-1.5 ${VIZ_TYPE_NUM.body} ${VIZ_ON_PLATFORM_INK}`}
                style={{ left: `${left}%`, width: `${segment.pct}%` }}
              >
                <PlatformGlyph platform={segment.platform} size="sm" className={VIZ_ON_PLATFORM_INK} />
                {Math.round(segment.pct)}%
              </span>
            ))}
          {editable
            ? Array.from({ length: boundaries }, (_, index) => {
                const left = segments.slice(0, index + 1).reduce((sum, segment) => sum + segment.pct, 0);
                return (
                  <button
                    key={index}
                    type="button"
                    className="absolute top-1/2 z-10 h-2.5 w-3 -translate-x-1.5 -translate-y-1/2 cursor-ew-resize bg-transparent"
                    style={{ left: `${left}%` }}
                    aria-label={`split boundary ${index + 1}`}
                    aria-valuenow={Math.round(segments[index]!.pct)}
                    tabIndex={focusBoundary === index ? 0 : -1}
                    onFocus={() => setFocusBoundary(index)}
                    onKeyDown={(event) => onBoundaryKey(event, index)}
                    onPointerDown={(event) => onBoundaryPointerDown(event, index)}
                    onPointerMove={(event) => onBoundaryPointerMove(event, index)}
                    onPointerUp={onBoundaryPointerUp}
                  >
                    <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-foreground/60" />
                  </button>
                );
              })
            : null}
        </div>
        {outside.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {outside.map((segment) => (
              <span
                key={segment.platform}
                className={`inline-flex items-center gap-1 ${VIZ_TYPE_NUM.body} ${VIZ_PLATFORM_INK[segment.platform]}`}
              >
                ◄
                <PlatformGlyph platform={segment.platform} size="sm" />
                {Math.round(segment.pct)}%
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {editable && presets ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((preset) => (
            <PresetChip
              key={preset.label}
              preset={preset}
              platforms={platforms}
              onClick={() => emit(applySplitPreset(platforms, preset.pct))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PresetChip({
  preset,
  platforms,
  onClick,
}: {
  preset: SplitBarPreset;
  platforms: VizPlatform[];
  onClick: () => void;
}) {
  const shaped = preset.pct.length > 0 && platforms.length > 0;
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-sm border border-border p-1 hover:bg-muted"
      aria-label={preset.label}
      title={preset.label}
      onClick={onClick}
    >
      {shaped ? (
        <span className="inline-flex h-2.5 w-4 overflow-hidden rounded-[1px]">
          {platforms.map((platform, index) => (
            <span
              key={platform}
              className={`h-full ${VIZ_PLATFORM_BAR[platform]}`}
              style={{ width: `${preset.pct[index] ?? 0}%` }}
            />
          ))}
        </span>
      ) : (
        <span className={VIZ_TYPE.label}>{preset.label}</span>
      )}
    </button>
  );
}
