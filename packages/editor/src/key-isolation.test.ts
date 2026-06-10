// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { shouldStopEditorKeyPropagation, attachEditorKeyIsolation } from "./key-isolation";

function makeEvent(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("shouldStopEditorKeyPropagation (GSD-84)", () => {
  it("stops plain alphanumeric keys so global hotkeys cannot hijack the editor", () => {
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "g" }))).toBe(true);
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "G" }))).toBe(true);
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "1" }))).toBe(true);
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: " " }))).toBe(true);
  });

  it("allows modifier combos to propagate so app shortcuts keep working", () => {
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "s", metaKey: true }))).toBe(false);
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "t", ctrlKey: true }))).toBe(false);
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "k", altKey: true }))).toBe(false);
  });

  it("allows Escape / Tab to propagate (used by global panels and focus traversal)", () => {
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "Escape" }))).toBe(false);
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "Tab" }))).toBe(false);
  });

  it("allows Shift+letter (still typing) — Shift is not a modifier hotkey trigger", () => {
    // Capital G is just typing; we stop it so a global 'G' hotkey can't fire.
    expect(shouldStopEditorKeyPropagation(makeEvent({ key: "G", shiftKey: true }))).toBe(true);
  });
});

describe("attachEditorKeyIsolation (GSD-84)", () => {
  it("blocks a window-level keydown when triggered from inside the wrapped element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const detach = attachEditorKeyIsolation(host);
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(windowListener).not.toHaveBeenCalled();

    // Modifier combo passes through.
    host.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
    );
    expect(windowListener).toHaveBeenCalledTimes(1);

    window.removeEventListener("keydown", windowListener);
    detach();
    document.body.removeChild(host);
  });
});
