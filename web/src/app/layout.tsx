import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HMI Copilot",
  description: "From PLC tags to a ready-to-open EcoStruxure project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
