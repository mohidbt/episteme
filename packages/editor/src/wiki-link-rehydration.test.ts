import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions, WikiLink, TagMark } from "@episteme/markdown";
import { attachWikiLinkRehydration } from "./hydrate-wiki-links";

function makeEditor() {
  return new Editor({
    extensions: [...createExtensions(), WikiLink, TagMark],
  });
}

type Listener = (...args: unknown[]) => void;
function makeFakeEmitter() {
  const handlers = new Map<string, Set<Listener>>();
  return {
    on(evt: string, fn: Listener) {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt)!.add(fn);
    },
    off(evt: string, fn: Listener) {
      handlers.get(evt)?.delete(fn);
    },
    emit(evt: string, ...args: unknown[]) {
      handlers.get(evt)?.forEach((fn) => fn(...args));
    },
    size(evt: string) {
      return handlers.get(evt)?.size ?? 0;
    },
  };
}

describe("attachWikiLinkRehydration", () => {
  it("re-hydrates wiki links when provider emits `synced` AFTER initial mount", () => {
    // Simulate the real bug: editor mounts empty (collab mode skips content
    // seed), hydration effect runs against empty doc, then YJS provider
    // syncs and materializes wikiLink nodes with targetId=null.
    const editor = makeEditor();
    const provider = makeFakeEmitter();

    const cleanup = attachWikiLinkRehydration(editor, {
      "note::foo": { targetKind: "note", targetId: "abc" },
    }, { provider: provider as never });

    // Doc was empty at attach time; nothing to hydrate yet.
    // Now YJS materializes a stale wikiLink (targetId=null) into the doc.
    editor.commands.setContent("hi [[Foo]] there");

    // Pre-sync: node exists but targetId still null (it was inserted as if
    // by YJS, before any rehydration trigger fired).
    let json = editor.getJSON();
    const findFoo = (j: typeof json): Record<string, unknown> | undefined => {
      const walk = (nodes: unknown[] | undefined): Record<string, unknown> | undefined => {
        if (!nodes) return undefined;
        for (const n of nodes as Array<Record<string, unknown>>) {
          if (n.type === "wikiLink" && (n.attrs as { title?: string })?.title === "Foo") return n;
          const hit = walk(n.content as unknown[] | undefined);
          if (hit) return hit;
        }
        return undefined;
      };
      return walk(j.content as unknown[] | undefined);
    };
    expect(findFoo(json)?.attrs).toMatchObject({ targetId: null });

    // The bug: without a `synced` listener, the pill stays unresolved.
    provider.emit("synced");

    json = editor.getJSON();
    expect(findFoo(json)?.attrs).toMatchObject({
      targetId: "abc",
      targetKind: "note",
    });

    cleanup();
    editor.destroy();
  });

  it("cleanup detaches the provider listener", () => {
    const editor = makeEditor();
    const provider = makeFakeEmitter();

    const cleanup = attachWikiLinkRehydration(editor, {}, { provider: provider as never });
    expect(provider.size("synced")).toBeGreaterThan(0);
    cleanup();
    expect(provider.size("synced")).toBe(0);
    editor.destroy();
  });

  it("re-hydrates on debounced ydoc `update` after first sync", async () => {
    // Covers late-arriving YJS updates that materialize wikiLink nodes AFTER
    // the synced event has already fired.
    vi.useFakeTimers();
    const editor = makeEditor();
    const ydoc = makeFakeEmitter();

    const cleanup = attachWikiLinkRehydration(editor, {
      "note::late": { targetKind: "note", targetId: "late-id" },
    }, { ydoc: ydoc as never });

    editor.commands.setContent("[[Late]]");
    ydoc.emit("update");
    vi.advanceTimersByTime(150);

    const json = editor.getJSON();
    const node = (json.content as Array<{ content?: Array<{ type: string; attrs: Record<string, unknown> }> }>)[0]
      ?.content?.find((n) => n.type === "wikiLink");
    expect(node?.attrs).toMatchObject({ targetId: "late-id" });

    cleanup();
    editor.destroy();
    vi.useRealTimers();
  });
});
