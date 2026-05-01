// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  MinioSkillStore,
  parseManifest,
  defaultSkillBody,
  skillKey,
  userPrefix,
} from "./skills-store";

// In-memory fake S3 client compatible with the small subset of commands the
// store uses.
function makeFakeClient() {
  const store = new Map<string, string>();
  const client = {
    store,
    async send(cmd: { input: Record<string, unknown>; constructor: { name: string } }) {
      const name = cmd.constructor.name;
      const input = cmd.input;
      if (name === "PutObjectCommand") {
        const body = input.Body;
        store.set(input.Key as string, typeof body === "string" ? body : String(body));
        return {};
      }
      if (name === "GetObjectCommand") {
        const v = store.get(input.Key as string);
        if (v === undefined) {
          const err = new Error("NoSuchKey");
          (err as Error & { name: string }).name = "NoSuchKey";
          throw err;
        }
        return {
          Body: { transformToString: async () => v },
        };
      }
      if (name === "DeleteObjectCommand") {
        store.delete(input.Key as string);
        return {};
      }
      if (name === "ListObjectsV2Command") {
        const prefix = (input.Prefix as string) ?? "";
        const Contents = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((Key) => ({ Key }));
        return { Contents, IsTruncated: false };
      }
      throw new Error(`unsupported command ${name}`);
    },
  };
  // Cast to S3Client compatible type
  return client as unknown as ConstructorParameters<typeof MinioSkillStore>[0];
}

describe("skill key helpers", () => {
  it("userPrefix is per-user", () => {
    expect(userPrefix("u1")).toBe("skills/users/u1/");
  });
  it("skillKey nests slug under user", () => {
    expect(skillKey("u1", "my-skill")).toBe("skills/users/u1/my-skill/SKILL.md");
  });
});

describe("parseManifest", () => {
  it("falls back when frontmatter is missing", () => {
    const m = parseManifest("foo", "# foo\n\nhello");
    expect(m).toEqual({
      slug: "foo",
      name: "foo",
      description: "",
      category: "writing",
    });
  });
  it("reads name/description/category from frontmatter", () => {
    const md = `---\nname: My Skill\ndescription: Does a thing\ncategory: research\n---\n\nbody`;
    const m = parseManifest("my-skill", md);
    expect(m).toEqual({
      slug: "my-skill",
      name: "My Skill",
      description: "Does a thing",
      category: "research",
    });
  });
  it("rejects unknown category", () => {
    const md = `---\nname: x\ncategory: bogus\n---\n`;
    const m = parseManifest("x", md);
    expect(m.category).toBe("writing");
  });
});

describe("defaultSkillBody", () => {
  it("includes name in frontmatter and heading", () => {
    const body = defaultSkillBody("My Skill");
    expect(body).toContain("name: My Skill");
    expect(body).toContain("# My Skill");
    expect(body).toContain("category: writing");
  });
});

describe("MinioSkillStore — round trip", () => {
  let store: MinioSkillStore;
  beforeEach(() => {
    store = new MinioSkillStore(makeFakeClient(), "test-bucket");
  });

  it("write → read returns same body", async () => {
    const md = "---\nname: t\n---\nhi";
    await store.write("u1", "t", md);
    expect(await store.read("u1", "t")).toBe(md);
  });

  it("list returns manifests for the user only", async () => {
    await store.write("u1", "alpha", "---\nname: Alpha\n---\n");
    await store.write("u1", "beta", "---\nname: Beta\ncategory: research\n---\n");
    await store.write("u2", "gamma", "---\nname: Gamma\n---\n");
    const list = await store.list("u1");
    expect(list.map((s) => s.slug)).toEqual(["alpha", "beta"]);
    expect(list.find((s) => s.slug === "beta")?.category).toBe("research");
  });

  it("delete removes the skill", async () => {
    await store.write("u1", "tmp", "---\nname: T\n---\n");
    await store.delete("u1", "tmp");
    const list = await store.list("u1");
    expect(list).toEqual([]);
  });
});
