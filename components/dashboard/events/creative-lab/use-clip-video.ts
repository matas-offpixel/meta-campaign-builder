"use client";

import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";

import { posterTime, scrubWindow } from "@/lib/creative-lab/surface";

/**
 * One clip's video, shared by the clip tile and the caption overlay.
 *
 * - Rests on the poster frame (0.5 s in, or in_s). Metadata can arrive
 *   before hydration, when onLoadedMetadata is not attached yet, so the
 *   mount effect seeks too.
 * - Plays and scrubs only the part that runs: in_s to the out point or
 *   the file's end, 30 seconds at most, and stops at its end.
 */
export function useClipVideo(inS: number, outS: number | null) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(inS);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const span = scrubWindow(inS, outS, duration);

  function rest(node: HTMLVideoElement) {
    setDuration(Number.isFinite(node.duration) ? node.duration : null);
    const at = posterTime(inS, outS);
    node.currentTime = at;
    setTime(at);
  }

  useEffect(() => {
    const node = ref.current;
    if (node && node.readyState >= HTMLMediaElement.HAVE_METADATA) rest(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  function toggle() {
    const node = ref.current;
    if (!node) return;
    if (node.paused) {
      if (span.end != null && node.currentTime >= span.end) node.currentTime = span.start;
      void node.play();
    } else node.pause();
  }

  function seek(next: number) {
    if (ref.current) ref.current.currentTime = next;
    setTime(next);
  }

  const videoProps = {
    ref,
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => rest(event.currentTarget),
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => {
      const node = event.currentTarget;
      if (node.currentTime < span.start) node.currentTime = span.start;
      if (span.end != null && node.currentTime >= span.end) {
        node.pause();
        node.currentTime = span.start;
      }
      setTime(node.currentTime);
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onClick: toggle,
  };

  const rangeProps = {
    type: "range" as const,
    min: span.start,
    max: span.end ?? span.start + 0.1,
    step: 0.1,
    value: Math.min(Math.max(time, span.start), span.end ?? span.start),
    onChange: (event: ChangeEvent<HTMLInputElement>) => seek(Number(event.target.value)),
  };

  return { videoProps, rangeProps, playing, toggle };
}
