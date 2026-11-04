# Design C: one indexed knowledge base the AI builds screens from

Audit 2026-11, stream S5. Status: design only. Nothing here is built. Companion designs:
- `docs/audit/DESIGN_NESTED_CANVAS.md` (design A: layout facts and the solver);
- `docs/audit/DESIGN_SCREEN_VISUALS.md` (design B: the component library; another stream writes it, and this
  design indexes its components by reference).

Client-data rule: this document describes the *shapes* and *sizes* of what exists. It names engineer projects
by file name only, and contains no tag, screen, text or symbol content from them.

---

## 1. The problem, with evidence

### 1.1 What exists today: ten sources, no index

| Source | What it holds | How the AI reaches it | Evidence |
|---|---|---|---|
| `web/src/lib/ote/schema.ts` | 27 `PART_TYPES` (`:910`) plus `CompoundObject`; zod schemas of every property | the part list hard-coded in the prompt; `target_capabilities` (`lib/ai/tools.ts:264`) | properties are reachable only by the inspector's schema walker (`components/inspector/schemaFields.ts:368-487`) |
| `web/src/lib/composites/index.ts` | 3 composite kinds (AnalogIndicator, KpiTile, EquipmentSymbol) with zod props | op `type` enum (`lib/ai/ops.ts:111`) | design B replaces and extends these |
| `web/src/lib/library/machines.ts` | `MACHINE_CLASSES` (`:169`, 41 classes, counted at run time): roles with PLC spellings, alarms, headline readings, trends, a symbol hint | `machine_class`, `get_equipment` tools | |
| `web/src/lib/standard/pack.ts` | the ISA-101 pack: colour tokens, geometry thresholds (`:138-149`) | lint and critic only; never shown to the model as rules | |
| `web/src/lib/backend/panels.ts` | 5 panel models with sizes (`:28-34`) | `read.target` | all 4 engineer files (`auto&manua.eote`, `HMICopilot_Panel1.eote`, `HMICopilot_Drive_4.1.eote`, `Motor_Drive_Control_4.1.eote`) target HMIST6600 at 1280x800, which is not in the list (measured by `scripts/audit/s5-measure.mts`) |
| `web/src/lib/ote/layout.ts`, `regions.ts` | zone constants (header 44, nav 32, footer 28, margin 12, gap 16, card 320x162, tile 238x100), level grids | `roomReport` counts | patterns exist only as code, not as described patterns |
| `web/src/lib/ote/graphics-index.json` | `{ symbols: array[474] }`; each entry `{name, category, d, width, height, Commands, Points}`, all 474 with geometry; 13 categories; 957,087 bytes; median entry about 1.5 KB, largest about 24 KB. Gitignored: derived from Schneider's installation | `lib/ote/symbols.ts` at layout time, `/api/symbols` for the library panel | not searchable by the model |
| `web/src/lib/ote/exemplars.ts` | per *open* file: one example each of 5 kinds (pushbutton, toggle, entry, reading, status), with how it is bound (`:33-47`, `105-139`) | `own_objects` agent tool (`lib/agent/tools.ts:445`) | never stored, by design (`:20-22`) |
| `web/src/lib/knowledge/` | per scanned project, a `ProjectKnowledge` v1 record (`scan.ts:43,114-145`): every object's type, name, box, text up to 80 characters, every binding, variable, alarm, naming statistics, DB table schemas. `conventions.ts` aggregates how each tag word is bound, with support counts | `binding_precedent`, `example_screens` (`lib/ai/tools.ts:186-226`) | 0 records locally (`web/.knowledge` is empty); production answers `GET /api/knowledge` with `store: "off"` (measured 2026-11-04) |
| docs (`CO_FORMAT.md`, `VXDZ_FINDINGS.md`, `REENGINEERING.md`, ...) | format facts, ISA-101/18.2 reasoning | none at run time | |

Drivers and tag conventions:
- Drivers are not modelled anywhere. `DriverConfig.db` is carried, and hidden from the agent on purpose
  (`lib/agent/run.ts:72`).
