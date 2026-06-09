// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Capture the shouldShow predicate so we can assert link-mark gating.
let capturedShouldShow: ((args: { editor: unknown; state: unknown }) => boolean) | null = null;

vi.mock("@episteme/editor", () => {
  return {
    BubbleMenu: ({
      children,
      shouldShow,
    }: {
      children: React.ReactNode;
      shouldShow?: (args: { editor: unknown; state: unknown }) => boolean;
    }) => {
      capturedShouldShow = shouldShow ?? null;
      return <div data-testid="bubble">{children}</div>;
    },
  };
});

import { LinkBubbleMenu } from "./LinkBubbleMenu";

interface EditorStub {
  isActive: (name: string) => boolean;
  state: {
    selection: {
      from: number;
      to: number;
      $from: {
        marks: () => Array<{ type: { name: string }; attrs: { href: string }; eq: (m: unknown) => boolean }>;
        parent: {
          descendants: (
            cb: (node: { isText: boolean; marks: Array<{ eq: (m: unknown) => boolean }>; nodeSize: number }, offset: number) => void,
          ) => void;
        };
        parentOffset: number;
      };
    };
    doc: { textBetween: (a: number, b: number, sep: string) => string };
  };
  chain: () => EditorStub;
  focus: () => EditorStub;
  setTextSelection: (r: unknown) => EditorStub;
  deleteSelection: () => EditorStub;
  insertContent: (c: unknown) => EditorStub;
  unsetMark: (name: string) => EditorStub;
  run: () => boolean;
}

function makeEditor({ active }: { active: boolean }): EditorStub {
  const linkMark = {
    type: { name: "link" },
    attrs: { href: "https://example.com" },
    eq: (m: unknown) => m === linkMark,
  };
  const editor: Partial<EditorStub> & Record<string, unknown> = {
    isActive: (name: string) => name === "link" && active,
    state: {
      selection: {
        from: 5,
        to: 5,
        $from: {
          marks: () => (active ? [linkMark] : []),
          parent: {
            descendants: (cb) => {
              cb({ isText: true, marks: [linkMark], nodeSize: 10 }, 0);
            },
          },
          parentOffset: 5,
        },
      },
      doc: { textBetween: () => "example" },
    },
  };
  editor.chain = () => editor as EditorStub;
  editor.focus = () => editor as EditorStub;
  editor.setTextSelection = () => editor as EditorStub;
  editor.deleteSelection = () => editor as EditorStub;
  editor.insertContent = () => editor as EditorStub;
  editor.unsetMark = () => editor as EditorStub;
  editor.run = () => true;
  return editor as EditorStub;
}

beforeEach(() => {
  capturedShouldShow = null;
});

afterEach(() => cleanup());

describe("LinkBubbleMenu", () => {
  it("renders an edit-icon button when caret is inside a link", () => {
    const editor = makeEditor({ active: true });
    render(<LinkBubbleMenu editor={editor as never} />);
    expect(screen.getByRole("button", { name: /edit link/i })).toBeTruthy();
  });

  it("shouldShow returns false when not on a link", () => {
    const editor = makeEditor({ active: false });
    render(<LinkBubbleMenu editor={editor as never} />);
    expect(capturedShouldShow).not.toBeNull();
    const state = { selection: { from: 1, to: 1 } };
    expect(capturedShouldShow!({ editor, state })).toBe(false);
  });

  it("shouldShow returns true when on a link with collapsed selection", () => {
    const editor = makeEditor({ active: true });
    render(<LinkBubbleMenu editor={editor as never} />);
    const state = { selection: { from: 5, to: 5 } };
    expect(capturedShouldShow!({ editor, state })).toBe(true);
  });

  it("shouldShow returns false when on a link with a text selection (defers to AiBubbleMenu)", () => {
    const editor = makeEditor({ active: true });
    render(<LinkBubbleMenu editor={editor as never} />);
    const state = { selection: { from: 3, to: 8 } };
    expect(capturedShouldShow!({ editor, state })).toBe(false);
  });

  it("clicking the edit button opens the LinkPopover pre-filled with current href + text", () => {
    const editor = makeEditor({ active: true });
    render(<LinkBubbleMenu editor={editor as never} />);
    fireEvent.click(screen.getByRole("button", { name: /edit link/i }));
    expect((screen.getByLabelText(/url/i) as HTMLInputElement).value).toBe("https://example.com");
    expect((screen.getByLabelText(/display text/i) as HTMLInputElement).value).toBe("example");
  });

  it("clicking Remove invokes editor unsetMark('link')", () => {
    const editor = makeEditor({ active: true });
    const unsetSpy = vi.fn(() => editor);
    editor.unsetMark = unsetSpy as never;
    render(<LinkBubbleMenu editor={editor as never} />);
    fireEvent.click(screen.getByRole("button", { name: /edit link/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(unsetSpy).toHaveBeenCalledWith("link");
  });
});
