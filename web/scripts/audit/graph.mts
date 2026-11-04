// Import graph of web/src and web/tests, generated from the code (not from memory).
// For each source file: its imports, its importers, whether it is server, client or
// shared code, which tests reach it (directly and transitively), whether it is dead,
// and the import cycles (strongly connected components of size > 1).
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/graph.mts [out.json]
//
// Prints a summary; writes the full graph as JSON (default: graph.json beside the
// script's cwd is NOT used: pass a path, or it prints to stdout only).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const WEB = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(WEB, "src");
const TESTS = path.join(WEB, "tests");
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(WEB, p).split(path.sep).join("/");

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // package import
  const tries = [base, ...EXTS.map((x) => base + x), ...EXTS.map((x) => path.join(base, "index" + x))];
  // "./x.js" written for a .ts file
  if (/\.(m?js)$/.test(base)) tries.push(base.replace(/\.m?js$/, ".ts"), base.replace(/\.m?js$/, ".mts"));
  for (const t of tries) if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
  return "UNRESOLVED:" + spec;
}

type Node = {
  file: string;
  imports: string[]; // local files
  packages: string[];
  dynamic: string[]; // import("...") targets, local
  typeOnly: string[]; // local imports that are `import type` only
  unresolved: string[];
  directive: "client" | "server" | null;
  kind?: "server" | "client" | "shared" | "test";
  importers: string[];
  testsDirect: string[];
  testsTransitive: number;
  entry: boolean;
  dead: boolean;
};

const files = [...walk(SRC), ...walk(TESTS)];
const nodes = new Map<string, Node>();

