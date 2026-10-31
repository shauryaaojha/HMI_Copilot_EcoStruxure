# Server-side screen rasterisation does not work in a Next runtime

*Found 2026-11-01 while driving `render_screen` through the MCP Inspector
against a running server. Pre-existing: it is not caused by phases 1-4, and it
fails on code that predates them. Written down because the test suite
structurally cannot catch it, so nothing else will remind anyone.*

## What happens

Any server route that rasterises a screen fails:

```
Error: Attempted to call ScreenRenderer() from the server but ScreenRenderer
is on the client. It's not possible to invoke a client function from the
server, it can only be rendered as a Component or passed to props of a Client
Component.
```

Reproduced on two routes, one of which long predates this work:

| Caller | Result |
|---|---|
| `POST /api/mcp` → `render_screen` (`lib/mcp/read.ts:17`) | tool answers its catch-all refusal |
| `POST /api/critique` with `renderOnly` (`app/api/critique/route.ts:41`) | HTTP 500, the error above as JSON |

`lib/critic/critic.ts:220` calls the same function, so the visual critic is
affected wherever it runs on a server.

## Why

`lib/critic/render.ts` builds its SVG from `ScreenRenderer`
(`components/canvas/ScreenRenderer.tsx`), which is `"use client"` - correctly,
because it owns selection, dragging and the smart guides and therefore needs
hooks. Server code importing a client component receives a *reference*, not a
function, so calling it throws.

## Why no test fails

`tests/critic.test.ts` renders the same screen through the same function and
passes. Vitest applies no React Server Components transform: it imports the
module and gets the real function. The client boundary only exists inside
Next's bundler, so **this entire class of defect is invisible to the suite**
and only a running server reveals it. Worth remembering beyond this one bug.

## What a fix needs

Not simply dropping `"use client"` from `ScreenRenderer`: it genuinely needs
its hooks.

The rasteriser wants the drawing without the editing, which is `PartNode` in
`components/canvas/parts/index.tsx` - the exhaustive per-part switch, carrying
no `"use client"`. Rendering the parts directly does remove this error. It was
tried and reverted, because it uncovers the second half of the problem:

```
You're importing a component that needs `createContext`. This React Hook only
works in a Client Component.
```

`parts/Shapes.tsx:13,173` (`PictureSource`) and `parts/ContentDisplay.tsx:14,24`
(`ContentScreens`) call `createContext` at module scope while carrying no
`"use client"`. That was legal as long as they were only ever reached *through*
`ScreenRenderer`, which is a client component; reached from a server module,
Next refuses the import. Both contexts have sensible defaults and would behave
correctly under `renderToStaticMarkup` - the refusal is the bundler's static
analysis, not a runtime failure.

So a real fix is a context-free drawing path for the parts: pass the picture
URL resolver and the content-screen map as props rather than through context,
or split each part into a pure renderer plus a thin client wrapper that reads
the context. That touches the editor, so it is its own change with its own
review - not a tail-end edit to a branch about something else.

## Until then

`render_screen` is listed and schema-correct, and refuses at the moment it
would draw. The MCP Apps screen-preview card (`lib/mcp/cards.ts`) draws from
that tool's image, so it has nothing to show either. Everything else in M1, M2,
M3 and M4 works against a running server; this is the one tool that does not.
