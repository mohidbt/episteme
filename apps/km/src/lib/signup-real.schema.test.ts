// Pure-schema unit tests for signupExtrasSchema / signupWaitlistSchema.
// Run without DB; covers university field gating.
import { describe, expect, it } from "vitest";
import { signupExtrasSchema, signupWaitlistSchema } from "./signup-real";

const base = {
  firstname: "Alex",
  email: "alex@example.com",
  password: "supersecret1",
  username: "alex-99",
  pokemon: "charmander" as const,
  inviteCode: "INVITE-ABC",
};

describe("signupExtrasSchema — university", () => {
  it("accepts university when userType is student", () => {
    const r = signupExtrasSchema.safeParse({
      ...base,
      userType: "student",
      studentLevel: "Master",
      university: "MIT",
    });
    expect(r.success).toBe(true);
  });

  it("accepts university when userType is researcher", () => {
    const r = signupExtrasSchema.safeParse({
      ...base,
      userType: "researcher",
      jobRole: "Principal investigator",
      university: "Stanford",
    });
    expect(r.success).toBe(true);
  });

  it("accepts missing university for student (optional)", () => {
    const r = signupExtrasSchema.safeParse({
      ...base,
      userType: "student",
      studentLevel: "Master",
    });
    expect(r.success).toBe(true);
  });

  it("rejects university over 200 chars", () => {
    const r = signupExtrasSchema.safeParse({
      ...base,
      userType: "student",
      studentLevel: "Master",
      university: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });
});

describe("signupWaitlistSchema — university", () => {
  it("accepts university for waitlist student entry", () => {
    const r = signupWaitlistSchema.safeParse({
      firstname: "Wendy",
      email: "wendy@test.local",
      username: "wendy-one",
      userType: "student",
      studentLevel: "Bachelor",
      pokemon: "squirtle",
      university: "Oxford",
    });
    expect(r.success).toBe(true);
  });
});
