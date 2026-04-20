// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { findCitationFromAnchor } from "../find-citation-from-anchor";

function makeAnchor(container: HTMLElement, text: string, nested = false) {
  container.replaceChildren();
  const a = document.createElement("a");
  a.setAttribute("href", "#dest");
  if (nested) {
    const span = document.createElement("span");
    const em = document.createElement("em");
    em.textContent = text;
    span.appendChild(em);
    a.appendChild(span);
  } else {
    a.textContent = text;
  }
  container.appendChild(a);
  return a;
}

describe("findCitationFromAnchor", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("returns null when target is null", () => {
    expect(findCitationFromAnchor(null, [{ markerIndex: 1 }])).toBeNull();
  });

  it("returns null when target has no <a> ancestor", () => {
    const span = document.createElement("span");
    span.textContent = "13";
    container.appendChild(span);
    expect(findCitationFromAnchor(span, [{ markerIndex: 13 }])).toBeNull();
  });

  it("matches bare digit inside <a> (pdfjs annotation case)", () => {
    const a = makeAnchor(container, "13");
    expect(findCitationFromAnchor(a, [{ markerIndex: 13 }])).toEqual({
      markerIndex: 13,
    });
  });

  it("matches when target is a text-node's parent inside <a>", () => {
    const a = makeAnchor(container, "7");
    const parent = (a.firstChild as Text).parentElement!;
    expect(findCitationFromAnchor(parent, [{ markerIndex: 7 }])).toEqual({
      markerIndex: 7,
    });
  });

  it("matches [13] form (bracketed) inside <a>", () => {
    const a = makeAnchor(container, "[13]");
    expect(findCitationFromAnchor(a, [{ markerIndex: 13 }])).toEqual({
      markerIndex: 13,
    });
  });

  it("trims whitespace inside <a>", () => {
    const a = makeAnchor(container, "  42  ");
    expect(findCitationFromAnchor(a, [{ markerIndex: 42 }])).toEqual({
      markerIndex: 42,
    });
  });

  it("returns null when <a> text is not a number", () => {
    const a = makeAnchor(container, "Figure 3");
    expect(findCitationFromAnchor(a, [{ markerIndex: 3 }])).toBeNull();
  });

  it("returns null when digit has no matching citation", () => {
    const a = makeAnchor(container, "99");
    expect(findCitationFromAnchor(a, [{ markerIndex: 1 }])).toBeNull();
  });

  it("rejects out-of-range digits (0 and >999)", () => {
    const a0 = makeAnchor(container, "0");
    expect(findCitationFromAnchor(a0, [{ markerIndex: 1 }])).toBeNull();

    const a1000 = makeAnchor(container, "1000");
    expect(findCitationFromAnchor(a1000, [{ markerIndex: 1 }])).toBeNull();
  });

  it("finds <a> via closest() when target is nested child", () => {
    const a = makeAnchor(container, "8", true);
    const em = a.querySelector("em")!;
    expect(findCitationFromAnchor(em, [{ markerIndex: 8 }])).toEqual({
      markerIndex: 8,
    });
  });

  it("falls back to title attribute when <a> text is empty (pdfjs annotation)", () => {
    // pdfjs renders <section class="linkAnnotation"><a href="#" title="13"></a></section>
    // — the <a> has no text content, only a title.
    container.replaceChildren();
    const a = document.createElement("a");
    a.setAttribute("href", "#");
    a.setAttribute("title", "13");
    // deliberately no text content
    container.appendChild(a);
    expect(findCitationFromAnchor(a, [{ markerIndex: 13 }])).toEqual({
      markerIndex: 13,
    });
  });

  it("prefers text over title when both are present", () => {
    container.replaceChildren();
    const a = document.createElement("a");
    a.setAttribute("href", "#");
    a.setAttribute("title", "99");
    a.textContent = "7";
    container.appendChild(a);
    expect(
      findCitationFromAnchor(a, [{ markerIndex: 7 }, { markerIndex: 99 }])
    ).toEqual({ markerIndex: 7 });
  });
});
