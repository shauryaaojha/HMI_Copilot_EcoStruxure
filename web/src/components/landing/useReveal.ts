"use client";

/**
 * Reveal on scroll, in twenty lines and no dependency.
 *
 * `animation-timeline: view()` would do this in pure CSS, but it is not in
 * Safari yet and a landing page that only animates in Chrome is worse than one
 * that animates nowhere. An IntersectionObserver adds the class once and
 * disconnects; nothing listens to scroll.
 *
 * The animation itself lives in globals.css under `.reveal`, which means it is
 * turned off with everything else by `prefers-reduced-motion` - and because the
 * reduced-motion rule also sets `opacity: 1`, a visitor who asks for no motion
 * still sees the content rather than an empty page.
 */

import { useEffect, useRef } from "react";

export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: { threshold?: number }) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Already in view on load - the hero - should not wait for a scroll that
    // may never come.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        observer.disconnect();
      },
      { threshold: options?.threshold ?? 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.threshold]);

  return ref;
}

/** The same thing for a group: every `[data-reveal]` inside, staggered. */
export function useRevealGroup<T extends HTMLElement = HTMLDivElement>(step = 80) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const items = [...node.querySelectorAll<HTMLElement>("[data-reveal]")];
    items.forEach((item, i) => {
      item.classList.add("reveal");
      item.style.setProperty("--reveal-delay", `${i * step}ms`);
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        for (const item of items) item.classList.add("is-in");
        observer.disconnect();
      },
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [step]);

  return ref;
}
