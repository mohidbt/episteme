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
    expect(skillKey("u1", "my-skill")).toBe("skills/users/u1/my-skill/SKILL.json");
  });
});

describe("parseManifest", () => {
  it("falls back when JSON is malformed", () => {
    const m = parseManifest("foo", "# foo\n\nhello");
    expect(m).toEqual({
      slug: "foo",
      name: "foo",
      description: "",
      instructions: "",
    });
  });
  it("reads name/description/instructions from JSON", () => {
    const json = JSON.stringify({ name: "My Skill", description: "Does a thing", instructions: "Do X then Y" });
    const m = parseManifest("my-skill", json);
    expect(m).toEqual({
      slug: "my-skill",
      name: "My Skill",
      description: "Does a thing",
      instructions: "Do X then Y",
    });
  });
  it("falls back to slug when name is empty", () => {
    const json = JSON.stringify({ name: "", description: "", instructions: "" });
    const m = parseManifest("x", json);
    expect(m.name).toBe("x");
  });
});

describe("defaultSkillBody", () => {
  it("returns valid JSON with name field", () => {
    const body = defaultSkillBody("My Skill");
    const parsed = JSON.parse(body);
    expect(parsed.name).toBe("My Skill");
    expect(parsed.description).toBe("");
    expect(parsed.instructions).toBe("");
  });
});

describe("MinioSkillStore — round trip", () => {
  let store: MinioSkillStore;
  beforeEach(() => {
    store = new MinioSkillStore(makeFakeClient(), "test-bucket");
  });

  it("write → read returns same body", async () => {
    const json = JSON.stringify({ name: "t", description: "", instructions: "" });
    await store.write("u1", "t", json);
    expect(await store.read("u1", "t")).toBe(json);
  });

  it("list returns manifests for the user only", async () => {
    await store.write("u1", "alpha", JSON.stringify({ name: "Alpha", description: "", instructions: "" }));
    await store.write("u1", "beta", JSON.stringify({ name: "Beta", description: "Research skill", instructions: "Do research" }));
    await store.write("u2", "gamma", JSON.stringify({ name: "Gamma", description: "", instructions: "" }));
    const list = await store.list("u1");
    expect(list.map((s) => s.slug)).toEqual(["alpha", "beta"]);
    expect(list.find((s) => s.slug === "beta")?.instructions).toBe("Do research");
  });

  it("delete removes the skill", async () => {
    await store.write("u1", "tmp", JSON.stringify({ name: "T", description: "", instructions: "" }));
    await store.delete("u1", "tmp");
    const list = await store.list("u1");
    expect(list).toEqual([]);
  });
});