- The scanner records only its table and column names (`knowledge/scan.ts:462-465`).
- Tag conventions are `namingStats` (`scan.ts:178-206`) and the `byRole` aggregate (`conventions.ts:65-127`).

### 1.2 What is wrong with that

1. **There is no single lookup.** Each source has its own access path, and several have none for the model.
   Nothing answers "what can show a REAL tag with a range, on a 640x480 panel, in the ISA-101 style".
2. **The knowledge base is empty and its learning is circular.**
   - 0 records locally, and the store is off on production.
   - AUDIT_2026-10 §7.4 asked for the template corpus to be fed in. It has not been, so this finding is still
     open.
   - With nothing fed in, `conventions` describe only our own output.
3. **Every chat turn loads every record.** `allKnowledge()` reads the whole store and hands it to the tools
   (`app/api/chat/route.ts:105-114`). Then `aggregate()` runs over all records in the tool context
   (`lib/ai/tools.ts:77`). At a few hundred scanned projects, each with every object and variable, that is the
   whole corpus per message.
4. **Records keep raw client strings.**
   - Variable names, comments and alarm messages are kept verbatim; on-screen text up to 80 characters
     (`scan.ts:45-62,89-98,389,402`).
   - The scanner's header says it records "structure and names, never the file" (`scan.ts:22-25`). That
     undersells it: on-screen text and alarm text are content, not names.
   - The store is local by default for that reason (`store.ts:1-18`).
   - But **the route that serves it has no session check** (S5-05). `GET ?id=` returns a full record, and
     `DELETE` removes one, for an anonymous caller. Proof: `web/scripts/audit/s5-knowledge-unauthenticated.test.ts`.
5. **Nothing keeps it true to the code.** The machine library, the panel list, the part types and the pack are
   code. The prompt restates parts of them in prose (`lib/ai/converse.ts` system prompt). The tool table
   restates "Rectangle, TextBox, Lamp or NumericDisplay" (`lib/ai/tools.ts:266`). Nothing fails when they drift.
6. **The panel list is already behind the files.**
   - All 4 engineer files use a model the list does not have.
   - `panelFromValue` marks it `provisional` (`lib/backend/panels.ts:56-64`).
   - Layout is then designed for a panel with no known features.

---

## 2. The design

### 2.1 One index, many layers

The knowledge base (KB) is one in-memory index of **entries**. Entries come from **layers**. Each layer has its
own storage and its own privacy class. The index is the union of the layers the caller may see.

| Layer | Privacy | Built from | Stored |
|---|---|---|---|
| `code` | public | generators that import the code (2.5) | `web/src/lib/kb/generated/code.json`, committed, checked by a test |
| `docs` | public | curated entries for ISA-101 / ISA-18.2 rules and layout patterns, each linked to the checker that enforces it | `web/src/lib/kb/curated/*.ts`, committed |
| `components` | public | design B's component library (`DESIGN_SCREEN_VISUALS.md`), generated from its definitions like composites today | part of `code.json` |
| `install` | local only (Schneider-derived) | `graphics-index.json`, DeviceInfo panel models when an installation is present | `.knowledge/install.json` on the machine that has the product; never committed, never uploaded |
| `corpus` | per owner / org | anonymised patterns from scanned projects (2.6) | filesystem `.knowledge/` (default) or Mongo collection `kb_corpus` keyed by org (opt-in) |
| `project` | the open project only | `exemplars.harvest` and the open file's own conventions | memory, per request; never stored |

The existing `ProjectKnowledge` scan stays as the *raw* input of the `corpus` layer. It is kept only where it is
kept today: local, or Mongo by explicit opt-in. Raw scans are never served to a model or over MCP. Only derived,
anonymised `corpus` entries are.

### 2.2 Entry kinds

