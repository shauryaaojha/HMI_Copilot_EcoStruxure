import { z } from "zod";
import { screenSwitch, surface } from "@/lib/ote/parts";
import type { ComponentDef } from "../types";
import { assembly, boxAt, label, stemOf } from "./shared";

const Props = z.object({ screens: z.array(z.object({ name: z.string(), title: z.string() })).default([]),
  current: z.string().default(""), moreScreen: z.string().optional() });

export const NavBar: ComponentDef<z.infer<typeof Props>> = {
  kind: "NavBar", variants: ["tabs", "tabsMore", "rail"],
  sizes: { S: { width: 320, height: 40 }, M: { width: 640, height: 40 }, L: { width: 1024, height: 40 } },
  states: [], roles: [], tokens: ["field", "line", "ink", "selected", "onDark", "commandPressed"],
  props: Props, backends: ["parts"],
  expand(use, box, theme) {
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    add(surface(`Nav_${stem}`, box, theme.tokens.field));
    const screens = use.props.screens;
    const size = theme.type.regular.label;
    const natural = screens.map((screen) => Math.max(theme.touchMin.regular, Math.ceil((screen.title.length * size * 0.55 + 16) / 8) * 8));
    const fits = natural.reduce((sum, width) => sum + width, 0) <= box.width;
    // A tab is never narrower than the touch minimum. Past that the current
    // screen stays listed and the rest are shown as far as they fit.
    const even = Math.max(theme.touchMin.regular, Math.floor(box.width / Math.max(1, screens.length) / 4) * 4);
    const room = Math.max(1, Math.floor(box.width / even));
    const shown = fits || room >= screens.length ? screens : [
      ...screens.filter((screen) => screen.name === use.props.current),
      ...screens.filter((screen) => screen.name !== use.props.current).slice(0, room - (screens.some((screen) => screen.name === use.props.current) ? 1 : 0)),
    ];
    let x = 0;
    shown.forEach((screen) => {
      const i = screens.indexOf(screen);
      const width = fits ? natural[i] : even;
      if (x + width > box.width) return;
      const selected = screen.name === use.props.current;
      const tab = boxAt(box, x, 0, width, box.height);
      add(surface(`NavChip_${stem}_${i}`, tab, selected ? theme.tokens.selected : theme.tokens.field));
      const letters = Math.max(1, Math.floor((width - 8) / (size * 0.55)));
      const title = screen.title.length > letters ? `${screen.title.slice(0, Math.max(1, letters - 1))}…` : screen.title;
      const text = label(`NavLbl_${stem}_${i}`, title, boxAt(box, x + 4, 8, width - 8, box.height - 16), theme);
      if (selected && text.Type === "TextBox") text.TextColor = { Color: { Value: theme.tokens.onDark } };
      add(text);
      if (!selected) add(screenSwitch(`NavGo_${stem}_${i}`, screen.name, tab));
      x += width;
    });
    return { parts, wires };
  },
};
