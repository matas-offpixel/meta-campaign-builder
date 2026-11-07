"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

const STRIP = [0.5, 2, 4, 6, 8, 10];

/**
 * The 9:16 window on a wider or taller clip. Drag stores crop_focus_x.
 * The six frames are the clip file seeked locally, not a new render.
 */
export function CropPicker({
  src,
  focus,
  onSave,
}: {
  src: string | null;
  focus: number;
  onSave: (focus: number) => void;
}) {
  const [value, setValue] = useState(focus);
  const left = `${Math.min(68.4, Math.max(0, value * (100 - 31.6)))}%`;
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-muted-foreground">Crop to 9:16 · drag the window</p>
      <div
        className="relative aspect-video w-full overflow-hidden rounded bg-black"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const move = (point: PointerEvent) => {
            const next = (point.clientX - rect.left) / rect.width;
            setValue(Math.min(1, Math.max(0, next)));
          };
          move(event.nativeEvent);
          const up = (point: PointerEvent) => {
            move(point);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        {src ? <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" onLoadedMetadata={(event) => { event.currentTarget.currentTime = 0.5; }} /> : null}
        <div className="pointer-events-none absolute inset-y-0 border-2 border-white" style={{ left, width: "31.6%" }} />
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {STRIP.map((time) => (
          <div key={time} className="relative h-16 w-10 shrink-0 overflow-hidden rounded bg-black">
            {src ? <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" onLoadedMetadata={(event) => { event.currentTarget.currentTime = time; }} /> : null}
            <div className="pointer-events-none absolute inset-y-0 border border-white" style={{ left, width: "31.6%" }} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">The window follows across every frame; check the strip for heads cut off.</p>
      <Button type="button" size="sm" className="w-full" onClick={() => onSave(value)}>Use this crop</Button>
    </div>
  );
}
