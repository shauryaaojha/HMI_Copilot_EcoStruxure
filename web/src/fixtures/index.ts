/**
 * Development fixtures, so the UI can be built without a local EcoStruxure
 * installation.
 *
 * These are our own generated output, lifted straight out of
 * demo_project/HMICopilot_PumpStation.eote - the same file that opens in OTE.
 * That makes them the honest thing to build a canvas against: if the fixture
 * renders correctly, the real project renders correctly.
 *
 * Regenerate after changing tools/make_project.py:
 *   python tools/make_project.py demo_project
 *   python tools/export_fixtures.py
 */

import { Screen, type Alarm, type Variable } from "@/lib/ote/schema";
import screenJson from "./pump-station.screen.json";
import bindingsJson from "./pump-station.bindings.json";
import projectJson from "./pump-station.project.json";

/** Parsed through the real schema, so a fixture that drifts fails loudly. */
export const demoScreen = Screen.parse(screenJson);

export const demoBindings = bindingsJson as {
  Sources: { ReferenceId: number; ObjectFullName: string }[];
  Targets: { ReferenceId: number; SubType: string; ObjectFullName: string }[];
  Bindings: {
    BindingText: string;
    Target: number;
    TargetProperty: string;
    Sources: string;
  }[];
};

export const demoVariables = projectJson.variables as Variable[];
export const demoAlarms = projectJson.alarms as unknown as Alarm[];

/** Values the simulator would push - drives the Live state of the canvas. */
export const demoLiveValues: Record<string, number | boolean> = {
  Lamp_PUMP1_RUN: true,
  Lamp_PUMP1_FLT: false,
  Lamp_PUMP2_RUN: false,
  Lamp_PUMP2_FLT: true,
  Num_Flow: 62.4,
  Num_Level: 91.8,
};

/**
 * Two hand-drawn symbols standing in for the shipped graphic object library,
 * which is derived from a licensed installation and therefore not committed.
 * Same shape as a real entry, so the component contract is identical - run
 * `npm run index:graphics` on a machine with OTE to get the real 474.
 */
export const placeholderSymbols = [
  {
    name: "PlaceholderPump",
    category: "fixtures",
    width: 240,
    height: 160,
    d: "M 20,60 L 90,60 L 90,40 L 130,80 L 90,120 L 90,100 L 20,100 Z M 150,30 L 220,30 L 220,130 L 150,130 Z",
  },
  {
    name: "PlaceholderTank",
    category: "fixtures",
    width: 160,
    height: 200,
    d: "M 20,20 L 140,20 L 140,140 L 80,190 L 20,140 Z",
  },
];
