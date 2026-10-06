/**
 * What finished projects agree on, as answers a generator can ask for.
 *
 * Pure: records in, conventions out, so it is tested without a store and the
 * same records always give the same answer. Every figure carries its support -
 * how many bindings, in how many projects - because "engineers bind RUN to a
 * Lamp's Value" from one project is an anecdote and from forty is a rule, and a
 * model choosing between them has to be told which it is looking at.
 */

import type { KnownBinding, ProjectKnowledge } from "./scan";

export interface Ranked {
  /** `Lamp.Value`, `Rectangle.Animation.FillLevel.VerticalFill`. */
  target: string;
  count: number;
  /** Distinct projects it was seen in. */
  projects: number;
  share: number;
}

export interface Conventions {
  projects: number;
  /** Tag word ("RUN", "PV") -> how such tags are bound. */
  byRole: Record<string, Ranked[]>;
  /** Data type -> how such tags are bound. */
  byDataType: Record<string, Ranked[]>;
  /** Part type -> instances and projects, across everything scanned. */
  parts: Record<string, { count: number; projects: number }>;
  naming: { separators: Record<string, number>; cases: Record<string, number>; suffixes: Record<string, number> };
  alarms: { count: number; severity: Record<string, number>; kinds: Record<string, number>; levels: Record<string, number> };
  screens: { count: number; objectsMedian: number; objectsP90: number; roots: Record<string, number> };
}

const lastWord = (tag: string) => {
  const words = tag.split(/[_.\-\s]+|(?<=[a-z])(?=[A-Z])/).filter((w) => w && !/^\d+$/.test(w));
  return words.length > 1 ? words[words.length - 1].toUpperCase() : "";
};

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function rank(groups: Map<string, Map<string, { count: number; projects: Set<string> }>>, limit = 6): Record<string, Ranked[]> {
  const out: Record<string, Ranked[]> = {};
  for (const [key, targets] of groups) {
    const total = [...targets.values()].reduce((n, t) => n + t.count, 0);
    out[key] = [...targets.entries()]
      .map(([target, t]) => ({ target, count: t.count, projects: t.projects.size, share: Math.round((t.count / total) * 100) / 100 }))
      .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target))
      .slice(0, limit);
  }
  return out;
}

export const bindingTarget = (b: Pick<KnownBinding, "objectType" | "property">) => `${b.objectType}.${b.property}`;

export function aggregate(records: ProjectKnowledge[]): Conventions {
  const byRole = new Map<string, Map<string, { count: number; projects: Set<string> }>>();
  const byType = new Map<string, Map<string, { count: number; projects: Set<string> }>>();
  const add = (m: typeof byRole, key: string, target: string, project: string) => {
    if (!key) return;
    const inner = m.get(key) ?? m.set(key, new Map()).get(key)!;
    const t = inner.get(target) ?? inner.set(target, { count: 0, projects: new Set() }).get(target)!;
    t.count++;
    t.projects.add(project);
  };
  const parts: Conventions["parts"] = {};
  const naming: Conventions["naming"] = { separators: {}, cases: {}, suffixes: {} };
  const alarms: Conventions["alarms"] = { count: 0, severity: {}, kinds: {}, levels: {} };
  const objectCounts: number[] = [];
  const roots: Record<string, number> = {};
  const merge = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  };

  for (const r of records) {
    for (const b of r.bindings) {
      const target = bindingTarget(b);
      add(byRole, lastWord(b.tag), target, r.id);
      if (b.dataType) add(byType, b.dataType.toUpperCase(), target, r.id);
    }
    for (const [type, p] of Object.entries(r.partTypes)) {
      const e = (parts[type] ??= { count: 0, projects: 0 });
      e.count += p.count;
      e.projects++;
    }
    merge(naming.separators, r.naming.separators);
    merge(naming.cases, r.naming.cases);
    merge(naming.suffixes, r.naming.suffixes);
    for (const a of r.alarms) {
      alarms.count++;
      if (a.severity !== undefined) alarms.severity[String(a.severity)] = (alarms.severity[String(a.severity)] ?? 0) + 1;
      if (a.kind) alarms.kinds[a.kind] = (alarms.kinds[a.kind] ?? 0) + 1;
      if (a.level) alarms.levels[a.level] = (alarms.levels[a.level] ?? 0) + 1;
    }
    for (const s of r.screens) {
      objectCounts.push(s.objects.length);
      roots[s.rootType] = (roots[s.rootType] ?? 0) + 1;
    }
  }
  naming.suffixes = Object.fromEntries(Object.entries(naming.suffixes).sort((a, b) => b[1] - a[1]).slice(0, 60));

  return {
    projects: records.length,
    byRole: rank(byRole),
    byDataType: rank(byType),
    parts,
    naming,
    alarms,
    screens: { count: objectCounts.length, objectsMedian: quantile(objectCounts, 0.5), objectsP90: quantile(objectCounts, 0.9), roots },
  };
}

/**
 * How a tag like this one has been bound before: by its trailing word first,
 * since `_RUN` says more than `BOOL`, then by its data type. Empty when the
 * knowledge base has never seen either - which the caller must treat as "no
 * precedent", not as "do not bind".
 */
export function precedentFor(c: Conventions, tag: string, dataType?: string): { by: "role" | "dataType"; key: string; ranked: Ranked[] } | null {
  const role = lastWord(tag);
  if (role && c.byRole[role]?.length) return { by: "role", key: role, ranked: c.byRole[role] };
  const dt = dataType?.toUpperCase();
  if (dt && c.byDataType[dt]?.length) return { by: "dataType", key: dt, ranked: c.byDataType[dt] };
  return null;
}

/** Screens across the knowledge base that contain all these part types and/or equipment kinds. */
export function exampleScreens(
  records: ProjectKnowledge[],
  want: { partTypes?: string[]; equipment?: string[]; words?: string[] },
  limit = 5,
): { project: string; screen: string; objects: number; types: Record<string, number>; bound: number }[] {
  const types = (want.partTypes ?? []).map((t) => t.toLowerCase());
  const words = (want.words ?? []).map((w) => w.toLowerCase()).filter(Boolean);
  const kinds = new Set((want.equipment ?? []).map((k) => k.toLowerCase()));
  const out: { project: string; screen: string; objects: number; types: Record<string, number>; bound: number; score: number }[] = [];
  for (const r of records) {
    const projectKinds = new Set(r.equipment.map((e) => e.kind.toLowerCase()));
    if ([...kinds].some((k) => !projectKinds.has(k))) continue;
    for (const s of r.screens) {
      const have = new Set(Object.keys(s.types).map((t) => t.toLowerCase()));
      if (types.some((t) => !have.has(t))) continue;
      const nameHit = words.filter((w) => s.name.toLowerCase().includes(w)).length;
      out.push({ project: r.fileName, screen: s.name, objects: s.objects.length, types: s.types, bound: s.bound, score: s.bound + nameHit * 50 });
    }
  }
  return out
    .sort((a, b) => b.score - a.score || a.project.localeCompare(b.project) || a.screen.localeCompare(b.screen))
    .slice(0, limit)
    .map(({ score, ...rest }) => (void score, rest));
}
