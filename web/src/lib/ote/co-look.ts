/**
 * How a Compound Object instance looks, worked out from its definition.
 *
 * The engineer's buttons, gauges and bar graphs are Compound Objects: an
 * instance (`CompoundObject.Switch_PB04` with `Text {OFF: "START"}`,
 * `Color {ON: 3}`) of a definition under `CompoundObjects/<id>/`. The editor
 * cannot model an instance as a part, so until now the canvas drew a hatched
 * box where START should be. This draws the definition instead, in the state
 * the instance starts in:
 *
 * 1. The definition's own tree, with its property defaults, overlaid by the
 *    instance's values.
 * 2. Its block script (`Script.dat`), run once. Each `Trigger/Condition`
 *    whose condition holds runs its actions: `ChangeValue`, `ChangeArray`,
 *    `If`. Touch triggers and AddTo/SubTo are what a press does at run time,
 *    so they are not run. This is how Switch_PB04 picks which of its nine
 *    coloured layers shows.
 * 3. Its bindings (`Bindings.dat`) applied: `TextBox_OFF.Text <- $CO.Text.OFF`
 *    puts START on the button, `Ellipse_Green2.Visibility <-
 *    $Local.ColorVisibility[3].Value` shows the layer the script chose.
 *
 * A block's reference is not in the script: it is a binding whose target is
 * the block (ObjectType 100, ObjectId = the block's UniqueId). The script's
 * serializer leaves defaults out, so a Constant with no Value is 0.
 * Visibility follows the product's enum: 0 visible, 1 hidden, 2 collapsed.
 *
 * Display only: nothing here is written back. The result is a small tree of
 * parts in the definition's own coordinates, scaled into the instance's box
 * by the canvas (a ViewBox root keeps its aspect, as in the product).
 */

import { Part, normalizePart } from "./schema";
import { flatten, layoutTree, type Box } from "./containers";

type Raw = Record<string, unknown>;

export type LookItem =
  | { kind: "part"; part: Part }
  | { kind: "box"; box: Box; look: Look };

export interface Look {
  /** The definition's own size; the canvas scales it into the instance's box. */
  width: number;
  height: number;
  /** True for a ViewBox root: scaled uniformly and centred, as the product does. */
  uniform: boolean;
  items: LookItem[];
  /** Where the view starts, when it is a window onto part of its items (a fill level). */
  x?: number;
  y?: number;
  /** Cut off what lies outside the view. */
  clip?: boolean;
}

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const kids = (n: Raw): Raw[] => (Array.isArray(n.Children) ? (n.Children as Raw[]) : []);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Definition {
  name: string;
  root: Raw;
  defaults: Raw;
  /** converter: the id and name of a converter the value passes through (ObjectType 19 targets). */
  bindings: { target: { type: number; id: string }; property: string; text: string; converter?: { id: string; name: string } }[];
  scripts: Raw[];
}

