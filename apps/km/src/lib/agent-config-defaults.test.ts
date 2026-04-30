// #63 — env-driven default model for new agent_configs rows.
import { describe, it, expect, afterEach } from "vitest";
import { getDefaultAgentModel } from "./agent-config-defaults";

const ENV_KEY = "DEFAULT_AGENT_MODEL";

describe("getDefaultAgentModel", () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("returns DEFAULT_AGENT_MODEL env var when set", () => {
    process.env[ENV_KEY] = "test/foo";
    expect(getDefaultAgentModel()).toBe("test/foo");
  });

  it("falls back to google/gemma-4-26b-a4b-it when env unset", () => {
    delete process.env[ENV_KEY];
    expect(getDefaultAgentModel()).toBe("google/gemma-4-26b-a4b-it");
  });

  it("trims surrounding whitespace and falls back if empty", () => {
    process.env[ENV_KEY] = "   ";
    expect(getDefaultAgentModel()).toBe("google/gemma-4-26b-a4b-it");
  });
});
