import { describe, expect, it } from "vitest";
import { resolveAppDatabaseUrl } from "../database-url";

describe("resolveAppDatabaseUrl", () => {
  it("uses the least-privilege runtime credential when present", () => {
    expect(
      resolveAppDatabaseUrl({
        NODE_ENV: "production",
        APP_RUNTIME_DATABASE_URL: "postgres://runtime/db",
        DATABASE_URL: "postgres://owner/db",
      }),
    ).toEqual({ url: "postgres://runtime/db", usedFallback: false });
  });

  it.each([undefined, "", "   "])(
    "fails closed in production when APP_RUNTIME_DATABASE_URL is %j",
    (appUrl) => {
      expect(() =>
        resolveAppDatabaseUrl({
          NODE_ENV: "production",
          APP_RUNTIME_DATABASE_URL: appUrl,
          DATABASE_URL: "postgres://owner/db",
        }),
      ).toThrow(/APP_RUNTIME_DATABASE_URL is required in production/);
    },
  );

  it("allows DATABASE_URL as an explicit local/test fallback", () => {
    expect(
      resolveAppDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://local/db",
      }),
    ).toEqual({ url: "postgres://local/db", usedFallback: true });
  });
});
