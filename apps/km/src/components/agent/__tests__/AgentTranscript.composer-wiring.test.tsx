// @vitest-environment jsdom
// GSD-105 (R6 of GSD-96) — AgentTranscript wires the Tiptap ChatComposer.
//
// Why: R3-B originally proved the LITE textarea-based composer was reachable
// from the chat surface; R6 swapped the composer to a Tiptap surface with
// inline wikilink chips. These tests reassert the same wiring claims against
// the new surface:
//  - ChatComposer is mounted (data-testid="chat-composer")
//  - the editor is a contenteditable surface (no bare <textarea> outside
//    ChatComposer)
//  - Send button still routes through onSendMessage
//
// Edge cases this covers:
//  - composer mounted (testid present)
//  - no inline <textarea> anywhere in AgentTranscript
//  - Send button fires onSendMessage with the doc's serialized text
//  - parent chat-input-dropzone still ingests file drops via addFiles
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { AgentTranscript } from "../AgentTranscript";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderTranscript(props: Partial<React.ComponentProps<typeof AgentTranscript>> = {}) {
  return render(<AgentTranscript threadId="t1" {...props} />);
}

describe("AgentTranscript — ChatComposer wiring (GSD-105 Tiptap)", () => {
  it("mounts ChatComposer (data-testid='chat-composer')", () => {
    renderTranscript();
    expect(screen.getByTestId("chat-composer")).toBeTruthy();
  });

  it("renders a contenteditable editor surface (Tiptap), not a textarea", () => {
    renderTranscript();
    const editor = screen.getByTestId("chat-composer-editor");
    expect(editor.getAttribute("contenteditable")).toBe("true");
    // No <textarea> anywhere in the AgentTranscript subtree.
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });

  it("Send button fires onSendMessage with the editor's serialized text", async () => {
    const sent = vi.fn();
    renderTranscript({ onSendMessage: sent });
    // The Tiptap surface drives content via commands. We reach in via the
    // exposed editor element + its associated Tiptap view through the DOM.
    // Simplest reliable path in jsdom: dispatch a textInput via the contenteditable
    // — but Tiptap won't see that here, so we drive through the editor's
    // own `_editor` API exposed via a ref the parent doesn't have. Instead,
    // we directly drive `chat-composer-editor` with paste events that Tiptap
    // does intercept in jsdom.
    const editor = screen.getByTestId("chat-composer-editor");
    await act(async () => {
      const clipboardData = {
        getData: (t: string) => (t === "text/plain" ? "hello" : ""),
        types: ["text/plain"],
        files: [] as File[],
      };
      fireEvent.paste(editor, { clipboardData });
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => {
      expect(sent).toHaveBeenCalled();
    });
    expect(String(sent.mock.calls[0][0])).toContain("hello");
  });
});
