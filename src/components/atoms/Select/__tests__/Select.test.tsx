// Direct react-dom rendering, no testing-library dep — keeps the project's
// "no new runtime deps" rule honest while still exercising opening,
// keyboard nav, selection, click-outside-close, and disabled state.

// Required so React's act() warnings don't clobber our test output.
// Must be set BEFORE importing react-dom.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Select, { type SelectOption } from "@/components/atoms/Select";

const OPTIONS: SelectOption[] = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry" },
];

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

function trigger(): HTMLButtonElement {
  const t = container.querySelector("[role='combobox']") as HTMLButtonElement | null;
  if (!t) throw new Error("trigger not in DOM");
  return t;
}

function listbox(): HTMLUListElement | null {
  return container.querySelector("[role='listbox']") as HTMLUListElement | null;
}

function options(): HTMLLIElement[] {
  return Array.from(container.querySelectorAll("[role='option']")) as HTMLLIElement[];
}

function fire(el: Element, type: string, init?: KeyboardEventInit | MouseEventInit) {
  const event =
    type === "keydown"
      ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
      : new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(event);
  });
}

function press(key: string) {
  fire(trigger(), "keydown", { key, bubbles: true } as KeyboardEventInit);
}

describe("Select atom", () => {
  it("opens on click and closes again", () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} />);
    expect(listbox()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    act(() => trigger().click());
    expect(listbox()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(options()).toHaveLength(3);

    act(() => trigger().click());
    expect(listbox()).toBeNull();
  });

  it("opens with ArrowDown when closed and lands on the first option", () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} />);
    press("ArrowDown");
    expect(listbox()).not.toBeNull();
    // first option should be the active descendant
    const ad = trigger().getAttribute("aria-activedescendant");
    expect(ad).toBeTruthy();
    expect(ad).toMatch(/-opt-0$/);
  });

  it("ArrowDown / ArrowUp move the highlighted option", () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} />);
    // open first — defaults active to current selection (idx 0)
    press("ArrowDown"); // open + active 0
    // when already open, ArrowDown advances
    press("ArrowDown"); // active 1
    expect(trigger().getAttribute("aria-activedescendant")).toMatch(/-opt-1$/);
    press("ArrowDown"); // active 2
    expect(trigger().getAttribute("aria-activedescendant")).toMatch(/-opt-2$/);
    press("ArrowUp"); // back to 1
    expect(trigger().getAttribute("aria-activedescendant")).toMatch(/-opt-1$/);
  });

  it("Enter selects the active option, fires onChange, and closes", () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} />);
    press("ArrowDown"); // open at idx 0
    press("ArrowDown"); // idx 1 (Banana)
    press("Enter");
    expect(onChange).toHaveBeenCalledWith("b");
    expect(listbox()).toBeNull();
  });

  it("Escape closes without selecting", () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} />);
    press("ArrowDown");
    expect(listbox()).not.toBeNull();
    press("Escape");
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking an option fires onChange and closes", () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} />);
    act(() => trigger().click());
    const items = options();
    expect(items).toHaveLength(3);
    // Use mousedown — that's what the component listens for to beat focus loss.
    fire(items[2], "mousedown", { button: 0 });
    expect(onChange).toHaveBeenCalledWith("c");
    expect(listbox()).toBeNull();
  });

  it("a click outside the trigger and listbox closes the popover", () => {
    render(<Select value="" options={OPTIONS} onChange={vi.fn()} />);
    act(() => trigger().click());
    expect(listbox()).not.toBeNull();
    // Pointerdown on the body somewhere outside the component.
    // jsdom doesn't ship a PointerEvent global, so dispatch a plain Event
    // with the same name — the component's handler reads only target+type.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(listbox()).toBeNull();
    outside.remove();
  });

  it("disabled state rejects opening via click and keyboard", () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} disabled />);
    expect(trigger().disabled).toBe(true);
    act(() => trigger().click());
    expect(listbox()).toBeNull();
    press("ArrowDown");
    expect(listbox()).toBeNull();
  });
});
