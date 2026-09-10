"use client";

/**
 * Import PLC Tags - reference screen 3.
 *
 * Drop zone and imported-file card on the left, the Tag Summary panel on the
 * right, the parsed tags underneath. Everything on this page is driven by a
 * real round trip through /api/tags/parse; nothing here is illustrative.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useProject } from "@/store/project";
import { Panel } from "@/components/ui";
import { PageShell } from "@/components/shell/PageShell";
import { TagImport } from "./TagImport";
import { TagSummary } from "./TagSummary";
import { TagTable } from "./TagTable";

export function TagsScreen({ projectId }: { projectId: string }) {
  const variables = useProject((s) => s.variables);

  return (
    <PageShell
      projectId={projectId}
      title="Import PLC Tags"
      description="Import tags from your PLC export file."
      actions={
        variables.length > 0 && (
          // Generation is driven from the workspace, because that is where the
          // screen appears object by object as it is built.
          <Link
            href={`/project/${projectId}`}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-brand-500 px-3.5 text-sm font-medium text-text-onbrand shadow-sm transition hover:bg-brand-600"
          >
            Generate a screen
            <ArrowRight size={16} aria-hidden />
          </Link>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-6">
        <div className="grid shrink-0 gap-6 lg:grid-cols-[1fr_20rem]">
          <TagImport />
          <TagSummary />
        </div>

        <Panel
          title="Parsed tags"
          actions={
            <span className="text-xs tabular-nums text-text-muted">
              {variables.length.toLocaleString()}
            </span>
          }
          bordered
          className="min-h-0 flex-1"
          bodyClassName="flex min-h-0 flex-1 flex-col px-3 pb-3"
        >
          <TagTable variables={variables} className="min-h-0 flex-1" />
        </Panel>
      </div>
    </PageShell>
  );
}
