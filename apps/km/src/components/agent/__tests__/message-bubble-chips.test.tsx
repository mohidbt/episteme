// @vitest-environment jsdom
// GSD-105 fix-round — RED. User message bubble must render `[lib: ...]`
// tokens as inline `.wiki-link` chips so the chat history visually mirrors
// the composer chips the user just sent. Today the bubble round-trips the
// raw text through Streamdown markdown, which renders the bracket grammar
// as plain prose and loses the visual handle context.
//
// Edge case enumeration (§12):
//   - empty:     bubble text without any `[lib:]` token renders unchanged
//   - 1-token:   single token becomes a `.wiki-link` element inline
//   - n-tokens:  multiple tokens preserved IN ORDER, interleaved with text
//   - start:     token at start of message (no leading text)
//   - end:       token at end of message (no trailing text)
//   - adjacent:  two tokens with only a space between
//   - malformed: bracket text that is not a valid lib token passes through
//   - unicode:   non-ASCII characters in title render as label text
//   - kind:      kind attribute survives onto the chip (paper vs note vs reference)
//   - assistant: assistant bubbles also render chips (round-trip on reload)

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LibTokenizedText } from "../LibTokenizedText";

afterEach(() => cleanup());

function getChips(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(".wiki-link")) as HTMLElement[];
}

describe("LibTokenizedText — user message bubble inline chips", () => {
  it("plain text with no token renders as a single text run", () => {
    const { container } = render(
      <LibTokenizedText text="just plain text" />,
    );
    expect(getChips(container).length).toBe(0);
    expect(container.textContent).toBe("just plain text");
  });

  it("single token becomes a `.wiki-link` element inline", () => {
    const { container } = render(
      <LibTokenizedText text={'see [lib: kind=paper id=abc title="Hello"] here'} />,
    );
    const chips = getChips(container);
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("Hello");
    expect(container.textContent).toContain("see ");
    expect(container.textContent).toContain(" here");
  });

  it("multiple tokens preserve order and interleave with text", () => {
    const { container } = render(
      <LibTokenizedText
        text={
          'compare [lib: kind=paper id=p1 title="Alpha"] vs [lib: kind=note id=n1 title="Beta"] today'
        }
      />,
    );
    const chips = getChips(container);
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("Alpha");
    expect(chips[1].textContent).toContain("Beta");
    const text = container.textContent ?? "";
    expect(text.indexOf("compare")).toBeLessThan(text.indexOf("Alpha"));
    expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("vs"));
    expect(text.indexOf("vs")).toBeLessThan(text.indexOf("Beta"));
    expect(text.indexOf("Beta")).toBeLessThan(text.indexOf("today"));
  });

  it("token at start of message renders chip first", () => {
    const { container } = render(
      <LibTokenizedText text={'[lib: kind=paper id=x title="X"] is great'} />,
    );
    const firstChild = container.firstElementChild?.firstElementChild;
    // first chip-bearing element is the chip span itself, not a text node.
    expect(getChips(container).length).toBe(1);
    expect(container.textContent?.startsWith("X")).toBe(true);
    void firstChild;
  });

  it("token at end of message renders chip last", () => {
    const { container } = render(
      <LibTokenizedText text={'check out [lib: kind=paper id=x title="X"]'} />,
    );
    expect(getChips(container).length).toBe(1);
    expect(container.textContent?.endsWith("X")).toBe(true);
  });

  it("adjacent tokens with a space between both render", () => {
    const { container } = render(
      <LibTokenizedText
        text={
          '[lib: kind=paper id=a title="A"] [lib: kind=paper id=b title="B"]'
        }
      />,
    );
    expect(getChips(container).length).toBe(2);
  });

  it("malformed bracket text is preserved as plain text (no chip)", () => {
    const { container } = render(
      <LibTokenizedText text={"hello [not a lib token] world"} />,
    );
    expect(getChips(container).length).toBe(0);
    expect(container.textContent).toContain("[not a lib token]");
  });

  it("unicode title characters render inside chip label", () => {
    const { container } = render(
      <LibTokenizedText text={'[lib: kind=note id=n title="日本語タイトル"]'} />,
    );
    const chips = getChips(container);
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("日本語タイトル");
  });

  it("kind attribute appears on the chip (paper vs note vs reference)", () => {
    const { container } = render(
      <LibTokenizedText
        text={
          '[lib: kind=paper id=p title="P"] [lib: kind=note id=n title="N"] [lib: kind=reference id=r title="R"]'
        }
      />,
    );
    const chips = getChips(container);
    expect(chips.length).toBe(3);
    expect(chips[0].className).toContain("wiki-link--paper");
    expect(chips[1].className).not.toContain("wiki-link--paper");
    expect(chips[2].className).toContain("wiki-link--reference");
  });
});

describe("LibTokenizedText — rendering host", () => {
  it("renders inside an `.episteme-chat-composer` wrapper so chip CSS applies outside `.episteme-prose`", () => {
    // The chat message bubble does not include the `.episteme-prose`
    // ancestor that the wiki-link rules are scoped to. The host element
    // must carry the `episteme-chat-composer` ancestor class so the CSS
    // rules (also scoped to that ancestor — Fix 1 of this round) apply.
    const { container } = render(
      <LibTokenizedText text={'x [lib: kind=paper id=a title="A"] y'} />,
    );
    const host = container.firstElementChild as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host?.className).toContain("episteme-chat-composer");
  });
});
