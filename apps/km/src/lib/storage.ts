import { createStorage } from "@episteme/storage";
import { resolveStorageConfig } from "@/lib/storage-config";

export const storageConfig = resolveStorageConfig();

export const S3_BUCKET = storageConfig.bucket;

export const storage = createStorage(storageConfig);

export function paperSourceKey(paperId: string): string {
  return `${paperId}/source.pdf`;
}

export function paperCoverKey(paperId: string): string {
  return `${paperId}/cover.png`;
}

export function assetSourceKey(assetId: string): string {
  return `assets/${assetId}`;
}
