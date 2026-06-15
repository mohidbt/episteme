import { describe, expect, it } from "vitest";
import {
  deriveUsernameBase,
  isReservedUsername,
  isValidUsername,
  RESERVED,
} from "./username";

describe("isValidUsername", () => {
  it("accepts lowercase+digits+hyphens, 3–30 chars", () => {
    expect(isValidUsername("mohid")).toBe(true);
    expect(isValidUsername("foo-bar-123")).toBe(true);
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("a".repeat(30))).toBe(true);
  });
  it("rejects uppercase, underscores, too short, too long", () => {
    expect(isValidUsername("Mohid")).toBe(false);
    expect(isValidUsername("foo_bar")).toBe(false);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(31))).toBe(false);
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("-foo")).toBe(true);
  });
  it("rejects reserved names", () => {
    expect(isValidUsername("app")).toBe(false);
    expect(isValidUsername("www")).toBe(false);
    expect(isValidUsername("api")).toBe(false);
  });
  it("rejects newly expanded reserved names (app routes)", () => {
    expect(isValidUsername("sign-in")).toBe(false);
    expect(isValidUsername("sign-up")).toBe(false);
    expect(isValidUsername("settings")).toBe(false);
    expect(isValidUsername("agents")).toBe(false);
    expect(isValidUsername("drive")).toBe(false);
    expect(isValidUsername("graph")).toBe(false);
    expect(isValidUsername("papers")).toBe(false);
    expect(isValidUsername("papersets")).toBe(false);
    expect(isValidUsername("notes")).toBe(false);
    expect(isValidUsername("tags")).toBe(false);
    expect(isValidUsername("trash")).toBe(false);
    expect(isValidUsername("references")).toBe(false);
    expect(isValidUsername("pub")).toBe(false);
    expect(isValidUsername("inbox")).toBe(false);
    expect(isValidUsername("library")).toBe(false);
    expect(isValidUsername("search")).toBe(false);
    expect(isValidUsername("feedback")).toBe(false);
    expect(isValidUsername("monitoring")).toBe(false);
    expect(isValidUsername("health")).toBe(false);
  });
  it("rejects newly expanded reserved names (backend conventions)", () => {
    expect(isValidUsername("root")).toBe(false);
    expect(isValidUsername("support")).toBe(false);
    expect(isValidUsername("help")).toBe(false);
    expect(isValidUsername("about")).toBe(false);
    expect(isValidUsername("contact")).toBe(false);
    expect(isValidUsername("legal")).toBe(false);
    expect(isValidUsername("privacy")).toBe(false);
    expect(isValidUsername("terms")).toBe(false);
    expect(isValidUsername("security")).toBe(false);
    expect(isValidUsername("abuse")).toBe(false);
    expect(isValidUsername("postmaster")).toBe(false);
    expect(isValidUsername("hostmaster")).toBe(false);
    expect(isValidUsername("webmaster")).toBe(false);
    expect(isValidUsername("no-reply")).toBe(false);
    expect(isValidUsername("noreply")).toBe(false);
    expect(isValidUsername("system")).toBe(false);
    expect(isValidUsername("null")).toBe(false);
    expect(isValidUsername("undefined")).toBe(false);
    expect(isValidUsername("mail")).toBe(false);
    expect(isValidUsername("ftp")).toBe(false);
    expect(isValidUsername("ssh")).toBe(false);
    expect(isValidUsername("billing")).toBe(false);
    expect(isValidUsername("status")).toBe(false);
    expect(isValidUsername("blog")).toBe(false);
    expect(isValidUsername("dev")).toBe(false);
    expect(isValidUsername("staging")).toBe(false);
    expect(isValidUsername("prod")).toBe(false);
    expect(isValidUsername("test")).toBe(false);
    expect(isValidUsername("info")).toBe(false);
    expect(isValidUsername("news")).toBe(false);
    expect(isValidUsername("careers")).toBe(false);
    expect(isValidUsername("jobs")).toBe(false);
    expect(isValidUsername("press")).toBe(false);
    expect(isValidUsername("team")).toBe(false);
    expect(isValidUsername("oauth")).toBe(false);
    expect(isValidUsername("sso")).toBe(false);
    expect(isValidUsername("login")).toBe(false);
    expect(isValidUsername("logout")).toBe(false);
    expect(isValidUsername("register")).toBe(false);
    expect(isValidUsername("signup")).toBe(false);
    expect(isValidUsername("signin")).toBe(false);
    expect(isValidUsername("dashboard")).toBe(false);
    expect(isValidUsername("account")).toBe(false);
    expect(isValidUsername("profile")).toBe(false);
    expect(isValidUsername("user")).toBe(false);
    expect(isValidUsername("users")).toBe(false);
    expect(isValidUsername("me")).toBe(false);
    expect(isValidUsername("you")).toBe(false);
    expect(isValidUsername("anonymous")).toBe(false);
    expect(isValidUsername("guest")).toBe(false);
    expect(isValidUsername("public")).toBe(false);
    expect(isValidUsername("private")).toBe(false);
  });
});

describe("RESERVED ordering", () => {
  it("is alphabetized", () => {
    const arr = Array.from(RESERVED);
    const sorted = [...arr].sort();
    expect(arr).toEqual(sorted);
  });
});

describe("isReservedUsername", () => {
  it("covers the full RESERVED set", () => {
    for (const name of RESERVED) {
      expect(isReservedUsername(name)).toBe(true);
    }
    expect(isReservedUsername("mohid")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isReservedUsername("App")).toBe(true);
    expect(isReservedUsername("API")).toBe(true);
  });
});

describe("deriveUsernameBase", () => {
  it("slugifies the name", () => {
    expect(
      deriveUsernameBase({ name: "Test User", email: null, userId: "u1" }),
    ).toBe("test-user");
  });
  it("falls back to email local-part when name is missing", () => {
    expect(
      deriveUsernameBase({
        name: null,
        email: "alice.smith@example.com",
        userId: "u1",
      }),
    ).toBe("alice-smith");
  });
  it("collapses non-alphanumerics", () => {
    expect(
      deriveUsernameBase({ name: "Möhid F. Bütt", email: null, userId: "u1" }),
    ).toBe("mo-hid-f-bu-tt");
  });
  it("falls back to userId tail when name + email yield no slug", () => {
    expect(
      deriveUsernameBase({ name: " ", email: "", userId: "u_CAFEBABE12" }),
    ).toBe("user-febabe12");
  });
  it("skips reserved slugs and falls through", () => {
    expect(
      deriveUsernameBase({ name: "api", email: null, userId: "uABCDEF" }),
    ).toBe("user-uabcdef");
  });
});