| Kind | Id form | Examples of what it says |
|---|---|---|
| `partType` | `part:Lamp` | what it shows, emitted by the packager (yes or no), default size, accepted data types (`lib/tags/binder.ts`), value property |
| `property` | `prop:Lamp.On.Fill` | path, zod type, enum values, range, which inspector group |
| `component` | `comp:pump.faceplate.l2` | design B: variants, sizes, states, colour tokens, the OTE parts or `.co` it maps to |
| `pattern` | `pattern:l2.cardGrid` | a layout pattern: zones, grid, card size per panel, capacity (from `layout.ts` `gridFor`/`capacityOf`) |
| `rule` | `rule:isa101.colourIsSignal` | statement, rationale, source, the checker id that enforces it (`geom.textContrast`, `lint.*`), thresholds from the pack |
| `panel` | `panel:HMIST6500AWADI` | resolution, family, formats, touch or keys, whether it came from the code list or a DeviceInfo file |
| `driver` | `driver:<product>` | product name, address syntax, data types (open question 2) |
| `tagConvention` | `tag:suffix.RUN` | role, data type, how it is bound (part.property), support (count, projects) |
| `machineClass` | `class:pump` | roles, alarms, headline, trends, symbol hint (from `MACHINE_CLASSES`) |
| `symbol` | `sym:<category>/<name>` | install layer only: category, natural size, has geometry; never the geometry in a search result |
| `example` | `ex:<hash>` | an anonymised worked screen (2.6): a pattern instance with units, roles and layout facts in design A's `LayoutFacts` shape |

### 2.3 Data structures

```ts
// lib/kb/types.ts
export type Layer = "code" | "docs" | "components" | "install" | "corpus" | "project";
export type Kind = "partType" | "property" | "component" | "pattern" | "rule" | "panel" | "driver"
  | "tagConvention" | "machineClass" | "symbol" | "example";

export interface Source {
  /** Where the entry is true: a code symbol, a doc anchor, or a derived corpus statistic. */
  kind: "code" | "doc" | "standard" | "corpus" | "install";
  ref: string;              // "web/src/lib/backend/panels.ts#PANELS", "ISA-101.01-2015 §6.3", "corpus:v3"
  /** Hash of the input it was generated from, so drift is a diff. */
  inputHash: string;
}

export interface Entry<B = unknown> {
  id: string;               // namespaced, stable across builds: "part:Lamp"
  kind: Kind;
  layer: Layer;
  title: string;            // one line, what a person would search for
  summary: string;          // two sentences, the model reads this first
  tags: string[];           // lower-case facets: "bool", "status", "l2", "640x480", "isa101"
  body: B;                  // typed per kind (below)
  related: string[];        // ids: a component -> its parts, rules, patterns
  source: Source;
  rev: string;              // hash of body; changes when the fact changes
  /** corpus only: how much evidence. */
  support?: { count: number; projects: number };
}

export interface PartTypeBody {
  type: string; emitted: boolean; valueProperty?: string; accepts?: string[];
  defaultSize: { width: number; height: number };
  properties: string[];     // prop:* ids
}
export interface PanelBody { model: string; width: number; height: number; formats: string[]; viewing: string; from: "code" | "deviceInfo" | "file" }
export interface RuleBody { statement: string; why: string; checker?: string; thresholds?: Record<string, number>; severity: "must" | "should" }
export interface PatternBody { level: 1 | 2 | 3; zones: Record<string, number>; perPanel: { panel: string; columns: number; rows: number; cell: { width: number; height: number } }[] }
export interface TagConventionBody { role: string; dataType?: string; boundTo: { target: string; share: number }[] }
export interface ExampleBody {
  panel: string;            // "1280x800", never a model the customer would be identified by alone
  level?: 1 | 2 | 3;
  facts: import("@/lib/layout/types").LayoutFacts;  // design A, with names replaced (2.6)
  units: { id: string; component?: string; role?: string; dataType?: string }[];
}

export interface KbIndex {
  version: { schema: number; code: string; corpus?: string; install?: string };
  byId: Map<string, Entry>;
  byTag: Map<string, Set<string>>;
  terms: Map<string, Map<string, number>>;   // term -> id -> weight, for search
}

export interface Kb {
  get(id: string): Entry | undefined;
  byTag(tag: string, opts?: { kind?: Kind; limit?: number }): Entry[];
  search(q: string, opts?: { kinds?: Kind[]; tags?: string[]; limit?: number }): { entry: Entry; score: number }[];
  related(id: string, depth?: 1 | 2): Entry[];
  version: KbIndex["version"];
}
```