/** Reads definitions on demand from a project's entries. */
export function coLooks(json: (path: string) => unknown, list: string[]) {
  const dirs = new Map<string, string>();
  for (const name of list) {
    const m = name.replace(/\\/g, "/").match(/^(CompoundObjects\/[^/]+)\/CompoundObject\.objdef$/i);
    if (!m) continue;
    const def = obj(json(name));
    if (typeof def.Name === "string") dirs.set(def.Name, m[1]);
  }
  const cache = new Map<string, Definition | null>();

  const definition = (name: string): Definition | null => {
    if (cache.has(name)) return cache.get(name)!;
    const dir = dirs.get(name);
    let def: Definition | null = null;
    const root = dir ? obj(json(`${dir}/Screen.dat`)) : {};
    if (dir && kids(root).length) {
      const defaults: Raw = {};
      for (const [k, v] of Object.entries(root)) if (!["Type", "UniqueId", "Name", "Children"].includes(k)) defaults[k] = v;
      for (const p of Array.isArray(json(`${dir}/Properties.propDef`)) ? (json(`${dir}/Properties.propDef`) as Raw[]) : []) {
        if (typeof p.PropertyName === "string" && p.DefaultValue !== undefined && defaults[p.PropertyName] === undefined) defaults[p.PropertyName] = p.DefaultValue;
      }
      const b = obj(json(`${dir}/Bindings.dat`));
      const targets = Array.isArray(b.Targets) ? (b.Targets as Raw[]) : [];
      const bindings = (Array.isArray(b.Bindings) ? (b.Bindings as Raw[]) : []).flatMap((x) => {
        const t = targets[num(x.Target) ?? -1];
        if (!t || typeof x.BindingText !== "string" || typeof x.TargetProperty !== "string") return [];
        const converter = typeof x.ConverterId === "string" ? { id: x.ConverterId.toLowerCase(), name: String(x.ConverterName ?? "") } : undefined;
        return [{ target: { type: num(t.ObjectType) ?? 0, id: String(t.ObjectId).toLowerCase() }, property: x.TargetProperty, text: x.BindingText, converter }];
      });
      const script = json(`${dir}/Script.dat`);
      def = { name, root, defaults, bindings, scripts: Array.isArray(script) ? (script as Raw[]) : [] };
    }
    cache.set(name, def);
    return def;
  };

  /** The look of one instance, or undefined when its definition is not in the project. */
  const lookOf = (instance: Raw, depth = 0): Look | undefined => {
    const type = String(instance.Type ?? "");
    if (!type.startsWith("CompoundObject.") || depth > 3) return undefined;
    const def = definition(type.slice("CompoundObject.".length));
    if (!def) return undefined;
    const co: Raw = clone(def.defaults);
    for (const [k, v] of Object.entries(instance)) if (!["Type", "UniqueId", "Name", "Location", "Width", "Height", "Margin", "ObjectAlignment"].includes(k)) co[k] = v;
    const view = clone(kids(def.root)[0]);
    evaluate(def, co, view);
    return layout(view, depth, lookOf);
  };

  return lookOf;
}

/* ------------------------------------------------------------ evaluation */

