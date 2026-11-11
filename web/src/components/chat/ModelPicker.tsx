"use client";

/**
 * The model menu in the chat header: the models this installation holds a
 * key for, each with the rupees one agent run costs, so the pick is made
 * with the number in sight. Hidden when there is nothing to choose between.
 */

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { useModelChoice } from "@/store/model-choice";

interface Entry {
  id: string;
  label: string;
  model: string;
  inrPerRun: number;
  note: string;
}

export function ModelPicker() {
  const [menu, setMenu] = useState<Entry[]>([]);
  const [serverDefault, setServerDefault] = useState<string | null>(null);
  const id = useModelChoice((s) => s.id);
  const set = useModelChoice((s) => s.set);
  const hydrate = useModelChoice((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    let live = true;
    fetch("/api/provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { menu?: Entry[]; chosen?: string | null } | null) => {
        if (!live || !body) return;
        setMenu(body.menu ?? []);
        setServerDefault(body.chosen ?? null);
      })
      .catch(() => {
        // Unreachable: the picker simply does not appear.
      });
    return () => {
      live = false;
    };
  }, [hydrate]);

  // A pick saved on another installation, or for a model since removed, is let go.
  useEffect(() => {
    if (menu.length && id && !menu.some((e) => e.id === id)) set(null);
  }, [menu, id, set]);

  if (menu.length < 2) return null;
  const current = (id && menu.some((e) => e.id === id) ? id : serverDefault) ?? menu[0].id;
  const entry = menu.find((e) => e.id === current);

  return (
    <label
      className="flex items-center gap-1 text-[11px] text-text-muted"
      title={`Which model answers the chat and runs the agent. The price is for one agent run.${entry?.note ? ` ${entry.label}: ${entry.note}.` : ""}`}
    >
      <Cpu size={11} aria-hidden />
      <select
        aria-label="Model"
        value={current}
        onChange={(e) => set(e.target.value)}
        className="focus-ring max-w-[150px] cursor-pointer rounded-md border border-line-subtle bg-surface-base px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
      >
        {menu.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label} · ₹{e.inrPerRun}
          </option>
        ))}
      </select>
    </label>
  );
}
