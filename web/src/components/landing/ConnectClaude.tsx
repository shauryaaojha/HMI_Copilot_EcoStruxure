"use client";

/**
 * How to work on a project from Claude: the connector's address and the steps
 * it takes, on the front page, because nobody found it in account settings.
 *
 * The address is this deployment's own, read from the page's origin, so a
 * laptop install and the hosted one each show the address that works for them.
 */

import { useEffect, useState } from "react";
import { Check, Copy, Eye, FilePlus2, ListChecks, MousePointerClick, Tags, Wand2 } from "lucide-react";

const CAN = [
  { icon: FilePlus2, text: "Start a project for a new machine, with its panel and tag list" },
  { icon: Wand2, text: "Lay out screens from a plant brief or your tags, and edit them object by object" },
  { icon: MousePointerClick, text: "Make buttons that change screen or write a bit, rounded shapes, see-through fills" },
  { icon: Tags, text: "Add, rename and delete tags one at a time, or import a whole export" },
  { icon: Eye, text: "Draw any screen as a live picture in the chat, at tag values you choose" },
  { icon: ListChecks, text: "Run the design checks, and see what is waiting for you to accept" },
];

const STEPS = [
  { title: "Sign in here", note: "The connector works on the projects saved to your account, so you need one." },
  { title: "Add a custom connector in Claude", note: "Settings, then Connectors, then Add custom connector. Paste the address below." },
  { title: "Approve it", note: "Claude sends you back here to sign in and say yes. You can remove it later on your account's Connections page." },
  { title: "Ask", note: "\"Make a coffee machine project with an overview and a settings screen.\" Each change waits for you to accept, unless you tell Claude to turn direct writes on." },
];

export function ConnectClaude() {
  const [address, setAddress] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setAddress(`${window.location.origin}/api/mcp`), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // The address is on screen and can be selected by hand.
    }
  }

  return (
    <section id="connect" aria-labelledby="connect-title" className="mx-auto max-w-6xl scroll-mt-8 px-8 py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <div>
          <p className="label-eyebrow text-brand-400">Connector</p>
          <h2 id="connect-title" className="mt-3 text-3xl font-semibold tracking-tight">Work on your screens from Claude.</h2>
          <p className="mt-4 text-sm leading-relaxed text-text-muted">
            HMI Copilot is also a connector for Claude. Add it once, and Claude can open your projects, build and change screens with the same tools this
            app uses, and show you the result in the conversation. The work lands in the project you see here.
          </p>
          <ul className="mt-6 space-y-3">
            {CAN.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm text-text-secondary">
                <Icon size={15} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-line-subtle bg-surface-raised/70 p-6">
          <ol className="space-y-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-500/50 font-mono text-xs text-brand-400">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-text-muted">{step.note}</p>
                  {i === 1 && (
                    <div className="mt-3 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-base px-3 py-2 font-mono text-xs text-text-primary" aria-label="Connector address">
                        {address || "https://…/api/mcp"}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copy()}
                        disabled={!address}
                        className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-medium text-text-secondary transition hover:border-line-strong hover:text-text-primary disabled:opacity-50"
                      >
                        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 border-t border-line-subtle pt-4 text-xs leading-relaxed text-text-faint">
            Works with Claude on the web, the desktop app and Claude Code. The connector can do what you can do on a project and no more. It cannot open or
            simulate a project in Operator Terminal Expert; that proof stays with you.
          </p>
        </div>
      </div>
    </section>
  );
}
