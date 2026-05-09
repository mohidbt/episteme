import { describe, it, expect, vi } from "vitest";
import { createNoteFromChat } from "./ChatCodePre";

describe("createNoteFromChat", () => {
  it("posts to /api/notes with the resolved libraryId and returns the slug", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/libraries") {
        return new Response(JSON.stringify([{ id: 7 }]), { status: 200 });
      }
      if (url === "/api/notes") {
        return new Response(
          JSON.stringify({ id: "note-1", slug: "hello-world" }),
          { status: 201 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const slug = await createNoteFromChat(
      { contentMd: "# Hello\n\nbody", title: "Hello" },
      fetchImpl,
    );

    expect(slug).toBe("hello-world");
    expect(calls).toHaveLength(2);
    const post = calls[1];
    expect(post.url).toBe("/api/notes");
    const body = JSON.parse(post.init?.body as string);
    expect(body).toMatchObject({
      libraryId: 7,
      title: "Hello",
      contentMd: "# Hello\n\nbody",
      noteType: "md",
    });
  });

  it("returns null when there are no libraries", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    ) as unknown as typeof fetch;
    const slug = await createNoteFromChat(
      { contentMd: "x", title: "x" },
      fetchImpl,
    );
    expect(slug).toBeNull();
  });

  it("returns null when /api/notes fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "/api/libraries") {
        return new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
      }
      return new Response("err", { status: 500 });
    }) as unknown as typeof fetch;
    const slug = await createNoteFromChat(
      { contentMd: "x", title: "x" },
      fetchImpl,
    );
    expect(slug).toBeNull();
  });
});
