"use client";

/**
 * Light / dark for the APPLICATION CHROME only.
 *
 * The HMI screen on the canvas is not themed here and must never be: its
 * colours are palette indices resolved through lib/ote/palette.ts against the
 * project's own colour set. Flipping this toggle and watching the generated
 * screen stay exactly as it will look in the product is the demonstration that
 * the preview cannot lie about the output.
 *
 * next-themes would do this, but package.json is frozen (docs/WORKSTREAMS.md)
 * and the whole mechanism is one attribute on <html>.
 */

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "hmi-copilot-theme";

/**
 * Runs before first paint, so the chrome never flashes dark then light.
 * Kept in sync with useTheme below by hand - it cannot import anything.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(!t)t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export function useTheme() {
  // Starts undefined so the first render matches whatever the bootstrap script
  // already put on <html>; the effect then adopts it.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") setThemeState(current);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // private mode: the theme just does not persist
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(
    () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"),
    [setTheme],
  );

  return { theme, setTheme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "light" ? "dark" : "light";

  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      onClick={toggle}
      title={`Switch to ${next} chrome`}
      aria-label={`Switch to ${next} chrome`}
      icon={theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    />
  );
}
