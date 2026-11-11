import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SignInPrompt } from "@/components/shell/SignInPrompt";
import { THEME_BOOTSTRAP, ThemeGuard } from "@/components/shell/theme";
import "./globals.css";

/*
 * IBM Plex, drawn for engineering software: real tabular figures, a mono that
 * sits beside the sans without a jump, and nothing like the Inter or Segoe UI
 * every other tool wears. next/font self-hosts the files at build time, so no
 * request leaves the engineer's browser for a font.
 */
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "HMI Copilot",
  description: "From PLC tags to a ready-to-open EcoStruxure project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        {/* Sets data-theme before first paint so the chrome never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <ThemeGuard />
        <SignInPrompt />
        {children}
      </body>
    </html>
  );
}
