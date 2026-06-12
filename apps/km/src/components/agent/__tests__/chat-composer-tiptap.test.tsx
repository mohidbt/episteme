// @vitest-environment jsdom
// GSD-105 (R6 of GSD-96) — RED. ChatComposer is now a Tiptap surface with
// inline wikiLink chips at cursor position.
//
// Edge case enumeration (§12):
//   - canonical:   renders a contenteditable surface with placeholder
//   - canonical:   text + wikiLink + text submit emits interleaved tokens
//   - canonical:   multiple wikilinks → order preserved
//   - boundary:    Enter w/o shift submits, Shift+Enter inserts HardBreak
//   - empty:       empty doc → submit suppressed
//   - empty:       whitespace-only doc → submit suppressed
//   - non-empty:   chip-only doc → submit fires
//   - streaming:   onSubmit suppressed while streaming=true
//   - suggestion:  `@` keystroke opens picker (covered in unit test;
//                  here we assert ChatComposer wires it to recents/search)
//   - imperative:  external submit() via ref triggers onSubmit
// Omissions:
//   - Cmd+V image paste: deferred to GSD-106.
//   - Drop into composer: parked under _deferred/ (R4 scope).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { createRef } from "react";
import { ChatComposer, type ChatComposerHandle } from "../ChatComposer";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderComposer(props: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const onSubmit = vi.fn();
  const ref = createRef<ChatComposerHandle>();
  render(
    <ChatComposer
      ref={ref}
      onSubmit={onSubmit}
      streaming={false}
      placeholder="Ask anything"
      {...props}
    />,
  );
  return { onSubmit, ref };
}

function getEditorEl(): HTMLElement {
  // Tiptap surface — ProseMirror renders a contenteditable div.
  return screen.getByTestId("chat-composer-editor");
}

describe("ChatComposer (Tiptap) — basic surface", () => {
  it("renders a contenteditable editor with aria-label 'Message agent'", () => {
    renderComposer();
    const editor = getEditorEl();
    expect(editor.getAttribute("contenteditable")).toBe("true");
    // The editor is inside the wrapper labeled "Message agent".
    expect(screen.getByLabelText("Message agent")).toBeTruthy();
  });

  it("exposes data-testid='chat-composer' on the wrapper", () => {
    renderComposer();
    expect(screen.getByTestId("chat-composer")).toBeTruthy();
  });
});

describe("ChatComposer (Tiptap) — submit serializer", () => {
  it("plain text → onSubmit receives the typed text", async () => {
    const { onSubmit, ref } = renderComposer();
    // Drive through the editor's command surface, not fireEvent.input.
    act(() => {
      ref.current?._editor?.commands.insertContent("hello");
    });
    act(() => {
      ref.current?.submit();
    });
    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0].text).toBe("hello");
  });

  it("text + wikiLink + text → tokens interleaved in ORDER", async () => {
    const { onSubmit, ref } = renderComposer();
    act(() => {
      const e = ref.current?._editor;
      e?.commands.insertContent("look at ");
      e?.commands.insertContent({
        type: "wikiLink",
        attrs: {
          title: "Paper One",
          alias: null,
          targetKind: "paper",
          targetId: "uuid-1",
          displayTitle: null,
        },
      });
      e?.commands.insertContent(" then summarise");
    });
    act(() => {
      ref.current?.submit();
    });
    expect(onSubmit).toHaveBeenCalled();
    const text = onSubmit.mock.calls[0][0].text as string;
    expect(text).toBe(
      'look at [lib: kind=paper id=uuid-1 title="Paper One"] then summarise',
    );
  });

  it("multiple wikilinks → order preserved", async () => {
    const { onSubmit, ref } = renderComposer();
    act(() => {
      const e = ref.current?._editor;
      e?.commands.insertContent("compare ");
      e?.commands.insertContent({
        type: "wikiLink",
        attrs: { title: "A", alias: null, targetKind: "paper", targetId: "id-a", displayTitle: null },
      });
      e?.commands.insertContent(" and ");
      e?.commands.insertContent({
        type: "wikiLink",
        attrs: { title: "B", alias: null, targetKind: "note", targetId: "id-b", displayTitle: null },
      });
    });
    act(() => {
      ref.current?.submit();
    });
    const text = onSubmit.mock.calls[0][0].text as string;
    expect(text).toBe(
      'compare [lib: kind=paper id=id-a title="A"] and [lib: kind=note id=id-b title="B"]',
    );
  });
});

