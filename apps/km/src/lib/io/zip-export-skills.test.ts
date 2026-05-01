// @vitest-environment node
// Unit test for appendPersonalSkills — verifies the zip contains only
// personal slugs, not system skills.
import { afterEach, describe, expect, it } from "vitest";
import archiver from "archiver";
import unzipper from "unzipper";
import {
  __resetSkillStoreForTests,
  type SkillStore,
  type SkillManifest,
} from "@/lib/skills-store";
import { appendPersonalSkills } from "./zip-export";

function fakeStore(entries: Array<[string, string, string]>): SkillStore {
  const data = new Map<string, string>();
  for (const [uid, slug, content] of entries) data.set(`${uid}::${slug}`, content);
  return {
    async list(userId) {
      const out: SkillManifest[] = [];
      for (const [k, v] of data) {
        const [uid, slug] = k.split("::");
        if (uid !== userId) continue;
        let parsed: { name?: string; description?: string; instructions?: string };
        try {
          parsed = JSON.parse(v);
        } catch {
          parsed = {};
        }
        out.push({
          slug,
          name: parsed.name || slug,
          description: parsed.description ?? "",
          instructions: parsed.instructions ?? "",
        });
      }
      return out;
    },
    async read(userId, slug) {
      const v = data.get(`${userId}::${slug}`);
      if (v === undefined) throw new Error("NoSuchKey");
      return v;
    },
    async write() {},
    async delete() {},
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

afterEach(() => {
  __resetSkillStoreForTests();
});

describe("appendPersonalSkills", () => {
  it("appends only personal slugs, naming them skills/<slug>/SKILL.json", async () => {
    __resetSkillStoreForTests(
      fakeStore([
        ["u1", "tone", JSON.stringify({ name: "Tone", description: "", instructions: "" })],
        ["u1", "voice", JSON.stringify({ name: "Voice", description: "", instructions: "" })],
        ["u2", "other-user", JSON.stringify({ name: "Other", description: "", instructions: "" })],
      ]),
    );
    const arc = archiver("zip");
    const collect = streamToBuffer(arc);
    await appendPersonalSkills(arc, "u1");
    arc.finalize();
    const buf = await collect;
    const dir = await unzipper.Open.buffer(buf);
    const paths = dir.files.map((f) => f.path).sort();
    expect(paths).toEqual(["skills/tone/SKILL.json", "skills/voice/SKILL.json"]);

    // System skill names should NOT appear (system list excluded by contract).
    expect(paths.some((p) => p === "skills/synthesis/SKILL.json")).toBe(false);
    expect(paths.some((p) => p === "skills/paper-search/SKILL.json")).toBe(false);
  });
});