import { describe, expect, it } from "vitest";
import { isValidThreadId, THREAD_ID_RE } from "./thread-id";

describe("isValidThreadId", () => {
  it("accepts a crypto.randomUUID() value", () => {
    expect(isValidThreadId("3f1d2c4a-9b8e-4c7a-a1b2-c3d4e5f60718")).toBe(true);
  });

  it("accepts url-safe base64 alphabet", () => {
    expect(isValidThreadId("abcDEF123_-")).toBe(true);
  });

  it.each(["#", "?", "/", " ", "a b", "a#b", "a?b", "a/b", "a.b", "a~b"])(
    "rejects transport-unsafe char in %j",
    (v) => {
      expect(isValidThreadId(v)).toBe(false);
    },
  );

  it("rejects empty and over-length", () => {
    expect(isValidThreadId("")).toBe(false);
    expect(isValidThreadId("a".repeat(256))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidThreadId(null)).toBe(false);
    expect(isValidThreadId(123)).toBe(false);
  });

  it("regex is anchored (no partial match)", () => {
    expect(THREAD_ID_RE.test("ok\nbad")).toBe(false);
  });
});
