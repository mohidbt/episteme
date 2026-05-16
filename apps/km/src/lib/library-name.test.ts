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

  // D4 regression: when the `firstname` column is populated we prefer it
  // over the historical `name`-parse path. Both real-signup (firstname set)
  // and legacy / anon (firstname null → fall back to name) keep working.
  it("prefers firstname over parsing name when present", () => {
    expect(
      deriveLibraryName({ firstname: "Alex", name: "Mohid Butt" }),
    ).toBe("Alex's Library");
  });

  it("falls back to name parsing when firstname is blank", () => {
    expect(
      deriveLibraryName({ firstname: "   ", name: "Mohid Butt" }),
    ).toBe("Mohid's Library");
  });

  it("falls back to name parsing when firstname is undefined", () => {
    expect(deriveLibraryName({ name: "Mohid Butt" })).toBe("Mohid's Library");
  });
});
