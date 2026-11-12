/**
 * The frame of every screen the chat loop draws: page background, header
 * (title, subtitle, clock) and a navigation bar of pills to every screen of
 * the application. Drawn here, the same way on every screen whichever model
 * is answering, because it is the same on every screen: a small model drew
 * it on the first screen and dropped it on the rest, and a navigation bar
 * that differs per screen is the first thing an operator notices.
 *
 * The house style is the connector's best build (docs/MODEL_GATEWAY.md):
 * paper page, navy header with white title, pills for navigation. The model
 * draws the body between the header and the bar.
 *
 * Names are prefixed by the screen, because object names are unique across a
 * project (bindings resolve by them).
 */

import type { Op } from "@/core/ops";

export interface FrameBox {
  width: number;
  height: number;
}

/** Where the body is, for the model: between the header and the bar, inside the margins. */
export function bodyOf(panel: FrameBox) {
  const k = panel.height / 600;
  const margin = Math.round(36 * (panel.width / 1024));
  const top = Math.round(100 * k);
  const bottom = Math.round(504 * k);
  return { left: margin, top, width: panel.width - 2 * margin, height: bottom - top };
}

const safe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_");

/** The frame's object names on a screen, so a model's own copy of them can be dropped. */
export function isFrameName(screen: string, name: string | undefined): boolean {
  if (!name) return false;
  const p = `${safe(screen)}_`;
  return name.startsWith(`${p}Frame_`) || /^(Page_BG|Header_[A-Za-z]+|N\d+_[A-Za-z]+|Nav_[A-Za-z0-9_]+)$/.test(name);
}

/**
 * The frame ops for one screen. `screens` is every screen of the application,
 * in navigation order; this one is drawn as the current pill. The pills'
 * goToScreen actions are separate (navOps), because a link to a screen not
 * drawn yet is refused.
 */
export function frameOps(screen: string, title: string, subtitle: string, screens: string[], panel: FrameBox): Op[] {
  const { width: W, height: H } = panel;
  const kx = W / 1024;
  const ky = H / 600;
  const x = (n: number) => Math.round(n * kx);
  const y = (n: number) => Math.round(n * ky);
  const p = `${safe(screen)}_Frame_`;
  const ops: Record<string, unknown>[] = [
    { op: "addObject", type: "Rectangle", name: `${p}Page`, left: 0, top: 0, width: W, height: H, color: "paper" },
    { op: "addObject", type: "Rectangle", name: `${p}Header`, left: 0, top: 0, width: W, height: y(88), color: "navy" },
    { op: "addObject", type: "TextBox", name: `${p}Title`, left: x(36), top: y(12), width: x(640), height: y(44), text: title, fontSize: 32, bold: true },
    { op: "setColor", target: `${p}Title`, color: "white", colorRole: "text" },
    { op: "addObject", type: "TextBox", name: `${p}Sub`, left: x(36), top: y(54), width: x(640), height: y(26), text: subtitle, fontSize: 16 },
    { op: "setColor", target: `${p}Sub`, color: "lightblue", colorRole: "text" },
    { op: "addObject", type: "DateTimeDisplay", name: `${p}Clock`, left: x(760), top: y(26), width: x(228), height: y(36) },
  ];
  const list = screens.length ? screens : [screen];
  const gap = x(8);
  const left = x(36);
  const span = W - 2 * left;
  const w = Math.floor((span - gap * (list.length - 1)) / list.length);
  const top = y(516);
  const h = y(56);
  list.forEach((name, i) => {
    const at = left + i * (w + gap);
    const label = name.replace(/_/g, " ").toUpperCase();
    if (name.toLowerCase() === screen.toLowerCase()) {
      ops.push(
        { op: "addObject", type: "Rectangle", name: `${p}Nav${i}_BG`, left: at, top, width: w, height: h, color: "navy", radius: Math.round(h / 2) },
        { op: "addObject", type: "TextBox", name: `${p}Nav${i}_Label`, left: at, top, width: w, height: h, text: label, fontSize: 18, bold: true },
        { op: "setColor", target: `${p}Nav${i}_Label`, color: "white", colorRole: "text" },
      );
    } else {
      ops.push(
        { op: "addObject", type: "Rectangle", name: `${p}Nav${i}_BG`, left: at, top, width: w, height: h, color: "white", radius: Math.round(h / 2) },
        { op: "setStyle", target: `${p}Nav${i}_BG`, borderWidth: 2, colorRole: "border" },
        { op: "setColor", target: `${p}Nav${i}_BG`, color: "grey", colorRole: "border" },
        { op: "addObject", type: "Switch", name: `${p}Nav${i}`, left: at, top, width: w, height: h, text: label },
        { op: "setStyle", target: `${p}Nav${i}`, colorRole: "fill", transparency: 100 },
        { op: "setStyle", target: `${p}Nav${i}`, colorRole: "border", transparency: 100 },
      );
    }
  });
  return ops as unknown as Op[];
}

/** The pills' links, only to screens that exist, so none is refused. */
export function navOps(framed: { screen: string; screens: string[] }[], exists: (name: string) => boolean): Op[] {
  const ops: Record<string, unknown>[] = [];
  for (const f of framed) {
    const p = `${safe(f.screen)}_Frame_`;
    f.screens.forEach((name, i) => {
      if (name.toLowerCase() === f.screen.toLowerCase() || !exists(name)) return;
      ops.push({ op: "setAction", target: `${p}Nav${i}`, action: "goToScreen", toScreen: name });
    });
  }
  return ops as unknown as Op[];
}
