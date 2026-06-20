/**
 * GSD-134 — RED test reproducing the AI slash crash root cause.
 *
 * The crash (`NotFoundError: Failed to execute 'insertBefore' on 'Node'`) is a
 * DOM mutation race between the Tiptap Suggestion plugin's view-update and a
 * React re-render triggered synchronously from inside the suggestion's
 * `command` callback. We cannot fully reproduce the jsdom DOM race in a unit
 * test, but we can lock down the contract that prevents it: the AI trigger
 * MUST be deferred until after the editor's current dispatch completes.
 *
 * Before the fix, `handleSlashCommand` fired `onAiTrigger` synchronously and
 * this test fails. After the fix, the call is queued via `defer` (e.g.
 * `queueMicrotask`) and the test passes.
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
  it("deletes the slash trigger range synchronously", () => {
    const editor = makeEditor();
    const deleteRange = vi.spyOn(editor, "deleteRange");
    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 1, to: 2 },
        props: { title: "AI" },
      },
      { onAiTrigger: () => {}, defer: () => {} },
    );
    expect(deleteRange).toHaveBeenCalledWith({ from: 1, to: 2 });
  });

  it("defers onAiTrigger so it does NOT fire synchronously", () => {
    const editor = makeEditor();
    const onAiTrigger = vi.fn();
    const captured: Array<() => void> = [];
    const defer = (fn: () => void) => {
      captured.push(fn);
    };

    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 1, to: 2 },
        props: { title: "AI" },
      },
      { onAiTrigger, defer },
    );

    // RED: before the fix, onAiTrigger ran inline and this assertion fails.
    expect(onAiTrigger).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);

    captured[0]!();
    expect(onAiTrigger).toHaveBeenCalledTimes(1);
  });

  it("uses queueMicrotask by default when no defer override is provided", async () => {
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

    // Not synchronous.
    expect(onAiTrigger).not.toHaveBeenCalled();
    // queueMicrotask flushes before the next macrotask — awaiting a resolved
    // promise yields after the microtask queue drains.
    await Promise.resolve();
    expect(onAiTrigger).toHaveBeenCalledTimes(1);
  });
});

describe("handleSlashCommand — non-AI items run synchronously", () => {
  it("Table inserts inline (no deferral)", () => {
    const editor = makeEditor();
    const insertTable = vi.spyOn(editor, "insertTable");
    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 0, to: 0 },
        props: { title: "Table" },
      },
      { onAiTrigger: () => {}, defer: () => {} },
    );
    expect(insertTable).toHaveBeenCalledWith({
      rows: 3,
      cols: 3,
      withHeaderRow: true,
    });
  });

  it("Code Block inserts inline (no deferral)", () => {
    const editor = makeEditor();
    const toggleCodeBlock = vi.spyOn(editor, "toggleCodeBlock");
    handleSlashCommand(
      {
        editor: editor as unknown as HandlerEditorArg,
        range: { from: 0, to: 0 },
        props: { title: "Code Block" },
      },
      { onAiTrigger: () => {}, defer: () => {} },
    );
    expect(toggleCodeBlock).toHaveBeenCalledWith({ language: "ts" });
  });
});