for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const n: Node = { file: rel(f), imports: [], packages: [], dynamic: [], typeOnly: [], unresolved: [], directive: null, importers: [], testsDirect: [], testsTransitive: 0, entry: false, dead: false };
  const first = sf.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) {
    if (first.expression.text === "use client") n.directive = "client";
    if (first.expression.text === "use server") n.directive = "server";
  }
  const add = (spec: string, opts: { dynamic?: boolean; typeOnly?: boolean }) => {
    const r = resolve(f, spec);
    if (r === null) { if (!n.packages.includes(spec)) n.packages.push(spec); return; }
    if (r.startsWith("UNRESOLVED:")) { n.unresolved.push(spec); return; }
    const rr = rel(r);
    const list = opts.dynamic ? n.dynamic : n.imports;
    if (!list.includes(rr)) list.push(rr);
    if (opts.typeOnly && !n.typeOnly.includes(rr)) n.typeOnly.push(rr);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = !!node.importClause?.isTypeOnly;
      add(node.moduleSpecifier.text, { typeOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, { typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      add(node.arguments[0].text, { dynamic: true });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      add(node.arguments[0].text, {});
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // a type-only import that is also a value import is not type-only
  n.typeOnly = n.typeOnly.filter((t) => n.imports.includes(t));
  nodes.set(n.file, n);
}

// importers (static + dynamic), only between files we walked
for (const n of nodes.values()) {
  for (const t of [...n.imports, ...n.dynamic]) nodes.get(t)?.importers.push(n.file);
}

// Next.js entry points: the framework imports these, so no importer is expected.
const ENTRY = /^src\/app\/.*\/(page|layout|route|loading|error|not-found|template|default|opengraph-image)\.tsx?$|^src\/app\/(page|layout|not-found|error)\.tsx?$|^src\/(middleware|instrumentation)\.ts$/;
const SERVER_PKGS = /^(node:|fs$|path$|crypto$|mongodb|next\/server|next\/headers|server-only|bcrypt|@vercel\/sandbox|jose|next-auth$|@auth\/)/;

// server/client classification: directive, then route location, then what it reaches
function classify(file: string, seen = new Set<string>()): "server" | "client" | "shared" {
  const n = nodes.get(file)!;
  if (n.kind && n.kind !== "test") return n.kind;
  if (n.directive === "client") return "client";
  if (/^src\/app\/api\//.test(file) || n.directive === "server") return "server";
  if (n.packages.some((p) => SERVER_PKGS.test(p))) return "server";
  return "shared";
}
for (const n of nodes.values()) {
  if (n.file.startsWith("tests/")) { n.kind = "test"; continue; }
  n.kind = classify(n.file);
}
// shared code imported only by client code, and never by server code, is client-side in practice;
// a "shared" file that reaches a server package transitively is server
function reachesServer(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const n = nodes.get(file);
  if (!n) return false;
  if (n.kind === "server") return true;
  return n.imports.filter((i) => !n.typeOnly.includes(i)).some((i) => reachesServer(i, seen));
}
for (const n of nodes.values()) if (n.kind === "shared" && reachesServer(n.file)) n.kind = "server";

// test reach
const testFiles = [...nodes.values()].filter((n) => n.kind === "test");
const reach = new Map<string, Set<string>>(); // src file -> tests that reach it
for (const t of testFiles) {
  const seen = new Set<string>();
  const stack = [...t.imports, ...t.dynamic];
  for (const d of t.imports) nodes.get(d)?.testsDirect.push(t.file);
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const n = nodes.get(f);
    if (!n || n.kind === "test") continue;
    if (!reach.has(f)) reach.set(f, new Set());
    reach.get(f)!.add(t.file);
    stack.push(...n.imports, ...n.dynamic);
  }
}
for (const [f, s] of reach) nodes.get(f)!.testsTransitive = s.size;

// dead: no importer at all, and not a framework entry point
for (const n of nodes.values()) {
  if (n.kind === "test") continue;
  n.entry = ENTRY.test(n.file);
  const srcImporters = n.importers.filter((i) => !i.startsWith("tests/"));
  n.dead = !n.entry && srcImporters.length === 0;
}
// also report files reachable only from dead files ("dead-by-reachability"): walk from entries
const live = new Set<string>();
{
  const stack = [...nodes.values()].filter((n) => n.entry).map((n) => n.file);
  // scripts and bin also use src: count them as roots
  for (const dir of ["scripts", "bin"]) {
    const d = path.join(WEB, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of walk(d)) {
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const r = resolve(f, m[1] ?? m[2]);
        if (r && !r.startsWith("UNRESOLVED:")) stack.push(rel(r));
      }
    }
  }
  while (stack.length) {
    const f = stack.pop()!;
    if (live.has(f)) continue;
    live.add(f);
    const n = nodes.get(f);
    if (n) stack.push(...n.imports, ...n.dynamic);
  }
}
const unreachable = [...nodes.values()].filter((n) => n.kind !== "test" && !live.has(n.file)).map((n) => n.file);

// cycles: Tarjan over static value imports (type-only edges cannot cycle at runtime)
const cycles: string[][] = [];
{
  let idx = 0;
  const index = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), st: string[] = [];
  const strong = (v: string) => {
    index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    const n = nodes.get(v)!;
    for (const w of n.imports.filter((i) => !n.typeOnly.includes(i) && nodes.has(i))) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = st.pop()!; on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) cycles.push(comp.sort());
    }
  };
  for (const v of nodes.keys()) if (!index.has(v)) strong(v);
}

const src = [...nodes.values()].filter((n) => n.kind !== "test");
const summary = {
  srcFiles: src.length,
  testFiles: testFiles.length,
  byKind: Object.fromEntries(["server", "client", "shared"].map((k) => [k, src.filter((n) => n.kind === k).length])),
  entries: src.filter((n) => n.entry).length,
  dead: src.filter((n) => n.dead).map((n) => n.file),
  unreachableFromEntriesOrScripts: unreachable,
  noTestReach: src.filter((n) => n.testsTransitive === 0).length,
  unresolved: src.concat(testFiles).filter((n) => n.unresolved.length).map((n) => ({ file: n.file, specs: n.unresolved })),
  cycles,
};
console.log(JSON.stringify(summary, null, 2));
const out = process.argv[2];
if (out) fs.writeFileSync(out, JSON.stringify({ summary, nodes: [...nodes.values()] }, null, 2));