function evaluate(def: Definition, co: Raw, view: Raw) {
  const byId = new Map<string, Raw>();
  const walk = (n: Raw) => {
    if (typeof n.UniqueId === "string") byId.set(n.UniqueId.toLowerCase(), n);
    kids(n).forEach(walk);
  };
  walk(view);
  const byName = new Map([...byId.values()].map((n) => [String(n.Name), n]));
  const locals = new Map<string, unknown>();
  const blockRef = new Map(def.bindings.filter((b) => b.target.type === 100).map((b) => [b.target.id, b.text]));

  // "$CO.Text.OFF", "$Local.ColorVisibility[3].Value", "$GraphicObject.TextBox_ON.Visibility"
  const parse = (text: string) => {
    const m = /^\$(CO|Local|GraphicObject)\.(.+)$/.exec(text.trim());
    if (!m) return undefined;
    if (m[1] === "CO") return { scope: "co" as const, path: m[2].split(".") };
    if (m[1] === "Local") {
      const l = /^([A-Za-z_][\w]*)(?:\[(\d+)\])?(?:\.Value)?$/.exec(m[2]);
      return l ? { scope: "local" as const, name: l[1], index: l[2] === undefined ? undefined : Number(l[2]) } : undefined;
    }
    const [name, ...path] = m[2].split(".");
    return { scope: "object" as const, node: byName.get(name), path };
  };
  const deep = (root: Raw, path: string[]) => path.reduce<unknown>((v, k) => obj(v)[k], root);
  const setDeep = (root: Raw, path: string[], value: unknown) => {
    let at = root;
    for (const k of path.slice(0, -1)) at = (at[k] = { ...obj(at[k]) }) as Raw;
    at[path[path.length - 1]] = value;
  };
  const read = (text: string): unknown => {
    const r = parse(text);
    if (!r) return undefined;
    if (r.scope === "co") return deep(co, r.path);
    if (r.scope === "local") {
      const v = locals.get(r.name);
      return r.index === undefined ? v : Array.isArray(v) ? v[r.index] : undefined;
    }
    return r.node ? deep(r.node, r.path) : undefined;
  };
  const write = (text: string, value: unknown) => {
    const r = parse(text);
    if (!r) return;
    if (r.scope === "co") setDeep(co, r.path, value);
    else if (r.scope === "local") {
      if (r.index === undefined) locals.set(r.name, value);
      else {
        const arr = Array.isArray(locals.get(r.name)) ? (locals.get(r.name) as unknown[]) : [];
        arr[r.index] = value;
        locals.set(r.name, arr);
      }
    } else if (r.node && r.path.length) setDeep(r.node, r.path, value);
  };

  // A block is a constant, or a reference given by the binding that targets it.
  const value = (block: unknown): unknown => {
    const b = obj(block);
    if (b.SubType === "Constant") {
      const v = b.Value ?? 0;
      if (b.DataType === "Bool" || v === "true" || v === "false") return v === true || v === "true";
      const n = Number(v);
      return typeof v === "string" && v.trim() !== "" && Number.isFinite(n) ? n : v;
    }
    const ref = typeof b.UniqueId === "string" ? blockRef.get(b.UniqueId.toLowerCase()) : undefined;
    return ref ? read(ref) : undefined;
  };
  const target = (block: unknown) => {
    const b = obj(block);
    return typeof b.UniqueId === "string" ? blockRef.get(b.UniqueId.toLowerCase()) : undefined;
  };
  const same = (a: unknown, b: unknown) => (typeof a === "boolean" || typeof b === "boolean" ? Boolean(a) === Boolean(b) : Number(a ?? 0) === Number(b ?? 0) || a === b);
  const compare = (a: unknown, op: unknown, b: unknown) => {
    switch (op ?? "==") {
      case "==": return same(a, b);
      case "!=": return !same(a, b);
      case ">": return Number(a) > Number(b);
      case "<": return Number(a) < Number(b);
      case ">=": return Number(a) >= Number(b);
      case "<=": return Number(a) <= Number(b);
      default: return false;
    }
  };
  const run = (actions: unknown) => {
    for (const a of Array.isArray(actions) ? (actions as Raw[]) : []) {
      if (a.SubType === "ChangeValue" && !a.Operator) {
        const t = target(a.Target);
        if (t) write(t, value(a.Value));
      } else if (a.SubType === "ChangeArray" && a.All) {
        const t = parse(target(a.Target) ?? "");
        if (t?.scope === "local") {
          // As long as the script and bindings index it.
          const size = Math.max(1, ...def.bindings.map((b) => (parse(b.text) as { name?: string; index?: number } | undefined)).filter((p) => p?.name === t.name).map((p) => (p!.index ?? 0) + 1));
          locals.set(t.name, Array.from({ length: size }, () => value(a.Input)));
        }
      } else if (a.SubType === "If") {
        const c = obj(a.Condition);
        run(compare(value(c.LeftOperand), c.Operator ?? c.RightOperator, value(c.RightOperand)) ? a.IfActions : a.ElseActions);
      }
    }
  };

  // A Scale converter maps From to To. Its ranges live in Converters.db
  // (SQLite); the name says the To range ("Scale_to_0_360") and the From range
  // is bound from the object's Min and Max, so both are known without it.
  const convert = (c: { id: string; name: string }, v: unknown): unknown => {
    const m = /^Scale_to_(-?[\d.]+)_(-?[\d.]+)$/i.exec(c.name);
    if (!m || typeof v !== "number") return v;
    const p = new Map(def.bindings.filter((b) => b.target.type === 19 && b.target.id === c.id).map((b) => [b.property, num(read(b.text))]));
    const fromMin = p.get("FromMin") ?? 0;
    const fromMax = p.get("FromMax") ?? 100;
    const toMin = p.get("ToMin") ?? Number(m[1]);
    const toMax = p.get("ToMax") ?? Number(m[2]);
    if (fromMax === fromMin) return toMin;
    const t = Math.max(0, Math.min(1, (v - fromMin) / (fromMax - fromMin)));
    return toMin + t * (toMax - toMin);
  };
  const bind = () => {
    for (const b of def.bindings) {
      if (b.target.type !== 8) continue;
      const node = byId.get(b.target.id);
      let v = read(b.text);
      if (!node || v === undefined || /Trigger|Destination/.test(b.property)) continue;
      if (b.converter) v = convert(b.converter, v);
      const path = b.property.split(".");
      // "Fill.@StructBindingValue": the bound value is the whole Fill.
      if (path[path.length - 1] === "@StructBindingValue") {
        if (path.length > 1 && v && typeof v === "object") setDeep(node, path.slice(0, -1), clone(v));
      } else setDeep(node, path, v);
    }
  };

  // Bindings give the script its inputs; the script's choices bind on again.
  bind();
  for (let pass = 0; pass < 2; pass++) {
    for (const s of def.scripts) {
      for (const block of Array.isArray(s.BlockInfo) ? (s.BlockInfo as Raw[]) : []) {
        if (block.Type === "Trigger" && block.SubType === "Condition" && compare(value(block.Source), block.RightOperator, value(block.RightObject))) run(block.Actions);
      }
    }
    bind();
  }

  // Rotation is not drawn; on a round angle shape it is the same as turning its angles.
  for (const n of byId.values()) {
    const turn = num(n.Angle);
    if (turn && /^(Arc|Pie|Arch)$/.test(String(n.Type))) {
      n.StartAngle = (num(n.StartAngle) ?? 0) + turn;
      n.EndAngle = (num(n.EndAngle) ?? 0) + turn;
    }
  }
}

