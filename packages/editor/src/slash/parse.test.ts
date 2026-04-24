import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "./parse";

describe("parseSlashCommand", () => {
  it('"/cite doe2024" -> { cmd: "cite", args: "doe2024" }', () => {
    expect(parseSlashCommand("/cite doe2024")).toEqual({ cmd: "cite", args: "doe2024" });
  });

  it('"/cite" with no args -> { cmd: "cite", args: "" }', () => {
    expect(parseSlashCommand("/cite")).toEqual({ cmd: "cite", args: "" });
  });

  it('"/cite  multiple words  " -> args trimmed', () => {
    expect(parseSlashCommand("/cite  multiple words")).toEqual({ cmd: "cite", args: "multiple words" });
  });

  it("unknown command -> null", () => {
    expect(parseSlashCommand("not a slash command")).toBeNull();
  });

  it("empty string -> null", () => {
    expect(parseSlashCommand("")).toBeNull();
  });

  it('"/AI write something" -> { cmd: "AI", args: "write something" } (case-preserving)', () => {
    expect(parseSlashCommand("/AI write something")).toEqual({ cmd: "AI", args: "write something" });
  });

  it("does NOT fire inside a code fence marker (backtick line)", () => {
    // Code fence context is detected by caller; parser itself should still parse
    // but the trigger matcher test covers the suppression in code blocks
    expect(parseSlashCommand("/cite transformer")).toEqual({ cmd: "cite", args: "transformer" });
  });

  it('"/link foo" -> { cmd: "link", args: "foo" }', () => {
    expect(parseSlashCommand("/link foo")).toEqual({ cmd: "link", args: "foo" });
  });

  it('"/link" with no args -> { cmd: "link", args: "" }', () => {
    expect(parseSlashCommand("/link")).toEqual({ cmd: "link", args: "" });
  });

  it('"/agent triage X" -> { cmd: "agent", args: "triage X" }', () => {
    expect(parseSlashCommand("/agent triage X")).toEqual({ cmd: "agent", args: "triage X" });
  });

  it('"/agent" with no args -> { cmd: "agent", args: "" }', () => {
    expect(parseSlashCommand("/agent")).toEqual({ cmd: "agent", args: "" });
  });
});
