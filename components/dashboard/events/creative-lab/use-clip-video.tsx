"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { notifyAudible, showSoundToggle, soundAction, subscribeAudible } from "@/lib/creative-lab/clip-audio";
import { posterTime, scrubWindow } from "@/lib/creative-lab/surface";

export { showSoundToggle };

export function ClipSound({ audible, onToggle, placement = "corner" }: { audible: boolean; onToggle: () => void; placement?: "corner" | "inline" }) {
  const Icon = audible ? Volume2 : VolumeX;
  const place = placement === "inline"
    ? "flex h-8 w-8 shrink-0 items-center justify-center"
    : "absolute bottom-4 left-1.5 z-10 flex h-8 w-8 items-center justify-center";
  return (
    <button
      type="button"
      aria-label={soundAction(audible)}
      className={place}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onToggle();
      }}
    >
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-black/40 text-on-media">
        <Icon size={14} aria-hidden />
      </span>
    </button>
  );
}

/**
 * One clip's video, shared by the clip tile and the caption overlay.
 *
 * - Rests on the poster frame (0.5 s in, or in_s). Metadata can arrive
 *   before hydration, when onLoadedMetadata is not attached yet, so the
 *   mount effect seeks too.
 * - Plays and scrubs only the part that runs: in_s to the out point or
 *   the file's end, 30 seconds at most, and stops at its end.
 * - Sound starts muted. Unmuting claims the page: every other player goes
 *   silent and keeps playing. React does not keep `muted` in sync, so the
 *   element is set directly. Nothing is stored.
 */
export function useClipVideo(inS: number, outS: number | null, options?: { initialAudible?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLVideoElement>(null);
  const audibleRef = useRef(options?.initialAudible === true);
  const [time, setTime] = useState(inS);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audible, setAudible] = useState(options?.initialAudible === true);
  const span = scrubWindow(inS, outS, duration);

  function rest(node: HTMLVideoElement) {
    setDuration(Number.isFinite(node.duration) ? node.duration : null);
    const at = posterTime(inS, outS);
    node.currentTime = at;
    setTime(at);
  }

  function setMuted(muted: boolean) {
    audibleRef.current = !muted;
    const node = ref.current;
    if (node) node.muted = muted;
    setAudible(!muted);
  }

  useEffect(() => {
    const node = ref.current;
    if (node) {
      node.muted = !audibleRef.current;
      if (node.readyState >= HTMLMediaElement.HAVE_METADATA) rest(node);
    }
    return subscribeAudible((who) => {
      if (who === id) return;
      audibleRef.current = false;
      setAudible(false);
      if (ref.current) ref.current.muted = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [id]);

  function toggle() {
    const node = ref.current;
    if (!node) return;
    if (node.paused) {
      if (span.end != null && node.currentTime >= span.end) node.currentTime = span.start;
      void node.play();
    } else node.pause();
  }

  function toggleSound() {
    const node = ref.current;
    if (!node) return;
    if (audibleRef.current) {
      setMuted(true);
      return;
    }
    setMuted(false);
    notifyAudible(id);
    if (node.paused) {
      if (span.end != null && node.currentTime >= span.end) node.currentTime = span.start;
      void node.play();
    }
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

  return { videoProps, rangeProps, playing, toggle, audible, toggleSound };
}
