import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
  getPresignedHead(key: string, expiresInSec: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  /**
   * GSD-135: HEAD probe for orphan-source-pdf inventory + defensive
   * prechecks. Returns false on 404/NotFound/NoSuchKey, true on 200.
   * Re-throws other ClientErrors (auth, network) so the caller doesn't
   * silently treat permission failures as missing objects.
   */
  objectExists(key: string): Promise<boolean>;
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

    async getPresignedHead(key, expiresInSec) {
      return getSignedUrl(
        client,
        new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
        { expiresIn: expiresInSec },
      );
    },

    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
    },

    async objectExists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
        );
        return true;
      } catch (err: unknown) {
        const e = err as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (
          e?.$metadata?.httpStatusCode === 404 ||
          e?.name === "NotFound" ||
          e?.name === "NoSuchKey"
        ) {
          return false;
        }
        throw err;
      }
    },
  };
}
