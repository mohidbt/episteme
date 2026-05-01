// @vitest-environment node
// Unit test for appendPersonalSkills — verifies the zip contains only
// personal slugs, not system skills.
import { afterEach, describe, expect, it } from "vitest";
import archiver from "archiver";
import unzipper from "unzipper";
import {
  __resetSkillStoreForTests,
  type SkillStore,
} from "@/lib/skills-store";
import { appendPersonalSkills } from "./zip-export";

function fakeStore(entries: Array<[string, string, string]>): SkillStore {
  const data = new Map<string, string>();
  for (const [uid, slug, md] of entries) data.set(`${uid}::${slug}`, md);
  return {
    async list(userId) {
      const out = [];
      for (const [k] of data) {
        const [uid, slug] = k.split("::");
        if (uid !== userId) continue;
        out.push({ slug, name: slug, description: "", category: "writing" as const });
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
  it("appends only personal slugs, naming them skills/<slug>/SKILL.md", async () => {
    __resetSkillStoreForTests(
      fakeStore([
        ["u1", "tone", "---\nname: Tone\n---\n# Tone\n"],
        ["u1", "voice", "---\nname: Voice\n---\n# Voice\n"],
        ["u2", "other-user", "---\nname: Other\n---\n"], // different user
      ]),
    );
    const arc = archiver("zip");
    const collect = streamToBuffer(arc);
    await appendPersonalSkills(arc, "u1");
    arc.finalize();
    const buf = await collect;
    const dir = await unzipper.Open.buffer(buf);
    const paths = dir.files.map((f) => f.path).sort();
    expect(paths).toEqual(["skills/tone/SKILL.md", "skills/voice/SKILL.md"]);

    // System skill names should NOT appear (system list excluded by contract).
    expect(paths.some((p) => p === "skills/synthesis/SKILL.md")).toBe(false);
    expect(paths.some((p) => p === "skills/paper-search/SKILL.md")).toBe(false);
  });
});
