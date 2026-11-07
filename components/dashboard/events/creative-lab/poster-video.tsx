"use client";

import { useEffect, useRef } from "react";

/**
 * A still of one moment. Seeks on mount as well as on metadata, because
 * a cached file can be ready before the handler is attached.
 */
export function PosterVideo({ src, at, className }: { src: string; at: number; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const go = () => {
      if (Math.abs(node.currentTime - at) > 0.05) node.currentTime = at;
    };
    if (node.readyState >= HTMLMediaElement.HAVE_METADATA) go();
    node.addEventListener("loadedmetadata", go);
    return () => node.removeEventListener("loadedmetadata", go);
  }, [at, src]);
  return <video ref={ref} src={src} muted playsInline preload="metadata" className={className} />;
}
