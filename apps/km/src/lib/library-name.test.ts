import { describe, expect, it } from "vitest";
import { deriveLibraryName } from "./library-name";

describe("deriveLibraryName", () => {
  it("derives '{first}'s Library' from a full name", () => {
    expect(deriveLibraryName({ name: "Mohid Butt" })).toBe("Mohid's Library");
  });

  it("falls back to 'My Library' when name is null", () => {
    expect(deriveLibraryName({ name: null })).toBe("My Library");
  });

  it("falls back to 'My Library' when name is whitespace-only", () => {
    expect(deriveLibraryName({ name: "   " })).toBe("My Library");
  });

  it("falls back to 'My Library' when name is undefined", () => {
    expect(deriveLibraryName({})).toBe("My Library");
  });

  it("handles a single-token name", () => {
    expect(deriveLibraryName({ name: "Mohid" })).toBe("Mohid's Library");
  });
});
