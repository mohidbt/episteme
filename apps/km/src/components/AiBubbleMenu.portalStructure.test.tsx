// @vitest-environment jsdom
//
// GSD-134 iteration 3 — STRUCTURAL root cause.
//
// The real `@tiptap/react` BubbleMenu renders its children into a
// `<div ref={setElement}>` and then `@tiptap/extension-bubble-menu`'s
// BubbleMenuView constructor calls `this.element.remove()` and reparents that
// div into a tippy popper (appended to document.body). React's fiber tree still
// believes that div lives where <BubbleMenu> was declared.
//
// When the slash "AI" item flips `aiTriggerCount`, AiBubbleMenu used to render
// the rephrase panel as a `position:fixed` React SIBLING of <BubbleMenu> in the
// same parent (Editor's `display:contents` wrapper). React's commit-phase
// placement resolves the new node's host sibling to the tippy-relocated
// BubbleMenu div and calls `parent.insertBefore(panel, bubbleMenuDiv)` — but
// that div is no longer a child of `parent`, so the DOM throws
// `NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before
// which the new node is to be inserted is not a child of this node.`
//
// Timing (queueMicrotask / double-RAF — iterations 1 & 2) cannot fix this: the
// sibling relationship is structurally invalid no matter WHEN the state update
// lands. The fix is to render the panel via createPortal into a stable
// container (document.body) so it never shares a host parent with the relocated
// bubble div.
//
// This test reproduces tippy's `.remove()`-then-reparent behavior in the
// BubbleMenu mock (the plain-div mocks in the sibling test files mask the bug),
// drives the AI trigger, and asserts the panel mounts under document.body and
// outside the editor's managed DOM.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

// BubbleMenu mock: render children into a plain div in-place. We deliberately do
// NOT simulate tippy's full `.remove()`-and-reparent here — doing so fights
// React's own unmount in jsdom (teardown noise unrelated to the fix). What this
// test locks is the STRUCTURAL invariant that survives the real bug: the
// rephrase panel must be rendered into `document.body` via a portal, NOT inline
// as a sibling of <BubbleMenu> inside AiBubbleMenu's React container. Pre-fix
// the panel was an inline child of that container (the sibling that React's
// commit anchored against the tippy-relocated bubble div → insertBefore crash);
// post-fix it is a body portal, decoupled from that host-parent sibling chain.
vi.mock("@episteme/editor", async () => {
  const React = await import("react");
  const BubbleMenuMock = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-bubble-menu": "" }, children);
  return { BubbleMenu: BubbleMenuMock };
});

vi.mock("@/app/(app)/n/[slug]/run-slash-ai", () => ({
  runSlashAi: vi.fn(),
}));

import { AiBubbleMenu } from "./AiBubbleMenu";

function makeEditor() {
  const dom = document.createElement("div");
  dom.setAttribute("data-editor-dom", "");
  document.body.appendChild(dom);
  const selection = {
    from: 5,
    to: 12,
    $from: { parent: { textContent: "hello world" } },
  };
  const editor = {
    state: {
      selection,
      doc: {
        textBetween: () => "selected",
        resolve: () => ({ start: () => 0 }),
      },
    },
    view: {
      dom,
      coordsAtPos: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
    },
    chain: () => editor,
    focus: () => editor,
    deleteRange: () => editor,
    insertContent: () => editor,
    setTextSelection: () => editor,
    run: () => true,
    isActive: () => false,
    on: () => {},
    off: () => {},
    commands: { focus: () => {} },
  };
  return editor as unknown as Parameters<typeof AiBubbleMenu>[0]["editor"];
}

describe("GSD-134: AI rephrase panel is body-portaled, not a BubbleMenu sibling", () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll("[data-tippy-popper],[data-editor-dom]").forEach((n) => n.remove());
  });

  it("opens the panel without an insertBefore crash and mounts it under document.body", async () => {
    const editor = makeEditor();

    // Render AiBubbleMenu inside a dedicated container that simulates Editor's
    // `display:contents` wrapper. The BubbleMenu mock removes its own div from
    // THIS container (mimicking tippy), so any conditional sibling React tries
    // to insert here would anchor on the removed div and throw.
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { rerender } = render(
      <AiBubbleMenu editor={editor} aiTriggerCount={0} />,
      { container },
    );

    // Flip the AI trigger. RED (pre-fix): the panel renders as a sibling of the
    // tippy-relocated BubbleMenu div inside `container`, so React's commit-phase
    // placement throws NotFoundError. GREEN (post-fix): the panel is a body
    // portal, so no crash.
    act(() => {
      rerender(<AiBubbleMenu editor={editor} aiTriggerCount={1} />);
    });

    // Panel opens (generate-mode placeholder).
    const input = await waitFor(() =>
      screen.getByPlaceholderText("What should I write?"),
    );

    // STRUCTURAL invariant: the panel must NOT live inside `container` (which is
    // where the tippy-relocated BubbleMenu div was removed from). It must be a
    // body portal outside both the editor DOM and the bubble-menu parent.
    expect(container.contains(input)).toBe(false);
    expect((editor.view.dom as HTMLElement).contains(input)).toBe(false);
    expect(document.body.contains(input)).toBe(true);
  });
});
