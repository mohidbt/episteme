import { describe, it, expect } from "vitest";
import { resolveAgentModel, DEFAULT_MODEL } from "./agent-model-resolve";

describe("resolveAgentModel", () => {
  it("threadOverride wins over skillModel and userPreference", () => {
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "skill/model",
        threadOverride: "thread/model",
      }),
    ).toBe("thread/model");
  });

  it("skillModel wins over userPreference when threadOverride is null/undefined/empty", () => {
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "skill/model",
        threadOverride: null,
      }),
    ).toBe("skill/model");
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "skill/model",
        threadOverride: undefined,
      }),
    ).toBe("skill/model");
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "skill/model",
        threadOverride: "",
      }),
    ).toBe("skill/model");
  });

  it("userPreference used when both higher levels are null/undefined/empty", () => {
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: null,
        threadOverride: null,
      }),
    ).toBe("user/model");
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: undefined,
        threadOverride: undefined,
      }),
    ).toBe("user/model");
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "",
        threadOverride: "",
      }),
    ).toBe("user/model");
  });

  it("DEFAULT_MODEL used when userPreference is empty string", () => {
    expect(
      resolveAgentModel({
        userPreference: "",
        skillModel: null,
        threadOverride: null,
      }),
    ).toBe(DEFAULT_MODEL);
  });

  it("ignores whitespace-only at any level", () => {
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "skill/model",
        threadOverride: "   ",
      }),
    ).toBe("skill/model");
    expect(
      resolveAgentModel({
        userPreference: "user/model",
        skillModel: "  \t ",
        threadOverride: "\n",
      }),
    ).toBe("user/model");
    expect(
      resolveAgentModel({
        userPreference: "   ",
        skillModel: null,
        threadOverride: null,
      }),
    ).toBe(DEFAULT_MODEL);
  });

  it("DEFAULT_MODEL value matches 1.3a migration default", () => {
    expect(DEFAULT_MODEL).toBe("openai/gpt-5.4-nano");
  });

  it("returns userPreference exactly when set and others null", () => {
    expect(
      resolveAgentModel({
        userPreference: "openai/gpt-5",
        skillModel: null,
        threadOverride: null,
      }),
    ).toBe("openai/gpt-5");
  });
});
