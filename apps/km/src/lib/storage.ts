import { createStorage } from "@episteme/storage";

const env = (k: string, d?: string) => process.env[k] ?? d;

export const S3_BUCKET = env("S3_BUCKET", "episteme-dev")!;

export const storage = createStorage({
  endpoint: env("S3_ENDPOINT", "http://localhost:9000")!,
  bucket: S3_BUCKET,
  accessKey: env("S3_ACCESS_KEY", "episteme")!,
  secretKey: env("S3_SECRET_KEY", "episteme-dev")!,
  region: env("S3_REGION", "us-east-1"),
  forcePathStyle: true,
});

export function paperSourceKey(paperId: string): string {
  return `${paperId}/source.pdf`;
}

export function paperCoverKey(paperId: string): string {
  return `${paperId}/cover.png`;
}
