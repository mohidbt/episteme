// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { shouldShowTableMenu, TableBubbleMenu } from "./TableBubbleMenu";
import type { TiptapEditor } from "@episteme/editor";

describe("shouldShowTableMenu (Notion-style state machine)", () => {
  it("hides when no signal is active", () => {
    expect(
      shouldShowTableMenu({
        selectionInTable: false,
        pointerOnTable: false,
        pointerOnMenu: false,
      }),
    ).toBe(false);
  });

  it("shows when caret/selection is inside a table", () => {
    expect(
      shouldShowTableMenu({
        selectionInTable: true,
        pointerOnTable: false,
        pointerOnMenu: false,
      }),
    ).toBe(true);
  });

  it("shows when pointer is hovering the table", () => {
    expect(
      shouldShowTableMenu({
        selectionInTable: false,
        pointerOnTable: true,
        pointerOnMenu: false,
      }),
    ).toBe(true);
  });

  it("shows when pointer is over the menu itself (gap-bridging)", () => {
    expect(
      shouldShowTableMenu({
        selectionInTable: false,
        pointerOnTable: false,
        pointerOnMenu: true,
      }),
    ).toBe(true);
  });

  it("stays visible when user moves from table onto the menu", () => {
    // Pointer leaves table, but enters menu in the same frame.
    expect(
      shouldShowTableMenu({
        selectionInTable: false,
        pointerOnTable: false,
        pointerOnMenu: true,
      }),
    ).toBe(true);
  });

  it("stays visible while clicking a menu button (selection still in table)", () => {
    // Even if pointerOnMenu briefly flickers, selectionInTable keeps it open.
    expect(
      shouldShowTableMenu({
        selectionInTable: true,
        pointerOnTable: false,
        pointerOnMenu: false,
      }),
    ).toBe(true);
  });
});

describe("TableBubbleMenu rendering — mousedown.preventDefault wiring", () => {
  afterEach(() => {
    cleanup();
  });

  function makeStubEditor(): TiptapEditor {
    // Build a real DOM with a <table> so closest("table") resolves.
    const editorDom = document.createElement("div");
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.textContent = "cell";
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    editorDom.appendChild(table);
    document.body.appendChild(editorDom);

    const handlers = new Map<string, Set<() => void>>();
    const chain = {
      focus: () => chain,
      addRowBefore: () => chain,
      addRowAfter: () => chain,
      addColumnBefore: () => chain,
      addColumnAfter: () => chain,
      deleteRow: () => chain,
      deleteColumn: () => chain,
      deleteTable: () => chain,
      run: vi.fn(() => true),
    };

    return {
      isActive: (name: string) => name === "table",
      state: { selection: { from: 0 } },
      view: {
        dom: editorDom,
        domAtPos: () => ({ node: td, offset: 0 }),
      },
      chain: () => chain,
      on: (event: string, cb: () => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(cb);
      },
      off: (event: string, cb: () => void) => {
        handlers.get(event)?.delete(cb);
      },
    } as unknown as TiptapEditor;
  }

  it("preventDefaults mousedown on a menu button (preserves selection)", () => {
    const editor = makeStubEditor();
    render(<TableBubbleMenu editor={editor} />);

    const addRowBtn = screen.getByTitle("Add row above");
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    fireEvent(addRowBtn, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("preventDefaults mousedown on the menu container", () => {
    const editor = makeStubEditor();
    render(<TableBubbleMenu editor={editor} />);

    const container = screen.getByTestId("table-bubble-menu");
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    fireEvent(container, event);

    expect(event.defaultPrevented).toBe(true);
  });
});
