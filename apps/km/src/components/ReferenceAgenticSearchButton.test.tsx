// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReferenceAgenticSearchButton } from "./ReferenceAgenticSearchButton";

vi.mock("@/components/agent/agent-ball-context", () => ({
  useAgentBall: () => ({ openWithPrompt: vi.fn() }),
}));

afterEach(() => cleanup());

describe("ReferenceAgenticSearchButton", () => {
  it("is enabled when identityPaper is absent", () => {
    render(
      <ReferenceAgenticSearchButton
        referenceId="ref_1"
        citationKey="foo2024"
      />,
    );
    const btn = screen.getByRole("button", { name: /agentic pdf search/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("is disabled when identityPaper is provided (already in library)", () => {
    render(
      <ReferenceAgenticSearchButton
        referenceId="ref_1"
        citationKey="foo2024"
        identityPaper={{ paperId: "p_1", title: "x" }}
      />,
    );
    const btn = screen.getByRole("button", { name: /agentic pdf search/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
