// HotkeysModal + useGlobalHelpHotkey integration. Verifies the three
// pieces the prompt explicitly calls out:
//   1. Pressing "?" opens the modal.
//   2. Pressing Esc inside the modal closes it.
//   3. Pressing "?" while a textarea is focused does NOT open it.

// React's act() environment opt-in must be set BEFORE react-dom imports.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import HotkeysModal, { useGlobalHelpHotkey } from "@/components/molecules/HotkeysModal";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function dialog(): HTMLElement | null {
  return document.body.querySelector("[role='dialog']") as HTMLElement | null;
}

function dispatchKey(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
  });
}

// Test fixture that wires the global "?" listener to a HotkeysModal so
// the integration matches what App.tsx does in production.
function HelpHost({ withTextarea = false }: { withTextarea?: boolean }) {
  const [open, setOpen] = useState(false);
  useGlobalHelpHotkey(() => setOpen(true));
  return (
    <>
      {withTextarea && <textarea data-testid="ta" />}
      <HotkeysModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("HotkeysModal + useGlobalHelpHotkey", () => {
  it("opens when '?' is pressed at the document level", () => {
    render(<HelpHost />);
    expect(dialog()).toBeNull();
    dispatchKey(document.body, "?");
    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
  });

  it("closes when Esc is pressed inside the dialog", () => {
    render(<HelpHost />);
    dispatchKey(document.body, "?");
    const d = dialog();
    expect(d).not.toBeNull();
    dispatchKey(d!, "Escape");
    expect(dialog()).toBeNull();
  });

  it("does NOT open when '?' is pressed while a textarea is focused", () => {
    render(<HelpHost withTextarea />);
    const ta = container.querySelector("textarea");
    expect(ta).not.toBeNull();
    act(() => (ta as HTMLTextAreaElement).focus());
    expect(document.activeElement).toBe(ta);
    dispatchKey(ta!, "?");
    expect(dialog()).toBeNull();
  });
});
