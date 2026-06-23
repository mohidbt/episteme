// @vitest-environment jsdom
// GSD-129 — The agents-tab paper-clip button must insert a "@" into the
// Tiptap composer so the EXISTING @-mention library picker opens, instead of
// opening the OS file-import dialog.
//
// Edge cases (§12):
//   - imperative:  ChatComposerHandle.insertAtMention() puts "@" in the doc
//                  AND opens the suggestion picker (onStart fires).
//   - boundary:    insertAtMention() after existing non-space text prepends a
//                  space so the @-trigger matches (findSuggestionMatch needs a
//                  whitespace/boundary prefix).
//   - wiring:      clicking PaperclipButton routes to insertAtMention, NOT to
//                  the hidden file input (no OS picker).
//   - regression:  typing "@" manually still opens the picker.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { ChatComposer, type ChatComposerHandle } from "../ChatComposer";
import { PaperclipButton } from "../ChatFileAttachments";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderComposer(
  props: Partial<React.ComponentProps<typeof ChatComposer>> = {},
) {
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

describe("ChatComposer — insertAtMention() imperative API (GSD-129)", () => {
  it("inserts '@' into the doc and opens the suggestion picker", async () => {
    const { ref } = renderComposer();
    act(() => {
      ref.current?.insertAtMention();
    });
    // "@" lands in the editor doc.
    expect(ref.current?._editor?.getText()).toContain("@");
    // The suggestion popover mounts (onStart fired → React picker renders).
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-picker")).toBeTruthy();
    });
  });

  it("prepends a space when inserting after non-space text so '@' still triggers", async () => {
    const { ref } = renderComposer();
    act(() => {
      ref.current?._editor?.commands.insertContent("hello");
    });
    act(() => {
      ref.current?.insertAtMention();
    });
    // Picker must still open even though there was preceding word text, and a
    // space must be inserted between the word and "@" (the @-trigger needs a
    // whitespace prefix to match).
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-picker")).toBeTruthy();
    });
    expect(ref.current?._editor?.getText()).toContain("hello @");
  });

  it("prepends a space when inserting right after a wikiLink chip", async () => {
    const { ref } = renderComposer();
    // Cursor sits immediately after an atom chip → nodeBefore is not a text
    // node, so a bare "@" would never trigger. insertAtMention must prepend a
    // space so the picker still opens.
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
    act(() => {
      ref.current?.insertAtMention();
    });
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-picker")).toBeTruthy();
    });
  });
});

describe("PaperclipButton — routes to @-mention, not OS file picker (GSD-129)", () => {
  it("clicking the paper-clip calls onInsertAtMention", () => {
    const onInsertAtMention = vi.fn();
    render(<PaperclipButton onInsertAtMention={onInsertAtMention} />);
    fireEvent.click(screen.getByRole("button", { name: /attach/i }));
    expect(onInsertAtMention).toHaveBeenCalledTimes(1);
  });

  it("no longer renders a hidden file input (OS picker removed)", () => {
    const onInsertAtMention = vi.fn();
    render(<PaperclipButton onInsertAtMention={onInsertAtMention} />);
    expect(screen.queryByTestId("chat-file-input")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("ChatComposer — typing '@' still opens picker (regression, GSD-129)", () => {
  it("inserting '@' via editor command opens the picker (existing flow intact)", async () => {
    const { ref } = renderComposer();
    act(() => {
      ref.current?._editor?.commands.insertContent("@");
    });
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-picker")).toBeTruthy();
    });
  });
});
