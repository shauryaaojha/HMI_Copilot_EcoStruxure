"use client";

/**
 * Project History - reference screen 10.
 *
 * Real versions, not a changelog: each row is a full snapshot of the screens,
 * variables, alarms and bindings taken when something notable happened, so
 * restoring one puts the project back exactly. Snapshots are taken after a
 * generation finishes, after a tag import, and when a template is placed.
 *
 * Phase 9 of docs/BUILD_PLAN.md.
 */

import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { useProject } from "@/store/project";
import { Badge, Button } from "@/components/ui";

function stamp(at: number) {
  return new Date(at).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function HistoryScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const versions = useProject((s) => s.versions);
  const restore = useProject((s) => s.restore);
  const snapshot = useProject((s) => s.snapshot);
  const log = useProject((s) => s.log);
  const screens = useProject((s) => s.screens);

  function goBackTo(at: number, description: string) {
    // Snapshot the present first, so restoring is not a one-way door.
    snapshot("Before restore");
    restore(at);
    log(`Restored version: ${description}`);
    router.push(`/project/${projectId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-text-muted">
          {versions.length === 0
            ? "No versions yet."
            : `${versions.length} ${versions.length === 1 ? "version" : "versions"}, newest first.`}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={screens.length === 0}
          onClick={() => snapshot("Manual checkpoint")}
          icon={<History size={14} />}
        >
          Save a checkpoint
        </Button>
      </div>

      {versions.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line p-10 text-center text-sm text-text-muted">
          Versions are recorded when a generation finishes, when tags are imported and
          when a template is placed. Generate a screen and one will appear here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line-subtle">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-raised text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Version</th>
                <th scope="col" className="px-4 py-2 font-medium">Date</th>
                <th scope="col" className="px-4 py-2 font-medium">Description</th>
                <th scope="col" className="px-4 py-2 font-medium">Contents</th>
                <th scope="col" className="px-4 py-2 font-medium">Author</th>
                <th scope="col" className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {versions.map((version, i) => {
                const objects = version.screens.reduce(
                  (n, s) => n + s.Children[0].Children.length,
                  0,
                );
                return (
                  <tr key={version.at} className="border-t border-line-subtle">
                    <td className="px-4 py-2 font-mono text-xs">
                      v{versions.length - i}
                      {i === 0 && (
                        <Badge tone="brand" className="ml-2">
                          current
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-text-muted">
                      {stamp(version.at)}
                    </td>
                    <td className="px-4 py-2">{version.description}</td>
                    <td className="px-4 py-2 text-xs tabular-nums text-text-muted">
                      {objects} objects · {version.variables.length} tags ·{" "}
                      {version.bindings.length} bindings
                    </td>
                    <td className="px-4 py-2 text-text-muted">{version.author}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => goBackTo(version.at, version.description)}
                        icon={<RotateCcw size={13} />}
                      >
                        Restore
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-text-faint">
        Restoring takes a checkpoint of the present first, so it is never a one-way
        door. Versions live in this session; export the .eote for anything permanent.
      </p>
    </div>
  );
}
