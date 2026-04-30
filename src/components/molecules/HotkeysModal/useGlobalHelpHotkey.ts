import { useEffect } from "react";

/**
 * Listens for the global "?" key and calls `onOpen` — except when the
 * key was typed into an input, textarea, or contentEditable element.
 *
 * Lives next to the HotkeysModal so a single import wires both pieces:
 *
 *   const [open, setOpen] = useState(false);
 *   useGlobalHelpHotkey(() => setOpen(true));
 *   return <HotkeysModal open={open} onClose={() => setOpen(false)} />;
 *
 * Extracted so tests can mount the listener without copying the guard.
 */
export function useGlobalHelpHotkey(onOpen: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const target = e.target as Element | null;
      if (target instanceof HTMLInputElement) return;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
