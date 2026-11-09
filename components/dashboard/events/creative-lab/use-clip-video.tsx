"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { notifyAudible, showSoundToggle, soundAction, subscribeAudible } from "@/lib/creative-lab/clip-audio";
import { posterTime, scrubWindow } from "@/lib/creative-lab/surface";

export { showSoundToggle };

export function ClipSound({ audible, onToggle }: { audible: boolean; onToggle: () => void }) {
  const Icon = audible ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      aria-label={soundAction(audible)}
      className="absolute bottom-4 left-1.5 z-10 flex h-8 w-8 items-center justify-center"
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
 * Shared playback for a clip tile and the caption overlay. Scrubbing stays
 * inside the clip's in/out window and the playhead loops back to the start.
 * Sound starts muted. Unmuting claims the page: every other player goes
 * silent and keeps playing. Nothing is stored.
 */
export function useClipVideo(inS: number, outS: number | null, options?: { initialAudible?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLVideoElement>(null);
  const audibleRef = useRef(options?.initialAudible === true);
  const [playing, setPlaying] = useState(false);
  const [audible, setAudible] = useState(options?.initialAudible === true);
  const span = scrubWindow(inS, outS);

  function rest(node: HTMLVideoElement) {
    node.currentTime = posterTime(inS);
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
    // The window is fixed for the life of the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function toggle() {
    const node = ref.current;
    if (!node) return;
    if (node.paused) {
      if (span.end != null && node.currentTime >= span.end) node.currentTime = span.start;
      void node.play();
    } else {
      node.pause();
    }
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

  function onTime(event: SyntheticEvent<HTMLVideoElement>) {
    const node = event.currentTarget;
    if (span.end != null && node.currentTime >= span.end) {
      node.currentTime = span.start;
      if (!node.paused) void node.play();
    }
  }

  function onScrub(event: ChangeEvent<HTMLInputElement>) {
    const node = ref.current;
    if (!node) return;
    node.currentTime = Number(event.target.value);
  }

  return {
    ref,
    playing,
    audible,
    toggle,
    toggleSound,
    videoProps: {
      ref,
      onClick: toggle,
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => rest(event.currentTarget),
      onTimeUpdate: onTime,
    },
    rangeProps: {
      min: span.start,
      max: span.end ?? span.start + 1,
      step: 0.1,
      onChange: onScrub,
    },
  };
}
