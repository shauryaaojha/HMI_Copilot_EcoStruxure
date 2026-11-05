import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Cloud, Sparkles, Users } from "lucide-react";
import { CursorLight } from "@/components/landing/CursorLight";
import { ScreenFigure } from "@/components/landing/ScreenBuild";
import { currentUser, providers } from "@/lib/server/session";
import { SignInForm } from "./SignInForm";
import { SchneiderMark } from "./SchneiderMark";

const HEADLINE = "From PLC tags to a ready-to-open EcoStruxure project.";

/** What an account opens up. Each is something the signed-out product refuses. */
const WITH_AN_ACCOUNT = [
  { icon: Sparkles, title: "The Copilot", note: "Generates and edits your screens" },
  { icon: Cloud, title: "Saved on the server", note: "Open your projects on any machine" },
  { icon: Users, title: "Shared projects", note: "Invite people and edit together" },
];

/**
 * /signin and /signup: the product on one side, the form on the other, starting
 * on the tab the address names. A link from elsewhere comes back to `next`
 * afterwards. On a phone the form stands alone on the same ground.
 */
export async function AuthPage({ mode, next }: { mode: "in" | "up"; next: string | undefined }) {
  const target = safeNext(next);
  // Already signed in: the only reason to be here is to get somewhere else.
  if (await currentUser()) redirect(target);
  return (
    <div className="relative h-full overflow-x-hidden overflow-y-auto bg-surface-base">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid mask-fade opacity-[0.35]" />
      <div aria-hidden className="copilot-aurora vivid pointer-events-none fixed inset-0 overflow-hidden" />
      <CursorLight />

      {/* This much markup reaches the browser in more than one piece. Without a boundary,
          React starting before the last piece arrives fails the whole page's hydration.
          It sits after the redirect above, which needs to still be a real HTTP redirect. */}
      <Suspense>
      <div className="relative mx-auto grid min-h-full w-full max-w-6xl items-center gap-12 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,4fr)] lg:gap-16">
        <section className="reveal is-in hidden min-w-0 lg:block">
          <a href="/" className="focus-ring inline-flex items-center gap-4 rounded-md">
            <SchneiderMark className="text-text-primary" />
            <span aria-hidden className="h-6 w-px bg-line" />
            <span className="text-lg font-semibold tracking-tight text-text-primary">HMI Copilot</span>
          </a>
          <h2 className="word-in mt-8 text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-text-primary">
            {HEADLINE.split(" ").map((word, i) => (
              <span key={i} style={{ ["--i" as string]: i }} className="mr-[0.22em]">
                {word}
              </span>
            ))}
          </h2>
          <div className="reveal is-in mt-7" style={{ ["--reveal-delay" as string]: "200ms" }}>
            <ScreenFigure replayEveryMs={14_000} />
          </div>
          <ul className="mt-6 grid grid-cols-3 gap-3">
            {WITH_AN_ACCOUNT.map(({ icon: Icon, title, note }, i) => (
              <li
                key={title}
                className="reveal is-in rounded-lg border border-line-subtle bg-surface-raised/60 p-3"
                style={{ ["--reveal-delay" as string]: `${360 + i * 110}ms` }}
              >
                <Icon size={15} aria-hidden className="text-brand-400" />
                <p className="mt-2 text-xs font-semibold text-text-primary">{title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-text-muted">{note}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="relative mx-auto w-full max-w-sm min-w-0 lg:max-w-none">
          {/* The form is the one thing on this page to do, so the light gathers behind it. */}
          <div aria-hidden className="pointer-events-none absolute -inset-x-4 -inset-y-10 rounded-full lg:-inset-x-10 bg-brand-500/20 blur-3xl" />
          <div
            className="beam-border reveal is-in relative space-y-4 rounded-2xl border border-line bg-surface-float/95 p-6 sm:p-7"
            style={{ boxShadow: "var(--elev-2)", ["--reveal-delay" as string]: "120ms" }}
          >
            <SchneiderMark className="text-brand-400 lg:hidden" />
            {providers().length ? (
              <SignInForm next={target} initialMode={mode} heading="h1" />
            ) : (
              <>
                <h1 className="text-base font-semibold text-text-primary">{mode === "in" ? "Sign in" : "Sign up"}</h1>
                <p className="text-sm text-status-warn">Sign-in is not configured on this installation.</p>
              </>
            )}
            <a href="/" className="focus-ring inline-flex items-center gap-1 rounded-md text-xs text-text-muted transition hover:text-text-primary">
              <ArrowLeft size={12} aria-hidden /> Back to HMI Copilot
            </a>
          </div>
        </section>
      </div>
      </Suspense>
    </div>
  );
}

/**
 * Where to go afterwards, from a query parameter, which means from anyone who
 * can write a link. Only a path on this site is allowed - no scheme, no host,
 * and not `//elsewhere`, which a browser reads as a host - so a crafted link
 * cannot turn our sign-in page into a step on the way to someone else's.
 */
function safeNext(value: string | undefined): string {
  // A browser reads "\" as "/" and drops tabs and newlines, so "/\evil" and
  // "/<tab>/evil" are "//evil" by the time it navigates.
  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : "/";
}
