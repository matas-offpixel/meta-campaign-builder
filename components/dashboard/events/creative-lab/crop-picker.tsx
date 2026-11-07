"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PosterVideo } from "@/components/dashboard/events/creative-lab/poster-video";
import { cropWindowBox } from "@/lib/creative-lab/surface";

const STRIP = [0.5, 2, 4, 6, 8, 10];

/**
 * The 9:16 window on the clip's widest frame. Drag stores crop_focus_x.
 * The six frames are the same file, seeked locally, with the same window.
 */
export function CropPicker({
  src,
  focus,
  clipNo,
  sourceWidth,
  sourceHeight,
  onSave,
}: {
  src: string | null;
  focus: number;
  clipNo: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  onSave: (focus: number) => void;
}) {
  const [value, setValue] = useState(focus);
  const box = cropWindowBox(value, sourceWidth ?? 1920, sourceHeight ?? 1080);
  return (
    <section className="w-full max-w-[460px] space-y-2 rounded border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">Crop #{clipNo} to 9:16</h3>
        <span className="text-xs text-muted-foreground">drag the window</span>
      </div>
      <CropFrame src={src} at={0.5} box={box} label={box.label} handles onFocus={setValue} />
      <div className="grid grid-cols-6 gap-1">
        {STRIP.map((time) => (
          <CropFrame key={time} src={src} at={time} box={box} />
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">The window follows across every frame; check the strip for heads cut off.</p>
        <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => onSave(value)}>Use this crop</Button>
      </div>
    </section>
  );
}

function CropFrame({
  src,
  at,
  box,
  label,
  handles,
  onFocus,
}: {
  src: string | null;
  at: number;
  box: { left: number; top: number; width: number; height: number };
  label?: string;
  handles?: boolean;
  onFocus?: (focus: number) => void;
}) {
  const left = `${box.left * 100}%`;
  const top = `${box.top * 100}%`;
  const width = `${box.width * 100}%`;
  const height = `${box.height * 100}%`;
  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded bg-black"
      onPointerDown={onFocus ? (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const originX = event.clientX;
        const span = Math.max(0.001, 1 - box.width);
        const start = box.left / span;
        const move = (point: PointerEvent) => {
          const dx = (point.clientX - originX) / rect.width;
          onFocus(Math.min(1, Math.max(0, start + dx / span)));
        };
        const up = (point: PointerEvent) => {
          move(point);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      } : undefined}
    >
      {src ? <PosterVideo src={src} at={at} className="pointer-events-none h-full w-full object-cover" /> : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/60" style={{ height: top }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60" style={{ height: `${Math.max(0, 100 - box.top * 100 - box.height * 100)}%` }} />
      <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60" style={{ width: left }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/60" style={{ width: `${Math.max(0, 100 - box.left * 100 - box.width * 100)}%` }} />
      <div className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left, top, width, height }}>
        {handles ? (
          <>
            <span className="absolute top-1/2 -left-1.5 h-8 w-2.5 -translate-y-1/2 rounded-sm bg-white" />
            <span className="absolute top-1/2 -right-1.5 h-8 w-2.5 -translate-y-1/2 rounded-sm bg-white" />
          </>
        ) : null}
      </div>
      {label ? <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/45 px-1.5 py-0.5 font-mono text-[10px] text-white">{label}</span> : null}
    </div>
  );
}
