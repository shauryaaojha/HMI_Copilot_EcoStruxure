"use client";

/**
 * The Plant Model, as a tree the engineer can correct.
 *
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.1: fixing the model is cheaper than
 * fixing forty screens. The one question the modeller asks is at the top,
 * as buttons; assumptions are listed so they read as assumptions; every
 * range and every connection is editable in place. Confidence under 0.7 is
 * marked, because that is where an engineer should look first.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, HelpCircle, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useProject } from "@/store/project";
import { modelPlant, type PlantEquipment } from "@/lib/plant/model";
import { Badge, Button, Panel, Select, cn } from "@/components/ui";

function RangeRow({ equipment, tag }: { equipment: PlantEquipment; tag: string }) {
  const setRange = useProject((s) => s.setRange);
  const range = equipment.ranges[tag];
  const role = equipment.roles.find((r) => r.tag === tag)?.role ?? "value";
  const field = (key: "min" | "max" | "normalLow" | "normalHigh", label: string) => (
    <label className="flex h-7 min-w-0 items-center gap-1 rounded-md border border-line bg-surface-raised px-1.5">
      <span className="shrink-0 text-[10px] text-text-faint">{label}</span>
      <input
        type="number"
        value={range[key]}
        aria-label={`${tag} ${label}`}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setRange(equipment.id, tag, { [key]: n });
        }}
        className="text-figure w-full min-w-0 bg-transparent text-xs text-text-primary outline-none"
      />
    </label>
  );
  return (
    <li className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-1.5">
      <span className="min-w-0">
        <span className="block truncate font-mono text-[11px] text-text-secondary">{tag}</span>
        <span className="block text-[10px] text-text-faint">{role}</span>
      </span>
      {field("min", "min")}
      {field("normalLow", "lo")}
      {field("normalHigh", "hi")}
      {field("max", "max")}
      <span className="flex items-center gap-1">
        <input
          value={range.units}
          aria-label={`${tag} units`}
          onChange={(e) => setRange(equipment.id, tag, { units: e.target.value })}
          className="h-7 w-14 rounded-md border border-line bg-surface-raised px-1.5 font-mono text-[11px] text-text-primary outline-none"
        />
        <span
          title={range.source === "class" ? "Class default: the export stated no range" : range.source === "export" ? "From the tag export" : "Set by you"}
          className={cn("text-[10px]", range.source === "class" ? "text-status-warn" : "text-text-faint")}
        >
          {range.source}
        </span>
      </span>
    </li>
  );
}

export function PlantScreen() {
  const plant = useProject((s) => s.plant);
  const variables = useProject((s) => s.variables);
  const setPlant = useProject((s) => s.setPlant);
  const answerQuestion = useProject((s) => s.answerQuestion);
  const connect = useProject((s) => s.connect);
  const disconnect = useProject((s) => s.disconnect);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const byId = useMemo(() => new Map((plant?.equipment ?? []).map((e) => [e.id, e])), [plant]);
  const labelOf = (id: string) => byId.get(id)?.label ?? id;

  if (!plant) {
    return (
      <Panel title="No plant model yet" bordered className="max-w-2xl">
        <p className="text-sm text-text-muted">
          {variables.length === 0
            ? "Import a tag export first. The model is read from the tag names."
            : "The model is built from the tag list; it has not been built for this project yet."}
        </p>
        {variables.length > 0 && (
          <Button className="mt-3" variant="primary" icon={<RefreshCw size={14} />} onClick={() => setPlant(modelPlant(variables))}>
            Build the model from {variables.length} tags
          </Button>
        )}
      </Panel>
    );
  }

  const uncertain = plant.equipment.filter((e) => e.confidence < 0.7).length;
  const options = plant.equipment.map((e) => ({ value: e.id, label: `${e.label} (${e.id})` }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{plant.areas.length} areas</Badge>
        <Badge tone="neutral">{plant.units.length} units</Badge>
        <Badge tone="neutral">{plant.equipment.length} equipment</Badge>
        <Badge tone="neutral">{plant.connections.length} connections</Badge>
        {uncertain > 0 && <Badge tone="warn" dot>{uncertain} below 0.7 confidence</Badge>}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<RefreshCw size={13} />}
          title="Rebuild from the tag list, keeping your answers and your ranges"
          onClick={() => setPlant(modelPlant(variables, plant.answers))}
        >
          Rebuild from tags
        </Button>
      </div>

      {plant.questions.length > 0 && (
        <Panel title="One question" bordered leading={<HelpCircle size={15} className="text-status-info" />}>
          {plant.questions.map((q) => (
            <div key={q.id} className="space-y-2">
              <p className="text-sm">{q.text}</p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => answerQuestion(q.id, opt)}
                    className="focus-ring rounded-md border border-status-info/40 bg-status-info/[0.06] px-2.5 py-1 text-xs text-status-info transition hover:bg-status-info/15"
                  >
                    {labelOf(opt)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Panel>
      )}

      {plant.assumptions.length > 0 && (
        <Panel title="Assumptions" bordered leading={<AlertTriangle size={15} className="text-status-warn" />}>
          <ul className="space-y-1 text-xs text-text-secondary">
            {plant.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Panel>
      )}

      {plant.units.map((unit) => (
        <Panel key={unit.id} title={unit.name} bordered collapsible>
          <ul className="space-y-3">
            {unit.equipment.map((id) => {
              const e = byId.get(id)!;
              const readings = Object.keys(e.ranges);
              return (
                <li key={id} className="rounded-md border border-line-subtle p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{e.label}</span>
                    <span className="font-mono text-[11px] text-text-muted">{e.id}</span>
                    <Badge tone="neutral">{e.class}</Badge>
                    <Badge tone={e.confidence < 0.7 ? "warn" : "ok"} dot>
                      {Math.round(e.confidence * 100)}%
                    </Badge>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {e.roles.map((r) => (
                      <li key={r.tag} className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px]">
                        <span className="text-text-faint">{r.role}</span>{" "}
                        <span className="font-mono text-text-secondary">{r.tag}</span>
                      </li>
                    ))}
                  </ul>
                  {readings.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {readings.map((tag) => (
                        <RangeRow key={tag} equipment={e} tag={tag} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}

      <Panel title="Connections" bordered leading={<Link2 size={15} />}>
        <ul className="space-y-1">
          {plant.connections.map((c) => (
            <li key={`${c.from}>${c.to}`} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 truncate">{labelOf(c.from)}</span>
              <ArrowRight size={12} aria-hidden className="shrink-0 text-text-faint" />
              <span className="min-w-0 truncate">{labelOf(c.to)}</span>
              <Badge tone={c.confidence < 0.7 ? "warn" : c.source === "engineer" ? "ok" : "neutral"}>
                {c.source === "engineer" ? <Check size={10} /> : `${Math.round(c.confidence * 100)}%`}
              </Badge>
              <button
                type="button"
                onClick={() => disconnect(c.from, c.to)}
                aria-label={`Remove ${labelOf(c.from)} to ${labelOf(c.to)}`}
                className="focus-ring ml-auto rounded p-1 text-text-faint hover:text-status-alarm"
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </li>
          ))}
          {plant.connections.length === 0 && <li className="text-xs text-text-muted">None yet.</li>}
        </ul>
        <div className="mt-3 flex items-center gap-2">
          <Select size="sm" aria-label="From" value={from} options={[{ value: "", label: "From…" }, ...options]} onChange={(e) => setFrom(e.target.value)} />
          <ArrowRight size={12} aria-hidden className="shrink-0 text-text-faint" />
          <Select size="sm" aria-label="To" value={to} options={[{ value: "", label: "To…" }, ...options]} onChange={(e) => setTo(e.target.value)} />
          <Button size="sm" disabled={!from || !to || from === to} onClick={() => { connect(from, to); setFrom(""); setTo(""); }}>
            Connect
          </Button>
        </div>
      </Panel>
    </div>
  );
}