### 2.4 Storage and versioning

- **The code layer** is a generated JSON file, committed and reviewed like code. The build regenerates it.
  A test regenerates it in memory and diffs it against the committed file (2.5).
- **The install layer** is regenerated by `npm run index:graphics`, which exists today, extended to write
  `.knowledge/install.json`. It sits beside the gitignored `graphics-index.json`, never in the bundle, as
  `symbols.ts:4-13` already requires.
- **The corpus layer** is append-only *derivations* over raw scans:
  - a derivation run writes a numbered set `corpus:vN` with its inputs' hashes;
  - deleting a raw scan (`DELETE /api/knowledge`) triggers a re-derivation, so no derived entry outlives the
    project it came from.
- **Versions:**
  - `schema` is an integer bump with a migration. `ProjectKnowledge` v1 becomes v2: raw scans gain
    `derivedAt` and `owner`.
  - `code` is the hash of `code.json`.
  - `corpus` and `install` are set ids.
  - Each chat turn and agent run records `kb.version` in its trace, so an answer can be replayed against the
    same knowledge.
- **Per-entry `rev`** lets the agent cache and lets a reviewer see exactly which facts changed between builds.

### 2.5 How it stays true to the code

Generators import the code they describe. Nothing is restated by hand:

| Generator | Reads | Writes entries |
|---|---|---|
| `gen/parts.ts` | `schema.ts` `Part` options and `PART_TYPES`; `schemaFields.ts` `fieldsOf` (reused, it already walks the zod tree); `tags/binder.ts` `valuePropertyOf`/`acceptedTypes`; `ScreenRenderer.tsx` `defaultSize` (moved to a shared module) | `part:*`, `prop:*` |
| `gen/panels.ts` | `backend/panels.ts` `PANELS` | `panel:*` |
| `gen/machines.ts` | `library/machines.ts` `MACHINE_CLASSES` | `class:*` |
| `gen/pack.ts` | `standard/pack.ts` `DEFAULT_PACK` tokens and `rules` | thresholds on `rule:*` (curated statements, generated numbers) |
| `gen/patterns.ts` | `ote/layout.ts` `ZONES`, `gridFor`, `capacityOf`, evaluated for every panel | `pattern:*` |
| `gen/components.ts` | design B's component definitions (and `composites/index.ts` until B lands) | `comp:*` |

Tests (in `web/tests/kb.test.ts`):
1. **Fresh.** Regenerating `code.json` in memory equals the committed file. On failure the message names the
   changed ids and says `npm run kb:build`.
2. **Complete.**
   - Every `PART_TYPES` member has a `part:*` entry, and every `part:*` names a real type.
   - The same holds for panels, machine classes and composites/components.
3. **Rules are enforced.** Every `rule:*` with a `checker` names a rule id that exists in `critic/geometry.ts`
   or `validation/rules.ts`. A test reads the ids from the code, not from a list.