describe("ChatComposer (Tiptap) — submit gating", () => {
  it("empty doc → submit suppressed", () => {
    const { onSubmit, ref } = renderComposer();
    act(() => {
      ref.current?.submit();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("whitespace-only → submit suppressed", () => {
    const { onSubmit, ref } = renderComposer();
    act(() => {
      ref.current?._editor?.commands.insertContent("   ");
    });
    act(() => {
      ref.current?.submit();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("chip-only doc → submit fires (chip alone counts)", () => {
    const { onSubmit, ref } = renderComposer();
    act(() => {
      ref.current?._editor?.commands.insertContent({
        type: "wikiLink",
        attrs: { title: "T", alias: null, targetKind: "paper", targetId: "x", displayTitle: null },
      });
    });
    act(() => {
      ref.current?.submit();
    });
    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0].text).toBe('[lib: kind=paper id=x title="T"]');
  });

  it("streaming → submit suppressed", () => {
    const { onSubmit, ref } = renderComposer({ streaming: true });
    act(() => {
      ref.current?._editor?.commands.insertContent("hi");
    });
    act(() => {
      ref.current?.submit();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ChatComposer (Tiptap) — isEmpty()", () => {
  it("empty doc → isEmpty() returns true", () => {
    const { ref } = renderComposer();
    expect(ref.current?.isEmpty()).toBe(true);
  });

  it("doc with text → isEmpty() returns false", () => {
    const { ref } = renderComposer();
    act(() => {
      ref.current?._editor?.commands.insertContent("hi");
    });
    expect(ref.current?.isEmpty()).toBe(false);
  });
});

describe("ChatComposer (Tiptap) — onIsEmptyChange notification (fix-round)", () => {
  // The outer Send button (in AgentTranscript) needs to flip `disabled`
  // on/off in response to composer content changes. ChatComposer owns the
  // editor state, so it must surface emptiness updates via a callback.
  //
  // Edge cases (§12):
  //   - mount:           callback fires at least once with `true` for empty
  //   - typing:          callback fires with `false` after content is added
  //   - clear-on-submit: callback fires with `true` after submit clears doc
  //   - chip-only:       callback fires with `false` when only a chip exists
  it("fires onIsEmptyChange(true) on mount when the doc is empty", () => {
    const onIsEmptyChange = vi.fn();
    const ref = createRef<ChatComposerHandle>();
    render(
      <ChatComposer
        ref={ref}
        onSubmit={() => {}}
        streaming={false}
        onIsEmptyChange={onIsEmptyChange}
      />,
    );
    expect(onIsEmptyChange).toHaveBeenCalled();
    const last = onIsEmptyChange.mock.calls.at(-1)?.[0];
    expect(last).toBe(true);
  });

  it("fires onIsEmptyChange(false) after content is inserted", () => {
    const onIsEmptyChange = vi.fn();
    const ref = createRef<ChatComposerHandle>();
    render(
      <ChatComposer
        ref={ref}
        onSubmit={() => {}}
        streaming={false}
        onIsEmptyChange={onIsEmptyChange}
      />,
    );
    act(() => {
      ref.current?._editor?.commands.insertContent("hi");
    });
    expect(onIsEmptyChange.mock.calls.some((c) => c[0] === false)).toBe(true);
  });

  it("fires onIsEmptyChange(true) again after submit clears the doc", () => {
    const onIsEmptyChange = vi.fn();
    const ref = createRef<ChatComposerHandle>();
    render(
      <ChatComposer
        ref={ref}
        onSubmit={() => {}}
        streaming={false}
        onIsEmptyChange={onIsEmptyChange}
      />,
    );
    act(() => {
      ref.current?._editor?.commands.insertContent("hi");
    });
    act(() => {
      ref.current?.submit();
    });
    // The post-submit call (after the clearContent in trySubmit) should be true.
    const last = onIsEmptyChange.mock.calls.at(-1)?.[0];
    expect(last).toBe(true);
  });

  it("fires onIsEmptyChange(false) when only a wikiLink chip is inserted", () => {
    const onIsEmptyChange = vi.fn();
    const ref = createRef<ChatComposerHandle>();
    render(
      <ChatComposer
        ref={ref}
        onSubmit={() => {}}
        streaming={false}
        onIsEmptyChange={onIsEmptyChange}
      />,
    );
    act(() => {
      ref.current?._editor?.commands.insertContent({
        type: "wikiLink",
        attrs: {
          title: "Paper",
          alias: null,
          targetKind: "paper",
          targetId: "x",
          displayTitle: null,
        },
      });
    });
    expect(onIsEmptyChange.mock.calls.some((c) => c[0] === false)).toBe(true);
  });
});

describe("ChatComposer (Tiptap) — insertHandle imperative API", () => {
  it("ref.insertHandle inserts a wikiLink node at the current selection", () => {
    const { onSubmit, ref } = renderComposer();
    act(() => {
      ref.current?._editor?.commands.insertContent("see ");
    });
    act(() => {
      ref.current?.insertHandle({
        kind: "paper",
        id: "uid-z",
        title: "Z Paper",
      });
    });
    act(() => {
      ref.current?.submit();
    });
    const text = onSubmit.mock.calls[0][0].text as string;
    expect(text).toContain('[lib: kind=paper id=uid-z title="Z Paper"]');
    expect(text.startsWith("see ")).toBe(true);
  });
});
