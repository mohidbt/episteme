// @vitest-environment happy-dom
/**
 * B16 — selections that originate outside the PDF surface
 * (`[data-pdf-container]`) must NOT activate the floating SelectionToolbar.
 * The toolbar uses position:fixed z-50 and would otherwise pop over every
 * chat / sidebar / drive text the user happens to select.
 *
 * The hook fires off `selectionchange`. We render two DOM regions — one
 * inside `[data-pdf-container]`, one outside — select text in each, and
 * assert the hook reports a selection only for the in-PDF case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { useTextSelection } from "../../src/hooks/use-text-selection";

afterEach(() => cleanup());

beforeEach(() => {
  vi.useFakeTimers();
});

function Probe() {
  const { selection } = useTextSelection();
  return (
    <div>
      <div data-pdf-container>
        <div
          data-page-number="1"
          data-natural-width="600"
          data-natural-height="800"
          id="pdf-span"
        >
          alpha beta gamma
        </div>
      </div>
      <div id="chat-pane">
        <span id="chat-span">chat text outside the pdf surface</span>
      </div>
      <pre data-testid="state">
        {selection ? `text=${selection.text}` : "null"}
      </pre>
    </div>
  );
}

function selectNode(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("useTextSelection — scope gating", () => {
  it("ignores selections outside [data-pdf-container]", async () => {
    const ui = render(<Probe />);

    selectNode("chat-span");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(ui.getByTestId("state").textContent).toBe("null");
  });

  it("captures selections that originate inside [data-pdf-container]", async () => {
    const ui = render(<Probe />);

    selectNode("pdf-span");
    await act(async () => {
      vi.advanceTimersByTime(100);
      // Flush microtasks so the setState scheduled in the timer callback
      // commits before we assert.
      await Promise.resolve();
    });
    expect(ui.getByTestId("state").textContent).toContain("text=");
  });
});
