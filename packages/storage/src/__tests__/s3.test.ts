import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import { createStorage, type StorageConfig } from "../s3";

const CFG: StorageConfig = {
  endpoint: "http://localhost:9000",
  bucket: "episteme-dev",
  accessKey: "episteme",
  secretKey: "episteme-dev",
  region: "us-east-1",
  forcePathStyle: true,
};

async function waitForBucket(cfg: StorageConfig, timeoutMs = 30_000): Promise<void> {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`bucket ${cfg.bucket} not ready within ${timeoutMs}ms`);
}

describe("createStorage - presigned URLs (unit)", () => {
  const storage = createStorage(CFG);

  it("getPresignedPut returns a URL with X-Amz-Signature, matching expiry and host", async () => {
    const signed = await storage.getPresignedPut(
      "foo.pdf",
      "application/pdf",
      300,
    );
    const url = new URL(signed);
    expect(url.host).toBe("localhost:9000");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("getPresignedGet returns a URL with X-Amz-Signature and matching expiry", async () => {
    const signed = await storage.getPresignedGet("foo.pdf", 600);
    const url = new URL(signed);
    expect(url.host).toBe("localhost:9000");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });
});

describe("createStorage - round trip against MinIO (integration)", () => {
  const storage = createStorage(CFG);
  const key = `test/round-trip-${Date.now()}-${randomBytes(4).toString("hex")}.bin`;

  beforeAll(async () => {
    const res = spawnSync(
      "docker",
      ["compose", "up", "-d", "minio", "minio-init"],
      {
        cwd: new URL("../../../..", import.meta.url).pathname,
        stdio: "inherit",
      },
    );
    if (res.status !== 0) {
      throw new Error(`docker compose up failed with status ${res.status}`);
    }
    await waitForBucket(CFG);
  });

  it("uploads, fetches via presigned GET, then deletes", async () => {
    const bytes = randomBytes(1024);
    await storage.uploadObject(key, bytes, "application/octet-stream");

    const getUrl = await storage.getPresignedGet(key, 60);
    const res = await fetch(getUrl);
    expect(res.status).toBe(200);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got.length).toBe(1024);
    expect(Buffer.from(got).equals(bytes)).toBe(true);

    await storage.deleteObject(key);

    const getUrl2 = await storage.getPresignedGet(key, 60);
    const res2 = await fetch(getUrl2);
    expect(res2.status).toBe(404);
  });
});
