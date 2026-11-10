import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ProjectsScreen } from "@/components/projects/ProjectsScreen";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

export const metadata: Metadata = { title: "Your projects · HMI Copilot" };

/**
 * Every project this person has, reachable without being inside one.
 *
 * The same list used to exist only at /project/<id>/project, so the only way
 * to a project saved yesterday, or one Claude made through the connector, was
 * to start a new empty project first and find the list from inside it. The
 * landing page links here.
 */
export default function ProjectsPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-surface-base">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid mask-fade opacity-[0.35]" />
      <div aria-hidden className="copilot-aurora pointer-events-none fixed inset-0 overflow-hidden" />
      <div className="relative mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="space-y-6">
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
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Your projects</h1>
            <p className="text-sm text-text-secondary">Open one you have been working on, or start a new one. Signed in, the projects saved on the server are here too, including any Claude made through the connector.</p>
          </div>
        </header>
        <ProjectsScreen />
      </div>
    </div>
  );
}
