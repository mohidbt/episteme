import { describe, expect, it } from "vitest";
import { resolveStorageConfig } from "./storage-config";

const PROD = {
  NODE_ENV: "production",
  S3_ENDPOINT: "https://objects.example.com",
  S3_BUCKET: "episteme-prod",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
};

describe("resolveStorageConfig", () => {
  it("uses local defaults only outside production", () => {
    expect(resolveStorageConfig({ NODE_ENV: "test" })).toMatchObject({
      endpoint: "http://localhost:9000",
      bucket: "episteme-dev",
      accessKey: "episteme",
      secretKey: "episteme-dev",
    });
  });

  it.each(["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"])(
    "fails closed when production %s is missing or blank",
    (key) => {
      expect(() => resolveStorageConfig({ ...PROD, [key]: "  " })).toThrow(
        `${key} is required in production`,
      );
    },
  );

  it("rejects plaintext production storage by default", () => {
    expect(() =>
      resolveStorageConfig({ ...PROD, S3_ENDPOINT: "http://objects.example.com" }),
    ).toThrow(/must use HTTPS in production/);
  });

  it("rejects endpoint URLs containing credentials", () => {
    expect(() =>
      resolveStorageConfig({
        ...PROD,
        S3_ENDPOINT: "https://user:password@objects.example.com",
      }),
    ).toThrow(/must not contain credentials/);
  });
});
