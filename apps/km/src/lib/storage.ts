import {
  createStorage,
  type Storage,
  type StorageConfig,
} from "@episteme/storage";
import { resolveStorageConfig } from "@/lib/storage-config";

// Resolution of the S3 config (and construction of the underlying S3 client)
// is deferred to first access — NOT module load — so that `next build`, which
// imports every route module under NODE_ENV=production to collect page data,
// does not crash at import time when the required S3_* env vars are unset. The
// fail-closed guard in resolveStorageConfig() still throws here on the first
// real storage access.

// Memoized singleton — resolved once, on first property access via the Proxy.
let resolvedConfig: StorageConfig | undefined;
function getStorageConfig(): StorageConfig {
  if (!resolvedConfig) resolvedConfig = resolveStorageConfig();
  return resolvedConfig;
}

// Lazy Proxy preserves the exact StorageConfig shape (endpoint/bucket/region/
// accessKey/secretKey/forcePathStyle) and its type, so zero callers change.
// Every property read forwards to the singleton, resolving it on first touch.
export const storageConfig = new Proxy({} as StorageConfig, {
  get(_target, prop, receiver) {
    return Reflect.get(getStorageConfig(), prop, receiver);
  },
}) as StorageConfig;

// Memoized singleton — the S3 client is built once, on first method access.
let resolvedStorage: Storage | undefined;
function getStorage(): Storage {
  if (!resolvedStorage) resolvedStorage = createStorage(getStorageConfig());
  return resolvedStorage;
}

// Lazy Proxy preserves the exact Storage API (uploadObject/getPresignedGet/
// deleteObject/objectExists/...) and its types, so zero callers change. Every
// method read forwards to the singleton, constructing it on first touch.
export const storage = new Proxy({} as Storage, {
  get(_target, prop, receiver) {
    return Reflect.get(getStorage(), prop, receiver);
  },
}) as Storage;

export function paperSourceKey(paperId: string): string {
  return `${paperId}/source.pdf`;
}

export function paperCoverKey(paperId: string): string {
  return `${paperId}/cover.png`;
}

export function assetSourceKey(assetId: string): string {
  return `assets/${assetId}`;
}
