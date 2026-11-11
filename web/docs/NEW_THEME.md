# The new theme: Evergreen

Branch `feat/new-theme`, started 2026-11-11.

The graphite pass (feat/ui-revamp) moved the chrome from blue-grey to warm grey, which is the same step Linear took in its March 2026 refresh: a calmer palette, deliberately hard to notice. Nobody who used the app saw a difference. This one is meant to be seen. It keeps every route, every button and every API call where it is, and changes what they look like and how the workspace is laid out.

## Research, in short

- Linear (2026): warmer and less saturated greys, a dimmed sidebar so the content leads, compact rounded tabs, fewer and smaller icons, softer separators.
- draw.io (2025): softer colours with more contrast, rounded edges, fewer separators in the header, panels and tabs, and the theme toggle moved into a menu.
- Shapr3D: fixed "menu islands" for the permanent tools, sidebars that open from fixed corners, and filled icons for contrast.
- Lucid (2026): one core toolbar instead of separate panels, a left panel for content, a floating bar for light edits, a right panel for depth. They call the editor a "precision instrument".
- Developer and monitoring tools are dark-first, with one accent and strict contrast. Dense interfaces are back.

What all of them share, and what this app lacks, is a frame you can see: the work sits in distinct islands, the chrome steps back, and type does more of the work than colour.

## The decisions

1. **Islands, not panes.** The workspace stops being one surface cut up by hairlines. The Copilot, the canvas and the inspector each become a rounded island floating on the base, with an 8px gutter around them. The top bar and the nav rail sit directly on the base, not on a surface of their own. This is the change you see first.
2. **Evergreen neutrals.** Both themes take their greys from Schneider's green, not from warm or cool grey. In the dark this is a deep green-black (base `#08100c`, islands `#0e1813`); in the light it is a sage paper (base `#e9eee9`, islands `#ffffff`). The brand green becomes the obvious accent rather than one more green on near-black.
3. **IBM Plex Sans and IBM Plex Mono**, loaded through `next/font` (self-hosted at build time, so no request leaves the user's browser). Plex was drawn for engineering software, it has real tabular figures, and it looks nothing like Inter or Segoe UI. Tag names, handles and values use Plex Mono.
4. **One accent and three actor hues.** Green stays the Copilot's colour; violet the agent's, cyan the connector's. Status colours do not change, because an alarm is the same red in every theme.
5. **The HMI canvas is never themed.** ScreenRenderer reads no token. That rule stays.
6. **Motion from the Animations folder, used with restraint.** CSS only in the workspace; the landing and the start pane can afford more. No WebGL runtime anywhere. Each effect gets a reduced-motion fallback.

## Phases

Each phase ends with typecheck, the full test suite, a headless-browser pass over the routes it touched (scrolling every scroll region with the wheel, at 1440x900 and at a short 1280x680 window), and a commit.

| Phase | What | Status |
|---|---|---|
| 0 | Tokens, fonts, base CSS, motion library, theme bootstrap | |
| 1 | UI primitives: Button, Badge, EmptyState, Field, Input, Panel, Select, Tabs, Toggle | |
| 2 | Workspace frame: WorkspaceShell, TopBar, NavRail, StatusBar, PageShell, AccountControl, CommandPalette, Workspace | |
| 3 | Copilot: ChatPanel, AgentPane, ConnectorPane, ProposalReview, SharedProposals, RunOutput, RunOverlay | |
| 4 | Canvas chrome: CanvasPane, CanvasToolbar, ScreenStrip, ScreenBoard, InsertMenu, CanvasContextMenu, Rulers, ImportScreensDialog, RegenerateDialog, ScreenJson, StaticScreen, PresenceOverlay, PresenceAvatars | |
| 5 | Inspector: Inspector, LayersPanel, BindingEditor, CompositeEditor, editors, CommentsPanel, LibraryPanel | |
| 6 | Start and projects: StartPane, BriefTable, ProjectsScreen, ShareDialog, SharedProjectView | |
| 7 | Project pages: Tags (TagsScreen, TagImport, TagTable, TagSummary, BindingProposals), BindingMap, Plant, Templates, Library, Standards (StandardsScreen, StandardsInForce, ColourModeSwitch), Validation (ValidationResults, CriticPanel), Export (ExportScreen, VijeoExportCard), History, Settings (SettingsScreen, KnowledgePanel) | |
| 8 | Landing and auth: app/page.tsx, landing/*, AuthPage, SignInForm, SignInNotice, SignInPrompt, account/*, oauth/authorize, reset, s/[token] | |
| 9 | Sweep: every route in both themes, scroll and keyboard checks, reduced motion, the leftover list empty | |

Canvas parts (`canvas/parts/*`, `ScreenRenderer`) draw the HMI screen and are out of scope by design. They are checked for regressions only.

## Leftover list

A component is struck out when it has been converted and checked in a browser.

(filled in as phases land)
