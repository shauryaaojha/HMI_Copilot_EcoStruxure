import type { Metadata } from "next";
import { THEME_BOOTSTRAP } from "@/components/shell/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "HMI Copilot",
  description: "From PLC tags to a ready-to-open EcoStruxure project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint so the chrome never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
