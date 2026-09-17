/**
 * One icon per part type, shared by the toolbar, the Insert menu and the
 * layers panel so an object looks the same everywhere it is named. Typed
 * against PartType, so adding a part without an icon is a compile error.
 */

import {
  BarChart3,
  Bell,
  CalendarClock,
  Hash,
  Layers,
  Lightbulb,
  LineChart,
  Quote,
  Route,
  Ruler,
  Spline,
  Square,
  ToggleLeft,
  ToggleRight,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { PartType } from "@/lib/ote/schema";

export const TOOL_ICON: Record<PartType, LucideIcon> = {
  Rectangle: Square,
  TextBox: Type,
  Lamp: Lightbulb,
  NumericDisplay: Hash,
  AlarmSummary: Bell,
  Path: Route,
  Switch: ToggleLeft,
  "N-StateLamp": Layers,
  StringDisplay: Quote,
  ToggleSwitch: ToggleRight,
  BarScale: Ruler,
  Pipe: Spline,
  DateTimeDisplay: CalendarClock,
  TrendGraph: LineChart,
  BlockTrend: BarChart3,
};
