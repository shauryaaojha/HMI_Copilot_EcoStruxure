"use client";

/**
 * Text that decodes into place: each character runs through a few glyphs
 * before it settles, left to right.
 *
 * After the scramble effect in the Animations folder (Text Animations/4 and
 * Sliders/5, both built on GSAP's ScrambleText plugin), written without GSAP.
 * The final text is in the DOM from the first render, for screen readers and
 * for a page that is read before it is looked at; only what is painted
 * changes. Under prefers-reduced-motion it simply shows the text.
 */

import { useEffect, useState } from "react";

const GLYPHS = "▪▫:.-+/\\_=#";

export interface ScrambleTextProps {
  text: string;
  /** Milliseconds per character to settle. */
  speed?: number;
  /** Wait before starting. */
  delay?: number;
  className?: string;
}

export function ScrambleText({ text, speed = 28, delay = 0, className }: ScrambleTextProps) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      return;
    }
    let frame = 0;
    let begin = 0;
    const tick = (now: number) => {
      if (!begin) begin = now + delay;
      const settled = Math.max(0, Math.floor((now - begin) / speed));
      if (settled >= text.length) {
        setShown(text);
        return;
      }
      let out = text.slice(0, settled);
      for (let i = settled; i < text.length; i++) {
        const c = text[i];
        out += c === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setShown(out);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, speed, delay]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{shown}</span>
    </span>
  );
}
