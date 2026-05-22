// @vitest-environment jsdom
/**
 * Round 2 — Inline Citations rebuild (B1/B2/B3).
 *
 * Pills render as enumerated [1] [2] [3] with title hover, and the
 * "Used X sources" sidebar is renamed to `Sources (N)` with rows rendered
 * from the citation `title` (e.g. `Paper Title - Page 4`).
 *
 * The full <AgentTranscript> mounts heavy SSE/fetch wiring, so we render the
 * small extracted pieces from `CitationsBlock` directly. Same surface — same
 * inputs/outputs — keeps the assertion focused on rendering.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { InlineCitationPills } from "../CitationsBlock";
import type { Citation } from "@/lib/agent-events";

afterEach(() => {
  cleanup();
});

const CITATIONS: Citation[] = [
  {
    chunk_id: "paper-a:p1:0",
    paper_id: "paper-a",
    page: 1,
    title: "Attention Is All You Need - Page 1",
    score: 0.9,
  },
  {
    chunk_id: "paper-a:p3:7",
    paper_id: "paper-a",
    page: 3,
    title: "Attention Is All You Need - Page 3",
    score: 0.8,
  },
  {
    chunk_id: "paper-a:p5:12",
    paper_id: "paper-a",
    page: 5,
    title: "Attention Is All You Need - Page 5",
    score: 0.7,
  },
];

describe("InlineCitationPills", () => {
  it("renders an enumerated [n] label per citation (not a hostname)", () => {
    render(
      <InlineCitationPills citations={CITATIONS} onCitationClick={() => {}} />,
    );

    // Labels are 1, 2, 3 (enumerated).
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    // No hostname leakage from a default placeholder url.
    expect(screen.queryByText("example.com")).toBeNull();
  });

  it("exposes the citation title as the pill's accessible tooltip via the `title` attr", () => {
    render(
      <InlineCitationPills citations={CITATIONS} onCitationClick={() => {}} />,
    );

    const pill1 = screen.getByTestId("inline-citation-pill-paper-a:p1:0");
    expect(pill1.getAttribute("title")).toBe(
      "Attention Is All You Need - Page 1",
    );
  });
});

