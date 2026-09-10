"use client";

/**
 * The screen's own Screen.dat, as it will be written into the .eote.
 *
 * Not a debug view. The claim this product makes is that the canvas and the
 * export are the same object tree, and the fastest way for an engineer to check
 * that claim is to look at the tree - so it is a tab, with a copy button, and
 * the selected object is highlighted where it sits in the file.
 */

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Screen } from "@/lib/ote/schema";
import { useProject } from "@/store/project";
import { Button } from "@/components/ui";

export function ScreenJson({ screen }: { screen: Screen }) {
  const selectedIds = useProject((s) => s.selectedIds);
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => JSON.stringify(screen, null, 2), [screen]);
  const selected = new Set(selectedIds);

  // Highlighting by id rather than by parsing: every object's UniqueId appears
  // on its own line, so the line that carries one belongs to that object.
  const lines = useMemo(() => text.split("\n"), [text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission refused; the text is on screen either way.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 py-2">
        <p className="text-xs text-text-muted">
          {`Screens\\<guid>\\Screen.dat`} — {lines.length} lines,{" "}
          {screen.Children[0].Children.length} objects
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={copy}
          icon={copied ? <Check size={13} /> : <Copy size={13} />}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
        {lines.map((line, i) => {
          const hit = [...selected].some((id) => line.includes(id));
          return (
            <div
              key={i}
              className={hit ? "-mx-1 rounded bg-brand-500/15 px-1 text-text-primary" : undefined}
            >
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
