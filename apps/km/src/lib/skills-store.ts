// Personal-skills storage abstraction.
//
// Phase 1 (now): MinioSkillStore — keys `skills/users/<userId>/<slug>/SKILL.md`.
// Phase 2 (future Tauri): LocalFsSkillStore reading `~/Episteme/skills/<slug>/SKILL.md`.
// The factory `getSkillStore()` lets us swap impls without touching call sites.
// The contract: the on-disk format (SKILL.md + frontmatter) is identical to
// system skills shipped under `services/agents/skills/*` — so personal skills
// round-trip and become grepable by the agent's drive tools for free in Phase 2.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import matter from "gray-matter";
import { S3_BUCKET } from "@/lib/storage";

export type SkillCategory = "writing" | "research";

export interface SkillManifest {
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
}

export interface SkillStore {
  list(userId: string): Promise<SkillManifest[]>;
  read(userId: string, slug: string): Promise<string>;
  write(userId: string, slug: string, md: string): Promise<void>;
  delete(userId: string, slug: string): Promise<void>;
}

export function userPrefix(userId: string): string {
  return `skills/users/${userId}/`;
}

export function skillKey(userId: string, slug: string): string {
  return `${userPrefix(userId)}${slug}/SKILL.md`;
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

export function parseManifest(slug: string, md: string): SkillManifest {
  const { data } = matter(md);
  const name = typeof data.name === "string" && data.name.trim() ? data.name : slug;
  const description = typeof data.description === "string" ? data.description : "";
  const rawCategory = typeof data.category === "string" ? data.category : "writing";
  const category: SkillCategory =
    rawCategory === "research" ? "research" : "writing";
  return { slug, name, description, category };
}

export function defaultSkillBody(name: string): string {
  // Mirrors deep-agents SKILL.md format: yaml frontmatter + body. Sparse on
  // purpose — user fills in the rest in the editor.
  return [
    "---",
    `name: ${name}`,
    "description: ",
    "category: writing",
    "---",
    "",
    `# ${name}`,
    "",
    "",
  ].join("\n");
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
        if (!obj.Key || !obj.Key.endsWith("/SKILL.md")) continue;
        const slug = obj.Key.slice(prefix.length, -"/SKILL.md".length);
        if (!slug || slug.includes("/")) continue;
        try {
          const md = await this.read(userId, slug);
          out.push(parseManifest(slug, md));
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

  async write(userId: string, slug: string, md: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: skillKey(userId, slug),
        Body: md,
        ContentType: "text/markdown",
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
