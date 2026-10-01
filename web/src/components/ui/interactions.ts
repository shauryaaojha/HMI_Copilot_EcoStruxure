"use client";

/**
 * Three small interactions, as hooks, with no animation dependency.
 *
 * Each one writes CSS custom properties and lets the stylesheet do the work,
 * which is what keeps them cheap: no React state, no re-render per frame, and
 * `prefers-reduced-motion` turns the result off in globals.css without any of
 * these knowing about it.
 *
 * The magnetic hook is the one exception - it moves an element directly - so
 * it asks about reduced motion itself.
 */

import { useCallback, useEffect, useRef } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A light that follows the pointer over a region. Pair with `.cursor-light`. */
export function useCursorLight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // On window, not on the node: the element this decorates is
    // `pointer-events-none` - it has to be, or it would eat every click behind
    // it - and an element that ignores the pointer never receives pointermove.
    const move = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      node.style.setProperty("--cx", `${e.clientX - r.left}px`);
      node.style.setProperty("--cy", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return ref;
}

/**
 * The same, per card: every `.spotlight` inside gets its own `--mx/--my`.
 * One listener on the container rather than one per card.
 */
export function useSpotlights<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const move = (e: PointerEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".spotlight");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    node.addEventListener("pointermove", move);
    return () => node.removeEventListener("pointermove", move);
  }, []);

  return ref;
}

/** An element that leans toward the cursor and springs back. */
export function useMagnetic<T extends HTMLElement = HTMLButtonElement>(strength = 0.22) {
  const ref = useRef<T>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const node = ref.current;
      if (!node || prefersReducedMotion()) return;
      const r = node.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) * strength;
      const dy = (e.clientY - (r.top + r.height / 2)) * strength;
      node.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    [strength],
  );

  const onPointerLeave = useCallback(() => {
    const node = ref.current;
    if (node) node.style.transform = "";
  }, []);

  return { ref, onPointerMove, onPointerLeave, style: { transition: "transform 260ms var(--ease-out)" } };
}

/** Split a line into words the stylesheet can stagger. Pair with `.word-in`. */
export function words(text: string) {
  return text.split(" ").map((word, i) => ({ word, i }));
}
