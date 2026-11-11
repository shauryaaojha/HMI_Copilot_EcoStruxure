"use client";

/**
 * A field of fine vertical lines that ripple on Perlin noise and bend away
 * from the cursor.
 *
 * Ported from the "waves" background in the team's Animations folder
 * (Background Animations/5), to React and canvas 2D: no WebGL, no library.
 * It reads its colour from a CSS custom property so it follows the theme, it
 * draws one still frame and stops under prefers-reduced-motion, and it does
 * no work while the tab is hidden or the canvas is off screen.
 */

import { useEffect, useRef } from "react";
import { cn } from "@/components/ui";

/* --- 2D Perlin noise, as in the original ------------------------------- */

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1],
] as const;
const P = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

function noise2(seed: number) {
  const perm = new Array<number>(512);
  const grad = new Array<readonly [number, number]>(512);
  let s = Math.floor(seed * 65536);
  if (s < 256) s |= s << 8;
  for (let i = 0; i < 256; i++) {
    const v = i & 1 ? P[i] ^ (s & 255) : P[i] ^ ((s >> 8) & 255);
    perm[i] = perm[i + 256] = v;
    grad[i] = grad[i + 256] = GRAD[v % 12];
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;
  const dot = (g: readonly [number, number], x: number, y: number) => g[0] * x + g[1] * y;
  return (x: number, y: number) => {
    let X = Math.floor(x);
    let Y = Math.floor(y);
    x -= X;
    y -= Y;
    X &= 255;
    Y &= 255;
    const n00 = dot(grad[X + perm[Y]], x, y);
    const n01 = dot(grad[X + perm[Y + 1]], x, y - 1);
    const n10 = dot(grad[X + 1 + perm[Y]], x - 1, y);
    const n11 = dot(grad[X + 1 + perm[Y + 1]], x - 1, y - 1);
    const u = fade(x);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(y));
  };
}

interface Point {
  x: number;
  y: number;
  wx: number;
  wy: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
}

export interface WaveLinesProps {
  className?: string;
  /** A CSS colour or var(); read once per frame from the element, so a theme flip is followed. */
  color?: string;
  /** Pixels between lines. */
  gap?: number;
  /** How far the noise moves a point. */
  amplitude?: number;
  /** Line opacity, 0-1. */
  opacity?: number;
}

export function WaveLines({ className, color = "var(--color-brand-400)", gap = 12, amplitude = 32, opacity = 0.35 }: WaveLinesProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = host.current;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!box || !el || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const noise = noise2(Math.random());
    const yGap = 36;
    let lines: Point[][] = [];
    let width = 0;
    let height = 0;
    let rect = box.getBoundingClientRect();
    const mouse = { x: -9999, y: 0, sx: -9999, sy: 0, lx: 0, ly: 0, vs: 0, a: 0, set: false };
    let frame = 0;
    let visible = true;

    const layout = () => {
      rect = box.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      el.width = width * dpr;
      el.height = height * dpr;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil((width + 200) / gap);
      const rows = Math.ceil((height + 30) / yGap);
      const x0 = (width - gap * cols) / 2;
      const y0 = (height - yGap * rows) / 2;
      lines = [];
      for (let i = 0; i <= cols; i++) {
        const pts: Point[] = [];
        for (let j = 0; j <= rows; j++) pts.push({ x: x0 + gap * i, y: y0 + yGap * j, wx: 0, wy: 0, cx: 0, cy: 0, vx: 0, vy: 0 });
        lines.push(pts);
      }
    };

    const move = (time: number) => {
      for (const pts of lines) {
        for (const p of pts) {
          const m = noise((p.x + time * 0.0125) * 2e-3, (p.y + time * 0.01) * 15e-4) * 12;
          p.wx = Math.cos(m) * amplitude;
          p.wy = Math.sin(m) * (amplitude / 2);
          const dx = p.x - mouse.sx;
          const dy = p.y - mouse.sy;
          const dist = Math.hypot(dx, dy);
          const reach = Math.max(175, mouse.vs);
          if (dist < reach) {
            const f = Math.cos(dist * 1e-3) * (1 - dist / reach);
            p.vx += Math.cos(mouse.a) * f * reach * mouse.vs * 65e-5;
            p.vy += Math.sin(mouse.a) * f * reach * mouse.vs * 65e-5;
          }
          p.vx = (p.vx - p.cx * 0.01) * 0.9;
          p.vy = (p.vy - p.cy * 0.01) * 0.9;
          p.cx = Math.max(-120, Math.min(120, p.cx + p.vx * 2));
          p.cy = Math.max(-120, Math.min(120, p.cy + p.vy * 2));
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 1;
      ctx.strokeStyle = getComputedStyle(box).getPropertyValue("--wave-color").trim() || "#3dcd58";
      ctx.beginPath();
      for (const pts of lines) {
        ctx.moveTo(pts[0].x + pts[0].wx, pts[0].y + pts[0].wy);
        for (let k = 1; k < pts.length; k++) {
          const p = pts[k];
          const last = k === pts.length - 1;
          ctx.lineTo(p.x + p.wx + (last ? 0 : p.cx), p.y + p.wy + (last ? 0 : p.cy));
        }
      }
      ctx.stroke();
    };

    const tick = (t: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;
      const dx = mouse.x - mouse.lx;
      const dy = mouse.y - mouse.ly;
      mouse.vs = Math.min(100, mouse.vs + (Math.hypot(dx, dy) - mouse.vs) * 0.1);
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);
      move(t);
      draw();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame && !still) frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      if (!mouse.set) {
        mouse.sx = mouse.lx = mouse.x;
        mouse.sy = mouse.ly = mouse.y;
        mouse.set = true;
      }
    };
    const onScroll = () => {
      rect = box.getBoundingClientRect();
    };
    const onVisibility = () => {
      if (!document.hidden) start();
    };

    layout();
    move(0);
    draw();
    start();

    const resize = new ResizeObserver(() => {
      layout();
      move(performance.now());
      draw();
    });
    resize.observe(box);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    seen.observe(box);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gap, amplitude, opacity]);

  return (
    <div ref={host} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={{ ["--wave-color" as string]: color }}>
      <canvas ref={canvas} className="block" />
    </div>
  );
}