/* ---------------------------------------------------------------- layout */

const hidden = (n: Raw) => num(n.Visibility) === 1 || num(n.Visibility) === 2 || n.IsVisible === false;

function layout(view: Raw, depth: number, lookOf: (instance: Raw, depth: number) => Look | undefined): Look {
  const type = String(view.Type);
  const shown = (n: Raw): Raw => ({ ...n, Children: kids(n).filter((k) => !hidden(k)).map(shown) });
  const tree = shown(view);
  let width = num(view.Width);
  let height = num(view.Height);
  if (type === "ViewBox" || width === undefined || height === undefined) {
    // A ViewBox's content is as big as what it holds.
    const ext = kids(tree).reduce<{ w: number; h: number }>(
      (e, k) => {
        const loc = obj(k.Location);
        return { w: Math.max(e.w, (num(loc.Left) ?? 0) + (num(k.Width) ?? 0)), h: Math.max(e.h, (num(loc.Top) ?? 0) + (num(k.Height) ?? 0)) };
      },
      { w: 0, h: 0 },
    );
    width = width ?? (ext.w || 100);
    height = height ?? (ext.h || 100);
  }
  const box = { left: 0, top: 0, width: width ?? 100, height: height ?? 100 };
  const laid = layoutTree(type === "ViewBox" ? { ...tree, Type: "Canvas" } : tree, box);
  const items: LookItem[] = [];
  for (const leaf of laid.leaves) {
    const raw = leaf.raw;
    if (hidden(raw)) continue;
    if (String(raw.Type).startsWith("CompoundObject.")) {
      const look = lookOf(raw, depth + 1);
      if (look) items.push({ kind: "box", box: leaf.box, look });
      continue;
    }
    if (raw.Type === "ViewBox" && kids(raw).length) {
      items.push({ kind: "box", box: leaf.box, look: layout(raw, depth, lookOf) });
      continue;
    }
    // A switch inside a Compound Object is its touch area: nothing to draw.
    if (raw.Type === "Switch") continue;
    const parsed = Part.safeParse(normalizePart(flatten(leaf)));
    if (!parsed.success) continue;
    const level = obj(obj(raw.Animation).FillLevel);
    if (level.Enable === true && parsed.data.Type !== "Rectangle") {
      // Only the Rectangle draws its own fill level. Anything else (the bar
      // graph's lines are a Path) is drawn whole in the back colour, then in
      // its own colour through a window as tall as the level.
      const across = num(level.HorizontalFill) !== undefined && num(level.VerticalFill) === undefined;
      const pct = Math.max(0, Math.min(100, num(across ? level.HorizontalFill : level.VerticalFill) ?? 50)) / 100;
      const back = obj(level.BackColor);
      if (num(back.Value) !== undefined) {
        const behind = Part.safeParse({ ...parsed.data, Fill: { Color: back } });
        if (behind.success) items.push({ kind: "part", part: behind.data });
      }
      const b = leaf.box;
      const shown = across
        ? { left: b.left, top: b.top, width: b.width * pct, height: b.height }
        : { left: b.left, top: b.top + b.height * (1 - pct), width: b.width, height: b.height * pct };
      items.push({ kind: "box", box: shown, look: { width: shown.width, height: shown.height, x: shown.left, y: shown.top, clip: true, uniform: false, items: [{ kind: "part", part: parsed.data }] } });
      continue;
    }
    items.push({ kind: "part", part: parsed.data });
  }
  return { width: box.width, height: box.height, uniform: type === "ViewBox", items };
}
