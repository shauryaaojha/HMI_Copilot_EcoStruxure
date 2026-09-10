/**
 * Chrome shared by every workspace route: top bar and nav rail, with the route's
 * own content filling the rest. Phase 0 of docs/BUILD_PLAN.md.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen flex-col">{children}</div>;
}
