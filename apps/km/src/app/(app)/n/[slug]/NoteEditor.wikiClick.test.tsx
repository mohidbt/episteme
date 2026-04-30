// @vitest-environment jsdom
/**
 * Task #24 — `[[ ]]` wiki-link / citation pills are clickable + responsive.
 *
 * The pill click handler is wired via event delegation on the editor host
 * (`onClick` in NoteEditor.tsx). Clicking a pill should call `router.push`
 * with the resolved target href, after a ~250 ms debounce that gives a
 * possible dblclick a chance to cancel navigation (so dblclick can edit).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

const { mockEditor, mockPush } = vi.hoisted(() => ({
  mockEditor: vi.fn(() => null),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@episteme/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@episteme/editor")>();
  return {
    ...actual,
    Editor: mockEditor,
    createCollabProvider: vi.fn(),
  };
});

vi.mock("@/components/WikiLinkTypeahead", () => ({ WikiLinkTypeahead: vi.fn(() => null) }));
vi.mock("@/components/SlashCommandTypeahead", () => ({ SlashCommandTypeahead: vi.fn(() => null) }));
vi.mock("@/components/AiBubbleMenu", () => ({ AiBubbleMenu: vi.fn(() => null) }));
vi.mock("@/lib/flags", () => ({ COLLAB_ENABLED: false, COLLAB_URL: "" }));

import { NoteEditor } from "./NoteEditor";

describe("NoteEditor — wiki-link pill click navigation", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockEditor.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("clicking a reference pill calls router.push(/r/<id>) after dblclick debounce", () => {
    const { container } = render(
      <NoteEditor id="note-1" initialMd="" userName="alice" />,
    );
    // The host is the only div in NoteEditor's render. Inject a wiki-link
    // element with the same data-* attributes the renderer would emit.
    const host = container.firstChild as HTMLElement;
    const pill = document.createElement("span");
    pill.setAttribute("data-type", "wiki-link");
    pill.setAttribute("data-target-kind", "reference");
    pill.setAttribute("data-target-id", "ref-42");
    pill.setAttribute("data-title", "@smith2024");
    pill.textContent = "@smith2024";
    host.appendChild(pill);

    pill.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Click is debounced by ~250 ms to allow dblclick → edit; advance timers.
    vi.advanceTimersByTime(260);

    expect(mockPush).toHaveBeenCalledWith("/r/ref-42");
  });

  it("clicking a paper pill calls router.push(/p/<id>)", () => {
    const { container } = render(
      <NoteEditor id="note-1" initialMd="" userName="alice" />,
    );
    const host = container.firstChild as HTMLElement;
    const pill = document.createElement("span");
    pill.setAttribute("data-type", "wiki-link");
    pill.setAttribute("data-target-kind", "paper");
    pill.setAttribute("data-target-id", "paper-7");
    pill.setAttribute("data-title", "pdf:transformers");
    pill.textContent = "transformers";
    host.appendChild(pill);

    pill.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(260);

    expect(mockPush).toHaveBeenCalledWith("/p/paper-7");
  });
});
