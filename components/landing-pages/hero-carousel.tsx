"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./landing-page.module.css";

/**
 * components/landing-pages/hero-carousel.tsx
 *
 * Swipeable hero carousel (PR 6). CSS scroll-snap does the swiping — no
 * JS gesture handling; an IntersectionObserver keeps the "1 of N" counter
 * honest. Keyboard accessible: the scroller is tab-focusable and
 * ArrowLeft/ArrowRight page between slides.
 *
 * Single-image case renders a plain <img> — no scroller, no counter.
 * URLs arrive pre-sanitised from the view-model seam.
 */

export function HeroCarousel({
  images,
  alt,
}: {
  images: string[];
  alt: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || images.length < 2) return;
    if (typeof IntersectionObserver === "undefined") return;

    const slides = Array.from(scroller.children);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = slides.indexOf(entry.target);
            if (index >= 0) setActiveIndex(index);
          }
        }
      },
      // A slide "wins" once most of it is inside the scroller viewport.
      { root: scroller, threshold: 0.6 },
    );
    for (const slide of slides) observer.observe(slide);
    return () => observer.disconnect();
  }, [images.length]);

  if (images.length === 0) return null;

  if (images.length === 1) {
    // External, operator-provided URL; next/image would require
    // remotePatterns per client domain.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={styles.heroSingle} src={images[0]} alt={alt} />
    );
  }

  function scrollToIndex(index: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const clamped = Math.max(0, Math.min(images.length - 1, index));
    scroller.scrollTo({
      left: clamped * scroller.clientWidth,
      behavior: "smooth",
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollToIndex(activeIndex + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollToIndex(activeIndex - 1);
    }
  }

  return (
    <div
      className={styles.carouselWrap}
      role="region"
      aria-roledescription="carousel"
      aria-label={alt}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.carouselScroller} ref={scrollerRef}>
        {images.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img
            key={`${index}-${src}`}
            className={styles.carouselSlide}
            src={src}
            alt={`${alt} — image ${index + 1} of ${images.length}`}
            loading={index === 0 ? "eager" : "lazy"}
          />
        ))}
      </div>
      <span className={styles.carouselCounter} aria-hidden="true">
        {activeIndex + 1} of {images.length} {"\u2192"}
      </span>
    </div>
  );
}
