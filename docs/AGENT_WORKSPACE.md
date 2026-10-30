# The agent: a working directory and tools for the Copilot

The chat Copilot proposes a fixed set of ops for the canvas. The agent works on
the opened `.eote` file itself, the way an engineer at a terminal would: it lists
and reads the project's files, searches them, copies the engineer's own objects,
binds tags, edits JSON, runs a script, checks the result and looks at a screen.
It loops (call a tool, read the result, decide the next step) until the job is
done, and every step is shown as it happens.

## Pieces

| File | What it is |
|---|---|
| `web/src/lib/agent/workspace.ts` | The working directory. The ZIP opened into memory, with original entry names, BOMs and order kept. JSON is checked on every write, SQLite runs through sql.js, and it has checkpoints, undo and a list of changes. Unchanged entries are written back byte for byte. `DriverConfig.db` (the PLC connection) is hidden from every tool and written back untouched. |
| `web/src/lib/agent/project.ts` | Project structure on top of the files: screens (Screens and Contents), objects at any depth with their JSON pointer, grid cell or box, bindings, `bind` / `unbind` through the packager, `cloneObject` with new ids (grid-aware), and `duplicateScreen` into the screen tree. |
| `web/src/lib/agent/tools.ts` | 30 tools in one provider-neutral registry. Files: `list_files`, `read_file`, `search`, `write_file`, `edit_file`, `json_get`, `json_set`, `copy_path`, `delete_path`, `sql_query`, `sql_exec`, `diff`, `checkpoint`, `undo`. Project: `project_summary`, `list_screens`, `screen_objects`, `find_objects`, `bindings`, `tags`, `own_objects`, `compound_objects`, `clone_object`, `bind`, `unbind`, `duplicate_screen`. Proof: `check`, `view_screen`, `run_script`, and `shell` where a sandbox can be had. |
| `web/src/lib/agent/script.ts` | `run_script`: JavaScript in QuickJS compiled to WebAssembly. It is a separate engine with its own heap, so a script has no `require`, `process`, network, file system or timers, only `ws.*` on the workspace. Each run gets a 64 MB memory cap and a 10 s deadline. |
| `web/src/lib/agent/sandbox.ts` | `shell`: bash in a Vercel Sandbox microVM (Ubuntu with Python 3.14, Node 24, sqlite3, unzip, zip and jq). The project's files are copied to `/vercel/project`, without the PLC connection, and `/vercel/work` is scratch space. After each command every file is hashed, and what changed, was added or was deleted comes back through the workspace's checks: JSON stays valid, core files are put back, and `DriverConfig.db` cannot be written. The network reaches only pypi and npm, so nothing can be sent elsewhere. There is one sandbox per run, started on first use and stopped when the run ends (15 min at most). It is offered on Vercel (OIDC) or locally with `VERCEL_OIDC_TOKEN` from `vercel env pull`. `AGENT_SHELL=off` turns it off. |
| `web/src/lib/agent/run.ts` | The loop, for Claude (streaming, adaptive thinking, prompt caching, eager tool input, context editing that clears old tool results, server-side fallback) and for Gemini (function calling, waiting out a busy model or the per-minute quota it reports). |
| `web/src/app/api/agent/route.ts` | `POST {source, message, history}` returns NDJSON, one event per line. The file is loaded with the same access check the export uses. When anything changed, the result is stored as a new file and the last line is `{type: "saved", sourceId, project}`. The opened file is never changed. |
| `web/src/components/chat/AgentPane.tsx` | The **Agent** tab in the Copilot column. It shows each step live, reloads the project from the saved file, and offers one click to put back what was open before. |
| `web/scripts/agent.mts` | The same loop at a terminal: `npx tsx --tsconfig scripts/tsconfig.json scripts/agent.mts <file.eote> "<job>" [--out out.eote]`. |

## Guards that came from watching it work

These were found by running it live on the Panel-1 rig:

- `edit_file` accepts the model's loose whitespace, but only when the match is unique; otherwise it points to `json_set`.
- Core files (`Project.dat`, `Bindings.dat`, a screen's `Screen.dat` and `Metadata.dat`, the hierarchies) cannot be deleted. The prompt says to use `undo` rather than start over. Deleting a whole screen folder also takes it out of the tree.
- In a grid, `clone_object` places by row and column. With no cell given, it picks the first free cell the copy fits in. When the copy covers other objects, it names them, and says if the grid has no free cell. The engineer overlaps objects on purpose (a reading on a gauge), so this is a warning, not a refusal.
- `check` covers:
  - JSON in every file and the reader
  - duplicate ids
  - bindings to missing objects
  - duplicate screen numbers
  - the screen tree
  - the export preflight
  - a full repackage

## Live result (Gemini flash-lite, free tier, on the rig)

The job was "On the Meter content screen, add a push button made like the engineer's START button that shows AUTO START, bound to AUTOSTART the way START is bound to Run_CMD":

1. The agent found START (`CompoundObject.Switch_PB04` on the Start_Stop content screen) and its binding (`CV <- MachineExpertEquipment1.Main.Run_CMD.Value`, mode 2).
2. It copied START into the Meter grid and set its `Text` OFF/ON to AUTO START.
3. It bound `CV` to `MachineExpertEquipment1.Main.AUTOSTART.Value`, mode 2.
4. Check was clean.

The run took 20 steps, about 190k input tokens (107k cached) and 0.7k output, and waited out one per-minute quota pause. The Meter grid has no free 3×2 cell, which the tool now says. The OTE editor has not yet opened the file; that proof is still a laptop step.

## Live result: the shell

The job was "Use the shell with Python to count the objects of each Type and list every tag no object is bound to; change nothing":

- Gemini flash-lite wrote three Python scripts on its own and ran them in a real sandbox against the rig project.
- It answered with type counts and 143 unbound tags, and changed 0 files.
- It used about 56k input tokens.
- A sandbox starts in about 1 s; one round of start, command and stop takes about 5 to 9 s.

## Configure

- `AI_PROVIDER` and the key, as for the chat: `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`, in Vercel env or `.env.local`.
- `AGENT_MODEL` sets the model. The defaults are `claude-opus-5-5` for Claude and `gemini-flash-latest` for Gemini. On the Gemini free tier, `gemini-flash-lite-latest` is the one that stays available.
- `AGENT_EFFORT` (Claude: low to max, default high).
- `AGENT_STEPS` (default 40).
- The route's `maxDuration` is 300 s.

## Not yet

- The shell has not yet been run from the deployed app. Locally it uses the development OIDC token, which expires after 12 h; on Vercel the platform supplies the token.
- The OTE converter in the sandbox: it is a Windows program, so it stays on the laptop bench.
- The tools over MCP, so the editor's own agent or another client can use them (Antik's connector, S4).
- Proof in the OTE editor itself: open the agent's file and build it. Today that runs on the laptop bench (`docs/PLAN_PROJECT_NATIVE.md`).
