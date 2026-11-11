import type { ReactNode } from "react";
import { WaveLines } from "@/components/motion/WaveLines";
import { ArrowLeft } from "lucide-react";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

/**
 * The ground the account pages stand on: the same grid and light as the landing
 * and the sign-in pages, a way back to the product, and the page's own title.
 * The document scrolls (tests/page-scroll.test.ts), so the light is fixed and
 * the content is as tall as it needs to be.
 */
export function AccountFrame({ title, lead, tabs, children }: { title: string; lead?: ReactNode; tabs: "account" | "connections"; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-surface-base">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid mask-fade opacity-[0.35]" />
      <div aria-hidden className="copilot-aurora pointer-events-none fixed inset-0 overflow-hidden" />
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[55vh]"><WaveLines className="mask-fade" opacity={0.12} /></div>
      <div className="relative mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <header className="reveal is-in space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href="/" className="focus-ring inline-flex items-center gap-4 rounded-md">
              <SchneiderMark className="text-text-primary" />
              <span aria-hidden className="h-6 w-px bg-line" />
              <span className="text-lg font-semibold tracking-tight text-text-primary">HMI Copilot</span>
            </a>
            <a href="/" className="focus-ring inline-flex items-center gap-1 rounded-md text-xs text-text-muted transition hover:text-text-primary">
              <ArrowLeft size={12} aria-hidden /> Back to HMI Copilot
            </a>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
            {lead && <p className="text-sm text-text-secondary">{lead}</p>}
          </div>
          <nav aria-label="Account" className="flex gap-1 border-b border-line-subtle text-sm">
            {([["account", "/account", "Account"], ["connections", "/account/connections", "Connections"]] as const).map(([key, href, label]) => (
              <a
                key={key}
                href={href}
                aria-current={tabs === key ? "page" : undefined}
                className={`focus-ring -mb-px rounded-t-md border-b-2 px-3 py-2 transition ${tabs === key ? "border-brand-400 font-semibold text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"}`}
              >
                {label}
              </a>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}
