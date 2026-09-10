"use client";

/**
 * The left rail. Icons only, and fewer of them.
 *
 * It carried nine destinations plus Settings, each with a label under its icon,
 * in 4.5rem of width - on every route, at equal weight. Two problems with that.
 * The obvious one is that ten equally-weighted items communicate no structure:
 * the workspace is where the work happens and Settings is not, and the rail
 * said they were the same kind of thing.
 *
 * The other is that three of them had stopped being destinations. Library and
 * Tags are tabs in the inspector now, beside the canvas they act on, and
 * Templates is a way of putting objects on a screen rather than a place to go.
 * A rail entry for a panel that is already open is a second door to one room.
 *
 * What is left is the six things that are genuinely elsewhere, with the
 * workspace lifted out as the way home. Labels appear on hover instead of
 * taking permanent width, which is the pattern every tool with a rail uses.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  History,
  LayoutGrid,
  Ruler,
  Settings,
  ShieldCheck,
  Tag,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

interface NavItem {
  label: string;
  /** Appended to /project/<id>. Empty string is the workspace itself. */
  slug: string;
  icon: LucideIcon;
  /** A live count, when the destination has one worth knowing before you go. */
  count?: (s: ReturnType<typeof useProject.getState>) => number;
  /** Red rather than neutral: this count is a problem, not an inventory. */
  alarming?: boolean;
}

/** Home. Lifted out of the list because it is not one destination among many. */
const HOME: NavItem = { label: "Workspace", slug: "", icon: LayoutGrid };

const MAIN: NavItem[] = [
  { label: "Tags", slug: "tags", icon: Tag, count: (s) => s.variables.length },
  { label: "Standards", slug: "standards", icon: Ruler },
  {
    label: "Validation",
    slug: "validation",
    icon: ShieldCheck,
    count: (s) => s.findings.filter((f) => f.severity === "error").length,
    alarming: true,
  },
  { label: "Export", slug: "export", icon: Upload },
  { label: "History", slug: "history", icon: History, count: (s) => s.versions.length },
];

const FOOT: NavItem[] = [
  { label: "Projects", slug: "project", icon: FolderOpen },
  { label: "Settings", slug: "settings", icon: Settings },
];

function RailLink({
  item,
  href,
  active,
  count,
}: {
  item: NavItem;
  href: string;
  active: boolean;
  count?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "focus-ring group relative flex h-10 w-10 items-center justify-center rounded-lg transition",
        active
          ? "bg-brand-500/12 text-brand-400"
          : "text-text-muted hover:bg-surface-hover hover:text-text-secondary",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-brand-400"
        />
      )}
      <Icon size={17} aria-hidden strokeWidth={active ? 2.1 : 1.7} />

      {count !== undefined && count > 0 && (
        <span
          aria-hidden
          className={cn(
            "text-figure absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-[9px] font-semibold leading-4",
            item.alarming
              ? "bg-status-alarm text-white"
              : "bg-surface-active text-text-secondary",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}

      {/* The label, on hover, rather than as permanent width. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md border border-line bg-surface-float px-2 py-1 text-xs text-text-primary opacity-0 transition group-hover:opacity-100"
        style={{ boxShadow: "var(--elev-2)" }}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function NavRail({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const state = useProject();
  const root = `/project/${projectId}`;

  const hrefOf = (slug: string) => (slug ? `${root}/${slug}` : root);
  const isActive = (slug: string) =>
    slug ? pathname.startsWith(`${root}/${slug}`) : pathname === root;

  const render = (item: NavItem) => (
    <RailLink
      key={item.slug || "workspace"}
      item={item}
      href={hrefOf(item.slug)}
      active={isActive(item.slug)}
      count={item.count?.(state)}
    />
  );

  return (
    <nav
      aria-label="Sections"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line-subtle bg-surface-frame py-2"
    >
      {render(HOME)}
      <span aria-hidden className="my-1 h-px w-6 bg-line-subtle" />
      {MAIN.map(render)}

      <div className="min-h-4 flex-1" />

      {FOOT.map(render)}
    </nav>
  );
}
