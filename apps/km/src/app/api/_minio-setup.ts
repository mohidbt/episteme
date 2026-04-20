import { spawnSync } from "node:child_process";
import { storage, paperSourceKey } from "@/lib/storage";

// This file lives at apps/km/src/app/api/_minio-setup.ts — the repo root is
// five directory levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname;

async function waitForBucket(timeoutMs = 30_000): Promise<void> {
  // Probe the bucket by asking for a presigned GET (which requires the client
  // to be reachable) and issuing a HEAD for a guaranteed-missing key. MinIO
  // returns 404 for missing objects once the bucket exists, 403 / connection
  // error otherwise.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = await storage.getPresignedGet(
        paperSourceKey("__probe-bucket-ready__"),
        30,
      );
      const res = await fetch(url, { method: "HEAD" });
      if (res.status === 404) return;
    } catch {
      // fallthrough
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`MinIO bucket not ready within ${timeoutMs}ms`);
}

/**
 * Bring up the MinIO + minio-init compose services and block until the
 * configured bucket is reachable. Idempotent; fast on a warm daemon.
 */
export async function ensureMinIOReady(): Promise<void> {
  const res = spawnSync(
    "docker",
    ["compose", "up", "-d", "minio", "minio-init"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  if (res.status !== 0) {
    throw new Error(`docker compose up failed with status ${res.status}`);
  }
  await waitForBucket();
}
