import { spawnSync } from "node:child_process";
import { storage, paperSourceKey } from "@/lib/storage";

// This file lives at apps/km/src/app/api/_minio-setup.ts — the repo root is
// five directory levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname;

async function waitForBucket(timeoutMs = 30_000): Promise<void> {
  // Probe the bucket by issuing a HEAD for a guaranteed-missing key with a
  // HEAD-signed URL. MinIO returns 404 for missing objects once the bucket
  // exists, other statuses / connection errors while still coming up.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = await storage.getPresignedHead(
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
 *
 * If a MinIO is already healthy at $S3_ENDPOINT (e.g. main-branch's MinIO
 * reused from a worktree), skip compose — starting a second instance on
 * the same host port would clash.
 */
export async function ensureMinIOReady(): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) {
    try {
      const res = await fetch(`${endpoint}/minio/health/ready`);
      if (res.ok) {
        await waitForBucket();
        return;
      }
    } catch {
      // fall through to compose
    }
  }
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
