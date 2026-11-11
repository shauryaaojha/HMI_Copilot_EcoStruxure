"use client";

/**
 * A card that leans toward the cursor: a small tilt and a lift, and back to
 * rest when the cursor leaves.
 *
 * After the magnetic cards in the Animations folder (Hover Effects/19, GSAP),
 * as two pointer handlers and a CSS transition (.magnetic in globals.css).
 * Plain handlers rather than a hook, so a card rendered in a list can take
 * them: spread `magnetic` on the element. Nothing happens on a touch screen or
 * under prefers-reduced-motion. It also keeps --mx / --my current, which is
 * what the .spotlight glow follows.
 */

import type { PointerEvent } from "react";

const STRENGTH = 6;
let reduce: boolean | null = null;

function onPointerMove(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  if (reduce === null) reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty("--mx", `${(x + 0.5) * 100}%`);
  el.style.setProperty("--my", `${(y + 0.5) * 100}%`);
  if (reduce) return;
  el.style.transform = `perspective(700px) translateY(-3px) rotateX(${(-y * STRENGTH).toFixed(2)}deg) rotateY(${(x * STRENGTH).toFixed(2)}deg)`;
}

function onPointerLeave(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.transform = "";
}

/** Spread on a card: `<button {...magnetic} className={cn("magnetic", ...)}>`. */
export const magnetic = { onPointerMove, onPointerLeave };
