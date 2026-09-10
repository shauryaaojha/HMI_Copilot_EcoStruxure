"use client";

/**
 * The left icon rail. Reference screens 1-6: eight destinations, then Help and
 * Settings pinned to the foot.
 *
 * Reference screen 4 (docs/ui-reference/04-screen-map.png) is the full sitemap;
 * routes that Phase 9 has not built yet are still listed, because a rail that
 * grows as pages land tells the engineer nothing about where they are.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  History,
  LayoutGrid,
  LayoutTemplate,
  Library,
  Ruler,
  Settings,
  ShieldCheck,
  Tag,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui";

interface NavItem {
  label: string;
  /** Appended to /project/<id>. Empty string is the workspace itself. */
  slug: string;
  icon: LucideIcon;
}

const MAIN: NavItem[] = [
  { label: "Workspace", slug: "", icon: LayoutGrid },
  { label: "Project", slug: "project", icon: FolderOpen },
  { label: "Templates", slug: "templates", icon: LayoutTemplate },
  { label: "Library", slug: "library", icon: Library },
  { label: "Tags", slug: "tags", icon: Tag },
  { label: "Standards", slug: "standards", icon: Ruler },
  { label: "Validation", slug: "validation", icon: ShieldCheck },
  { label: "Export", slug: "export", icon: Upload },
  { label: "History", slug: "history", icon: History },
];

const FOOT: NavItem[] = [{ label: "Settings", slug: "settings", icon: Settings }];

function RailLink({
  item,
  href,
  active,
}: {
  item: NavItem;
  href: string;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring relative flex w-[3.75rem] flex-col items-center gap-1 rounded-md px-1 py-2 text-[10px] font-medium transition",
        active
          ? "bg-brand-500/12 text-brand-400"
          : "text-text-muted hover:bg-surface-hover hover:text-text-secondary",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-brand-400"
        />
      )}
      <Icon size={18} aria-hidden strokeWidth={active ? 2.2 : 1.8} />
      {item.label}
    </Link>
  );
}

export function NavRail({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const root = `/project/${projectId}`;

  const hrefOf = (slug: string) => (slug ? `${root}/${slug}` : root);
  const isActive = (slug: string) =>
    slug ? pathname.startsWith(`${root}/${slug}`) : pathname === root;

  return (
    <nav
      aria-label="Sections"
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line-subtle bg-surface-panel py-3"
    >
      {MAIN.map((item) => (
        <RailLink
          key={item.slug || "workspace"}
          item={item}
          href={hrefOf(item.slug)}
          active={isActive(item.slug)}
        />
      ))}

      <div className="min-h-4 flex-1" />

      {FOOT.map((item) => (
        <RailLink
          key={item.slug}
          item={item}
          href={hrefOf(item.slug)}
          active={isActive(item.slug)}
        />
      ))}
    </nav>
  );
}
