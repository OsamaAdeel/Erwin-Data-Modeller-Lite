import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "erwin.theme";

/**
 * Resolve the initial theme on first paint:
 *   1. honour an explicit user choice from localStorage
 *   2. otherwise follow the OS-level prefers-color-scheme
 *   3. fall back to light if neither is available (SSR, locked-down storage)
 */
function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage may be disabled (private mode, locked-down browser); ignore.
  }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function applyToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Keep the <html data-theme> attribute and localStorage in sync. Also runs
  // on first mount so SSR/initial render never has the wrong attribute.
  useEffect(() => {
    applyToDocument(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore — we still applied to <html> for the current session
    }
  }, [theme]);

  // Honour live system-theme changes only when the user hasn't picked one.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const stored = (() => {
      try {
        return window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    if (stored === "light" || stored === "dark") return; // user has overridden
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setThemeState(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return { theme, setTheme, toggle };
}
