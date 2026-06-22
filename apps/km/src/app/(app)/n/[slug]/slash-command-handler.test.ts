/**
 * GSD-134 — slash command dispatch contract.
 *
 * The AI slash crash (`NotFoundError: Failed to execute 'insertBefore' on
 * 'Node'`) was a STRUCTURAL React/Tiptap bug, NOT a timing race: the AI-rephrase
 * panel rendered as a React sibling of the tippy-relocated <BubbleMenu> div, so
 * React's commit-phase placement anchored the new panel on a node tippy had
 * already removed from the parent. The fix (iteration 3) body-portals the panel
 * (see AiBubbleMenu.tsx + AiBubbleMenu.portalStructure.test.tsx).
 *
 * With the panel decoupled from the bubble-menu host-parent chain, the AI
 * trigger fires synchronously — the earlier `queueMicrotask` (iteration 1) and
 * double-`requestAnimationFrame` (iteration 2) deferrals were band-aids that
 * never addressed the invalid sibling relationship and both still crashed on
 * preview. They have been removed.
 *
 * This test locks the post-fix contract: deleteRange runs first, then
 * onAiTrigger fires synchronously (no deferral).
 */
import { describe, it, expect, vi } from "vitest";
import { handleSlashCommand } from "./slash-command-handler";

type StubEditor = {
  chain: () => StubEditor;
  focus: () => StubEditor;
  deleteRange: (range: { from: number; to: number }) => StubEditor;
  insertTable: (args: {
    rows: number;
    cols: number;
    withHeaderRow: boolean;
  }) => StubEditor;
  toggleCodeBlock: (args: { language: string }) => StubEditor;
  run: () => boolean;
};

function makeEditor(): StubEditor {
  const editor: StubEditor = {
    chain: () => editor,
    focus: () => editor,
    deleteRange: () => editor,
    insertTable: () => editor,
    toggleCodeBlock: () => editor,
    run: () => true,
  };
  return editor;
}

type HandlerEditorArg = Parameters<typeof handleSlashCommand>[0]["editor"];

describe("handleSlashCommand — AI item", () => {
  it("deletes the slash trigger range", () => {
    const editor = makeEditor();
    const deleteRange = vi.spyOn(editor, "deleteRange");
    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 1, to: 2 },
        props: { title: "AI" },
      },
      { onAiTrigger: () => {} },
    );
    expect(deleteRange).toHaveBeenCalledWith({ from: 1, to: 2 });
  });

  it("fires onAiTrigger synchronously (no deferral — panel is body-portaled)", () => {
    const editor = makeEditor();
    const onAiTrigger = vi.fn();

    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 1, to: 2 },
        props: { title: "AI" },
      },
      { onAiTrigger },
    );

    expect(onAiTrigger).toHaveBeenCalledTimes(1);
  });

  it("deletes the range BEFORE firing the trigger", () => {
    const editor = makeEditor();
    const order: string[] = [];
    vi.spyOn(editor, "deleteRange").mockImplementation(() => {
      order.push("deleteRange");
      return editor;
    });

    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 1, to: 2 },
        props: { title: "AI" },
      },
      { onAiTrigger: () => order.push("onAiTrigger") },
    );

    expect(order).toEqual(["deleteRange", "onAiTrigger"]);
  });
});

describe("handleSlashCommand — non-AI items run synchronously", () => {
  it("Table inserts inline", () => {
    const editor = makeEditor();
    const insertTable = vi.spyOn(editor, "insertTable");
    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 0, to: 0 },
        props: { title: "Table" },
      },
      { onAiTrigger: () => {} },
    );
    expect(insertTable).toHaveBeenCalledWith({
      rows: 3,
      cols: 3,
      withHeaderRow: true,
    });
  });

  it("Code Block inserts inline", () => {
    const editor = makeEditor();
    const toggleCodeBlock = vi.spyOn(editor, "toggleCodeBlock");
    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 0, to: 0 },
        props: { title: "Code Block" },
      },
      { onAiTrigger: () => {} },
    );
    expect(toggleCodeBlock).toHaveBeenCalledWith({ language: "ts" });
  });
});
