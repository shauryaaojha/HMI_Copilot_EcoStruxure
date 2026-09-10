/**
 * Every workspace route fills the viewport and manages its own scrolling; the
 * chrome (top bar, nav rail, status bar) is supplied by WorkspaceShell rather
 * than here, because the shell also owns the resizable regions between them.
 *
 * Phase 0 of docs/BUILD_PLAN.md.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen">{children}</div>;
}
