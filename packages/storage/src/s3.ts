import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  forcePathStyle?: boolean;
}

export interface Storage {
  uploadObject(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<void>;
  getPresignedPut(
    key: string,
    contentType: string,
    expiresInSec: number,
  ): Promise<string>;
  getPresignedGet(key: string, expiresInSec: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

export function createStorage(cfg: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region ?? "us-east-1",
    forcePathStyle: cfg.forcePathStyle ?? true,
    credentials: {
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
    },
  });

  return {
    async uploadObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async getPresignedPut(key, contentType, expiresInSec) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: expiresInSec },
      );
    },

    async getPresignedGet(key, expiresInSec) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
        { expiresIn: expiresInSec },
      );
    },

    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
    },
  };
}
