// Personal-skills storage abstraction.
//
// Skills are stored as JSON objects in MinIO under
// `skills/users/<userId>/<slug>/SKILL.json`.
//
// Shape: { name: string, description: string, instructions: string }
// — no category field. Personal skills always show in the bubble menu.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { S3_BUCKET } from "@/lib/storage";

export interface SkillManifest {
  slug: string;
  name: string;
  description: string;
  instructions: string;
}

export interface SkillStore {
  list(userId: string): Promise<SkillManifest[]>;
  read(userId: string, slug: string): Promise<string>;
  write(userId: string, slug: string, content: string): Promise<void>;
  delete(userId: string, slug: string): Promise<void>;
}

export function userPrefix(userId: string): string {
  return `skills/users/${userId}/`;
}

export function skillKey(userId: string, slug: string): string {
  return `${userPrefix(userId)}${slug}/SKILL.json`;
}

export interface SkillJson {
  name: string;
  description: string;
  instructions: string;
}

const env = (k: string, d?: string) => process.env[k] ?? d;

function buildClient(): S3Client {
  return new S3Client({
    endpoint: env("S3_ENDPOINT", "http://localhost:9000")!,
    region: env("S3_REGION", "us-east-1"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: env("S3_ACCESS_KEY", "episteme")!,
      secretAccessKey: env("S3_SECRET_KEY", "episteme-dev")!,
    },
  });
}

export function parseManifest(slug: string, json: string): SkillManifest {
  let parsed: SkillJson;
  try {
    parsed = JSON.parse(json) as SkillJson;
  } catch {
    return { slug, name: slug, description: "", instructions: "" };
  }
  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : slug;
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const instructions = typeof parsed.instructions === "string" ? parsed.instructions : "";
  return { slug, name, description, instructions };
}

export function defaultSkillBody(name: string): string {
  return JSON.stringify({ name, description: "", instructions: "" }, null, 2);
}

export class MinioSkillStore implements SkillStore {
  private client: S3Client;
  private bucket: string;

  constructor(client?: S3Client, bucket?: string) {
    this.client = client ?? buildClient();
    this.bucket = bucket ?? S3_BUCKET;
  }

  async list(userId: string): Promise<SkillManifest[]> {
    const prefix = userPrefix(userId);
    const out: SkillManifest[] = [];
    let token: string | undefined;
    do {
      const resp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (!obj.Key || !obj.Key.endsWith("/SKILL.json")) continue;
        const slug = obj.Key.slice(prefix.length, -"/SKILL.json".length);
        if (!slug || slug.includes("/")) continue;
        try {
          const content = await this.read(userId, slug);
          out.push(parseManifest(slug, content));
        } catch {
          // Skip unreadable files rather than failing the whole list.
        }
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    out.sort((a, b) => a.slug.localeCompare(b.slug));
    return out;
  }

  async read(userId: string, slug: string): Promise<string> {
    const resp = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: skillKey(userId, slug),
      }),
    );
    const body = resp.Body as { transformToString?: () => Promise<string> } | undefined;
    if (!body || !body.transformToString) return "";
    return await body.transformToString();
  }

  async write(userId: string, slug: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: skillKey(userId, slug),
        Body: content,
        ContentType: "application/json",
      }),
    );
  }

  async delete(userId: string, slug: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: skillKey(userId, slug),
      }),
    );
  }
}

let cached: SkillStore | null = null;

/**
 * Factory for the active SkillStore. Phase 1 returns MinioSkillStore.
 * Phase 2 (Tauri) will branch on env to return LocalFsSkillStore.
 */
export function getSkillStore(): SkillStore {
  if (!cached) cached = new MinioSkillStore();
  return cached;
}

/** Test-only: reset the cached singleton. */
export function __resetSkillStoreForTests(next?: SkillStore): void {
  cached = next ?? null;
}