import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import {
  GET as GET_ID,
  PATCH as PATCH_ID,
  DELETE as DELETE_ID,
} from "./[id]/route";
import { createTestUser, deleteTestUser, req, params, type TestUser } from "../../_test-utils";

let u: TestUser;
let other: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("/api/agent/threads", () => {
  it("rejects unauthenticated GET with 401", async () => {
    const r = await GET(req("/api/agent/threads"));
    expect(r.status).toBe(401);
  });

  it("POST creates a thread; GET returns it", async () => {
    const create = await POST(
      req("/api/agent/threads", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ skill: "lit-triage", title: "T1" }),
      }),
    );
    expect(create.status).toBe(201);
    const { thread } = await create.json();
    expect(thread.skill).toBe("lit-triage");
    expect(thread.title).toBe("T1");
    expect(thread.status).toBe("idle");

    const list = await GET(req("/api/agent/threads", { cookie: u.cookie }));
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.threads.find((t: { threadId: string }) => t.threadId === thread.threadId)).toBeTruthy();
  });

  it("PATCH updates title; DELETE returns 204 then 404", async () => {
    const create = await POST(
      req("/api/agent/threads", { method: "POST", cookie: u.cookie, body: "{}" }),
    );
    const { thread } = await create.json();
    const id = thread.threadId;

    const patch = await PATCH_ID(
      req(`/api/agent/threads/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ title: "renamed", status: "running" }),
      }),
      params({ id }),
    );
    expect(patch.status).toBe(200);
    expect((await patch.json()).thread.title).toBe("renamed");

    const get = await GET_ID(
      req(`/api/agent/threads/${id}`, { cookie: u.cookie }),
      params({ id }),
    );
    expect(get.status).toBe(200);
    expect((await get.json()).thread.status).toBe("running");

    const del1 = await DELETE_ID(
      req(`/api/agent/threads/${id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(del1.status).toBe(204);

    const del2 = await DELETE_ID(
      req(`/api/agent/threads/${id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(del2.status).toBe(404);
  });

  it("scopes by user — other user gets 404 on someone else's thread", async () => {
    const create = await POST(
      req("/api/agent/threads", { method: "POST", cookie: u.cookie, body: "{}" }),
    );
    const { thread } = await create.json();
    const id = thread.threadId;

    const r = await GET_ID(
      req(`/api/agent/threads/${id}`, { cookie: other.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(404);
  });
});