4. **Components are emittable.** Every `comp:*` maps only to emitted `part:*` entries or to a `.co` the
   packager can write (design B's rule).
5. **Examples replay.** Every `example:*` turned into design A constraints solves with residual 0 on its own
   panel, and its units' part types are all emitted.
6. **Privacy.**
   - No `corpus` or `example` entry contains any string that appears as a variable name, comment, alarm
     message or on-screen text in the raw scan it was derived from. The test runs over a synthetic scan seeded
     with marker strings.
   - Raw scans are refused by the serializer that feeds the model and MCP.
7. **No prompt drift.** The prompt's part list and `target_capabilities` read from `kb.byTag("emitted")`.
   A test asserts the old hard-coded strings (`lib/ai/tools.ts:266`) are gone.

### 2.6 Worked examples from real screens: how they are derived and anonymised

The KB never includes a real screen. It includes a **pattern instance** derived from one:

1. **Input.** A raw `ProjectKnowledge` scan, local or opted-in, plus the screen's design A `LayoutFacts`,
   computed at scan time.
2. **Strip identity.**
   - Screen, object, variable and alarm names are dropped.
   - Each bound unit keeps only its *role* (`roleOf` in `lib/ai/infer.ts`) and data type.
   - Each text keeps only a length class (`short`/`label`/`sentence`).
   - Numbers that are geometry are kept, normalised to the panel: boxes as fractions of the root box, plus the
     grid unit.
   - Ranges and setpoints are dropped.
   - The panel is kept as a resolution only.
3. **Abstract.** Units map to the nearest component (design B) or part type. The screen becomes a `pattern`
   instance: level, zones, grid, rows and columns.
4. **k-anonymity.**
   - An example is written to a *shared* (org) corpus only if its pattern signature has been seen in at least
     **3 distinct projects**. The signature is the sorted component and role multiset plus the row/column
     structure, quantised to the grid.
   - Below that threshold it stays in the owner's local layer.
   - Support counts are published; source file hashes are not.
5. **Provenance.** `source.ref` is `corpus:vN#<signature hash>`, which points to no file.
6. **Removal.** Deleting a raw scan re-derives the corpus layer. Signatures that fall below 3 projects leave the
   shared set.

Tag conventions follow the same rule:
- `tagConvention` entries hold suffix words and bindings with support counts. That is what `conventions.ts`
  already computes.
- Prefixes and loop numbers, which identify plants, are kept only in the owner's local layer.

### 2.7 Lookups for the agent and the MCP server

All three of these are served by one `Kb` instance, built once per process and per layer version. The
per-message load of every raw record goes away (fixes 1.2 item 3):
- by id, an O(1) map;
- by tag, an inverted index;
- by search: term weights over `title`, `summary` and `tags`. These reuse `lib/ai/retrieve.ts` `tokens()`, so the
  KB is deterministic and keyless (Lane 1, like `lib/ai/tools.ts:14`; 9 tools today). Synonyms come from `retrieve.ts`
  `SYNONYMS`. Embeddings are a later, optional ranker behind the same `search` signature.

| Caller | Tool | Answer |
|---|---|---|
| Chat (`lib/ai/tools.ts`) | `kb_search(q, kinds?, tags?)`, `kb_get(id)` | top entries' `title`, `summary`, `id`; `kb_get` adds `body`. Existing tools become thin views: `machine_class` = `kb_get("class:"+id)`, `binding_precedent` = `byTag("tag:"+word)`, `example_screens` = `search(kinds:["example"])`, `target_capabilities` = `byTag("emitted")` |
| Agent (`lib/agent/tools.ts`) | the same two tools, plus `kb_related(id)` | the same; `own_objects` stays as the `project` layer |
| MCP (`lib/mcp/read.ts`) | read tools `kb_search`, `kb_get` | layers `code`/`docs`/`components` for any authenticated caller; `corpus` filtered to the caller's org; `install` never (Schneider-derived); `project` only inside a project-scoped call |
| HTTP | `/api/knowledge` | gains a session check and an owner/org filter (S5-05). Raw scans are readable only by their owner |

Every answer has a token budget. Search returns at most 8 entries of title plus summary, and `kb_get` caps
`body` at about 2 KB. The model pulls detail by id, so a turn never carries the corpus.

### 2.8 What changes, in which files

| File | Change |
|---|---|
| `web/src/lib/kb/{types,index,search,serve}.ts` | new: the index, lookups, privacy filter by caller |
| `web/src/lib/kb/gen/*.ts`, `scripts/kb-build.mts`, `package.json` `kb:build` | new generators; `code.json` committed |
| `web/src/lib/kb/curated/{isa101,isa182,patterns}.ts` | rule and pattern statements with sources and checker ids |
| `web/src/lib/knowledge/scan.ts` | v2: add `LayoutFacts` per screen; keep raw strings only in the raw record |
| `web/src/lib/knowledge/derive.ts` | new: raw scans to anonymised `corpus` entries (2.6) |
| `web/src/lib/knowledge/store.ts` | owner/org on records; `corpus` sets; delete triggers re-derive |
| `web/src/app/api/knowledge/route.ts` | session check, owner filter (S5-05) |
| `web/src/app/api/chat/route.ts` | stop loading `allKnowledge()` per turn; pass the `Kb` |
| `web/src/lib/ai/tools.ts`, `converse.ts` | tools as KB views; the prompt's part list from the KB |
| `web/src/lib/agent/tools.ts` | `kb_search`, `kb_get`, `kb_related` |
| `web/src/lib/mcp/read.ts` | `kb_search`, `kb_get` read tools (new tools; existing tools' wire format unchanged) |
| `web/src/lib/backend/panels.ts` | rows from DeviceInfo when an install is present (install layer); HMIST6600 added once confirmed |
| `scripts/index-graphics.mjs` | also writes `.knowledge/install.json` symbol entries (no geometry in search results) |

### 2.9 Risks

| Risk | Mitigation |
|---|---|
| A client string leaks into a shared example | derivation drops strings by construction; privacy test 6 with marker strings; k >= 3 before sharing; raw scans never served |
| Schneider-derived geometry leaves the machine through MCP | `install` layer excluded from MCP and shared stores; `symbol` entries carry no geometry in search results |
| The code layer goes stale | test 1 fails the build; generators import the code |
| The KB grows into a second prompt that is too long | budgeted answers; pull by id |
| A curated rule disagrees with the checker | each rule names its checker; the thresholds are generated from the pack |
| Re-derivation cost on delete | derivation is per signature; a delete touches only the signatures of that project |
| Search is weak without embeddings | facets (tags) carry most lookups; search is a fallback; embeddings later behind the same API |

### 2.10 Phased plan, with tests per phase

| Phase | Size | Builds | Tests |
|---|---|---|---|
| 0. Close the hole | S | session plus owner check on `/api/knowledge` (S5-05) | the audit test moves to web/tests and passes; owner A cannot read owner B's scan |
| 1. Code layer | M | types, index, generators for parts/props/panels/classes/patterns/composites, `kb:build`, `code.json` | tests 1, 2, 7; `kb.get("part:Lamp").body.emitted === true`; search "level reading 640x480" returns `pattern:*` and a reading component first (golden) |
| 2. Rules layer | S | curated ISA-101 / ISA-18.2 / pack rules linked to checkers | test 3; every critic and lint rule id has a `rule:*` entry (both directions) |
| 3. Wire into chat, agent, MCP | M | KB tools; chat route stops loading all records; MCP read tools | tool tests with a fixed KB; MCP list tools includes `kb_search` with a valid input schema; a chat turn trace carries `kb.version` |
| 4. Corpus layer | L | scan v2 with `LayoutFacts`; `derive.ts`; k-anonymity; delete triggers re-derive | test 6 (privacy) with marker strings; k-threshold test (2 projects: local only; 3: shared); delete removes derived entries; feeding the tracked `demo_project` files yields `tagConvention` entries with correct support |
| 5. Examples and components | M | design B components in; examples replay through design A's solver | tests 4, 5 |
| 6. Install layer | S | symbols and DeviceInfo panels on machines with the product | builds only where `graphics-index.json` exists; skipped elsewhere (the pattern `symbols.ts` already uses) |

### 2.11 Open questions for Shaurya

1. **Corpus.** May the template corpus (`EOTE_Template_v7.zip`, AUDIT_2026-10 §7.4) be scanned into a *local*
   corpus layer on Pranav's machine, and is any org-shared corpus wanted on production, where the store is off
   today?
2. **Drivers.** `DriverConfig.db` is hidden from the agent on purpose. Should the KB describe drivers at all
   (product names, address syntax, data types from an installation's driver list), or stay silent until a
   driver is in scope?
3. **k for sharing.** Is 3 distinct projects the right threshold before a pattern leaves the owner's layer, and
   is "org" the right sharing boundary?
4. **Panels.** May DeviceInfo model lists from an installation populate panel entries locally, and may the 1280x800
   HMIST6600 (the target of all 4 engineer files) be added to `panels.ts`?
5. **MCP.** Are two new read tools (`kb_search`, `kb_get`) acceptable on the claude.ai connector? They add
   tools; they change no existing tool's wire format.
6. **Raw scans.** Should raw scans keep alarm and on-screen text at all, given they are content? The design
   needs only roles, types and geometry. Dropping the strings at scan time would make the store safer by
   construction.
