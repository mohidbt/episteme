import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createThread,
  listThreadsForUser,
  getThread,
  updateThread,
  deleteThread,
} from "./threads";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";

let u: TestUser;
let v: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  v = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(v.id);
});

describe("createThread", () => {
  it("creates a thread with generated UUID and idle status", async () => {
    const t = await createThread({ userId: u.id });
    expect(t.threadId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(t.userId).toBe(u.id);
    expect(t.status).toBe("idle");
    expect(t.title).toBeNull();
    expect(t.skill).toBeNull();
    expect(t.modelOverride).toBeNull();
    expect(t.lastMessageAt).toBeNull();
    expect(t.createdAt).toBeInstanceOf(Date);
  });

  it("respects an explicit threadId and optional fields", async () => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const t = await createThread({
      userId: u.id,
      threadId: id,
      skill: "lit-triage",
      modelOverride: "openai/gpt-4o-mini",
      title: "Hello",
    });
    expect(t.threadId).toBe(id);
    expect(t.skill).toBe("lit-triage");
    expect(t.modelOverride).toBe("openai/gpt-4o-mini");
    expect(t.title).toBe("Hello");
  });
});

describe("listThreadsForUser", () => {
  it("orders by lastMessageAt DESC NULLS LAST, createdAt DESC", async () => {
    const w = await createTestUser();
    try {
      const a = await createThread({ userId: w.id, title: "A" });
      const b = await createThread({ userId: w.id, title: "B" });
      const c = await createThread({ userId: w.id, title: "C" });

      // a: lastMessageAt = older; b: lastMessageAt = newer; c: null
      await updateThread(w.id, a.threadId, { lastMessageAt: new Date(Date.now() - 60_000) });
      await updateThread(w.id, b.threadId, { lastMessageAt: new Date() });

      const list = await listThreadsForUser(w.id);
      const ids = list.map((t) => t.threadId);
      expect(ids[0]).toBe(b.threadId);
      expect(ids[1]).toBe(a.threadId);
      expect(ids[2]).toBe(c.threadId);
    } finally {
      await deleteTestUser(w.id);
    }
  });
});

describe("getThread", () => {
  it("returns null for unknown thread", async () => {
    expect(await getThread(u.id, "nope")).toBeNull();
  });

  it("scopes by userId — user A cannot read user B's thread", async () => {
    const t = await createThread({ userId: v.id, title: "Vs thread" });
    expect(await getThread(u.id, t.threadId)).toBeNull();
    const own = await getThread(v.id, t.threadId);
    expect(own?.title).toBe("Vs thread");
  });
});

describe("updateThread", () => {
  it("updates title and advances updatedAt", async () => {
    const t = await createThread({ userId: u.id, title: "old" });
    await new Promise((r) => setTimeout(r, 10));
    const next = await updateThread(u.id, t.threadId, { title: "new" });
    expect(next?.title).toBe("new");
    expect(next!.updatedAt.getTime()).toBeGreaterThan(t.updatedAt.getTime());
  });

  it("updates status to running", async () => {
    const t = await createThread({ userId: u.id });
    const next = await updateThread(u.id, t.threadId, { status: "running" });
    expect(next?.status).toBe("running");
  });

  it("returns null when not found", async () => {
    expect(await updateThread(u.id, "missing", { title: "x" })).toBeNull();
  });

  it("does not mutate other users' rows", async () => {
    const t = await createThread({ userId: v.id, title: "V" });
    const r = await updateThread(u.id, t.threadId, { title: "hijack" });
    expect(r).toBeNull();
    const reread = await getThread(v.id, t.threadId);
    expect(reread?.title).toBe("V");
  });
});

describe("deleteThread", () => {
  it("deletes and reports true; second delete returns false", async () => {
    const t = await createThread({ userId: u.id });
    expect(await deleteThread(u.id, t.threadId)).toBe(true);
    expect(await deleteThread(u.id, t.threadId)).toBe(false);
    expect(await getThread(u.id, t.threadId)).toBeNull();
  });
});
