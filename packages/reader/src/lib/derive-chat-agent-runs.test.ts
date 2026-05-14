/**
 * B8 — chat-agent runs must derive their sidebar label from the highlight's
 * note, not the hardcoded "AI highlight" string. Prior behavior masked every
 * run with the same generic label even when the agent had attached useful
 * commentary.
 */
import { describe, expect, it } from "vitest";
import { deriveChatAgentRuns } from "./derive-chat-agent-runs";

describe("deriveChatAgentRuns", () => {
  it("uses the first highlight's noteMd as the run label", () => {
    const runs = deriveChatAgentRuns(
      [
        { runId: "r1", noteMd: "Marked references to GPU latency" },
        { runId: "r1", noteMd: "Marked references to GPU latency" },
      ],
      [],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "r1",
      instruction: "Marked references to GPU latency",
      summary: "Marked references to GPU latency",
      highlightCount: 2,
    });
    // Hardcoded label must not leak back in.
    expect(runs[0].instruction).not.toBe("AI highlight");
  });

  it("falls back to 'Highlight run' when no note is present", () => {
    const runs = deriveChatAgentRuns(
      [{ runId: "r2", noteMd: null }],
      [],
    );
    expect(runs[0].instruction).toBe("Highlight run");
    expect(runs[0].summary).toBeNull();
  });

  it("skips runs already represented by autoRunIds", () => {
    const runs = deriveChatAgentRuns(
      [
        { runId: "r1", noteMd: "from chat" },
        { runId: "r2", noteMd: "from auto" },
      ],
      ["r2"],
    );
    expect(runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("truncates very long notes to a single line", () => {
    const long = "first line note".padEnd(200, "x");
    const multiline = `${long}\nsecond line should not appear`;
    const runs = deriveChatAgentRuns(
      [{ runId: "r3", noteMd: multiline }],
      [],
    );
    expect(runs[0].instruction.length).toBeLessThanOrEqual(120);
    expect(runs[0].instruction.includes("second line")).toBe(false);
  });

  it("ignores rows without runId", () => {
    const runs = deriveChatAgentRuns(
      [{ runId: null, noteMd: "orphan" }],
      [],
    );
    expect(runs).toEqual([]);
  });
});
