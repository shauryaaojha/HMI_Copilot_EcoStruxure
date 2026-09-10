/**
 * Equipment templates - reference screen 4.
 *
 * Each one is a real group of OTE parts, built with the same factories in
 * lib/ote/parts.ts that the generator uses, so a template dropped on the canvas
 * is packageable the moment it lands. That is the one rule in
 * docs/BUILD_PLAN.md: a template that drew something the .eote cannot hold
 * would turn the canvas back into a mockup.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import type { Part } from "@/lib/ote/schema";
import {
  alarmLamp,
  alarmSummary,
  lamp,
  numericDisplay,
  rectangle,
  textBox,
} from "@/lib/ote/parts";

export interface Template {
  id: string;
  name: string;
  category: "Pumps" | "Motors" | "Tanks" | "Valves" | "General";
  description: string;
  /** Footprint, so the placer knows how much room to leave. */
  size: { width: number; height: number };
  /** `at` is the top-left corner; `n` disambiguates names across placements. */
  build: (at: { left: number; top: number }, n: number) => Part[];
}

export const TEMPLATES: Template[] = [
  {
    id: "pump-status",
    name: "Pump status block",
    category: "Pumps",
    description: "Panel, title, run lamp and fault lamp — the pair a duty pump needs.",
    size: { width: 240, height: 200 },
    build: ({ left, top }, n) => [
      rectangle(`Panel_Pump${n}`, { left, top, width: 240, height: 200 }),
      textBox(`Lbl_Pump${n}`, `PUMP ${n}`, {
        left: left + 16,
        top: top + 12,
        width: 200,
        height: 22,
      }, { bold: true }),
      lamp(`Lamp_PUMP${n}_RUN`, `PUMP ${n}\nSTOPPED`, `PUMP ${n}\nRUNNING`, {
        left: left + 20,
        top: top + 44,
        width: 200,
        height: 76,
      }),
      alarmLamp(`Lamp_PUMP${n}_FLT`, "OK", "FAULT", {
        left: left + 20,
        top: top + 132,
        width: 200,
        height: 60,
      }),
    ],
  },
  {
    id: "motor-status",
    name: "Motor starter block",
    category: "Motors",
    description: "Run lamp, fault lamp and a speed readout for a single starter.",
    size: { width: 240, height: 200 },
    build: ({ left, top }, n) => [
      rectangle(`Panel_Motor${n}`, { left, top, width: 240, height: 200 }),
      textBox(`Lbl_Motor${n}`, `MOTOR ${n}`, {
        left: left + 16,
        top: top + 12,
        width: 200,
        height: 22,
      }, { bold: true }),
      lamp(`Lamp_MTR${n}_RUN`, `MOTOR ${n}\nSTOPPED`, `MOTOR ${n}\nRUNNING`, {
        left: left + 20,
        top: top + 44,
        width: 200,
        height: 68,
      }),
      textBox(`Lbl_MTR${n}_Speed`, "Speed", {
        left: left + 20,
        top: top + 128,
        width: 70,
        height: 28,
      }),
      numericDisplay(`Num_MTR${n}_Speed`, {
        left: left + 96,
        top: top + 124,
        width: 124,
        height: 40,
      }),
      textBox(`Unit_MTR${n}_Speed`, "rpm", {
        left: left + 20,
        top: top + 166,
        width: 80,
        height: 24,
      }),
    ],
  },
  {
    id: "analog-readout",
    name: "Analog readout",
    category: "General",
    description: "Label, numeric display and unit — one process value, read left to right.",
    size: { width: 440, height: 60 },
    build: ({ left, top }, n) => [
      textBox(`Lbl_Value${n}`, "Value", { left, top: top + 14, width: 120, height: 28 }),
      numericDisplay(`Num_Value${n}`, {
        left: left + 130,
        top,
        width: 200,
        height: 60,
      }),
      textBox(`Unit_Value${n}`, "units", {
        left: left + 344,
        top: top + 14,
        width: 96,
        height: 28,
      }),
    ],
  },
  {
    id: "tank-level",
    name: "Tank level readout",
    category: "Tanks",
    description: "Level in percent with a high-level lamp beside it.",
    size: { width: 440, height: 140 },
    build: ({ left, top }, n) => [
      rectangle(`Panel_Tank${n}`, { left, top, width: 440, height: 140 }),
      textBox(`Lbl_Tank${n}`, `TANK ${n}`, {
        left: left + 16,
        top: top + 12,
        width: 200,
        height: 22,
      }, { bold: true }),
      textBox(`Lbl_TK${n}_Level`, "Level", {
        left: left + 20,
        top: top + 58,
        width: 100,
        height: 28,
      }),
      numericDisplay(`Num_TK${n}_Level`, {
        left: left + 124,
        top: top + 44,
        width: 160,
        height: 56,
      }),
      alarmLamp(`Lamp_TK${n}_HI`, "LEVEL OK", "LEVEL HIGH", {
        left: left + 296,
        top: top + 44,
        width: 128,
        height: 56,
      }),
    ],
  },
  {
    id: "valve-state",
    name: "Valve state",
    category: "Valves",
    description: "Open/closed indication for a single actuated valve.",
    size: { width: 220, height: 92 },
    build: ({ left, top }, n) => [
      textBox(`Lbl_Valve${n}`, `VALVE ${n}`, { left, top, width: 200, height: 22 }, { bold: true }),
      lamp(`Lamp_VLV${n}_OPEN`, `VALVE ${n}\nCLOSED`, `VALVE ${n}\nOPEN`, {
        left,
        top: top + 28,
        width: 220,
        height: 64,
      }),
    ],
  },
  {
    id: "alarm-panel",
    name: "Alarm panel",
    category: "General",
    description: "The product's own alarm summary grid, with a heading above it.",
    size: { width: 600, height: 220 },
    build: ({ left, top }, n) => [
      textBox(`Lbl_Alarms${n}`, "ACTIVE ALARMS", { left, top, width: 300, height: 24 }),
      alarmSummary(`AlarmBanner${n}`, {
        left,
        top: top + 28,
        width: 600,
        height: 192,
      }),
    ],
  },
  {
    id: "screen-banner",
    name: "Screen banner",
    category: "General",
    description: "The green header bar, screen title and a right-aligned caption.",
    size: { width: 1024, height: 56 },
    build: ({ left, top }, n) => [
      rectangle(`Banner${n}`, { left, top, width: 1024, height: 56 }, { fill: 3, border: 3 }),
      textBox(`Title${n}`, "Screen Title", {
        left: left + 20,
        top: top + 14,
        width: 420,
        height: 30,
      }, { size: 22, colour: 21, bold: true }),
      textBox(`Subtitle${n}`, "Generated by HMI Copilot", {
        left: left + 680,
        top: top + 20,
        width: 300,
        height: 24,
      }, { size: 13, colour: 21 }),
    ],
  },
];

export const CATEGORIES = ["All", ...new Set(TEMPLATES.map((t) => t.category))];
