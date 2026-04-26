import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_LIB } from "../../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "NoteFromFile Lib" }) }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

function fileFrom(content: string, name: string, type = "text/markdown"): File {
  return new File([content], name, { type });
}

function fromFileReq(form: FormData, cookie?: string): Request {
  return req("/api/notes/from-file", { method: "POST", cookie, body: form });
}

describe("notes/from-file", () => {
  it("401 when no cookie", async () => {
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom("# Hello\nContent", "hello.md"));
    const r = await POST(fromFileReq(form));
    expect(r.status).toBe(401);
  });

  it("creates note with title from # heading", async () => {
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom("# My Great Note\nThis is the body.", "great.md"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.title).toBe("My Great Note");
    expect(body.contentMd).toBe("This is the body.");
    expect(body.slug).toBe("my-great-note");

    const rows = await db.select().from(notes).where(eq(notes.id, body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("My Great Note");
  });

  it("creates note with title from filename when no # heading", async () => {
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom("Some content without heading.", "my-note-file.md"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.title).toBe("my-note-file");
    expect(body.contentMd).toBe("Some content without heading.");
  });

  it("creates note from .txt file", async () => {
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom("# Text Note\nHello text.", "note.txt", "text/plain"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.title).toBe("Text Note");
  });

  it("note created by user A is not visible to user B", async () => {
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom("# Secret\nPrivate.", "secret.md"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();

    const rows = await db.select().from(notes).where(eq(notes.id, body.id));
    expect(rows[0].userId).toBe(u.id);
    expect(rows[0].userId).not.toBe(other.id);
  });

  it("400 when file is not .md / .markdown / .txt", async () => {
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom("data", "data.csv", "text/csv"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("unsupported_file_type");
  });

  it("400 when libraryId missing", async () => {
    const form = new FormData();
    form.set("file", fileFrom("# Hi", "hi.md"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(400);
  });

  it("413 when file exceeds 5 MB", async () => {
    const bigContent = "x".repeat(5 * 1024 * 1024 + 1);
    const form = new FormData();
    form.set("libraryId", String(libraryId));
    form.set("file", fileFrom(bigContent, "big.md"));
    const r = await POST(fromFileReq(form, u.cookie));
    expect(r.status).toBe(413);
  });
});
