import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { notes, libraries, user } from "@episteme/db/schema";
import { auth } from "@episteme/auth";
import { authenticateExt } from "../src/extensions/authenticate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTag() {
  return `t_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

interface TestUser {
  id: string;
  cookie: string;
}

async function createTestUser(): Promise<TestUser> {
  const tag = makeTag();
  const email = `${tag}@sync-test.local`;
  const password = "test-password-1234";

  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password, name: "Sync Test User" },
    returnHeaders: true,
  });

  const setCookie = headers.get("set-cookie");
  if (!setCookie) throw new Error("signUpEmail returned no set-cookie header");
  const cookie = setCookie.split(";")[0];
  const id = (response as { user: { id: string } }).user.id;
  return { id, cookie };
}

async function deleteTestUser(id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}

async function createNote(userId: string, libraryId: number): Promise<string> {
  const slug = `sync-test-${makeTag()}`;
  const [row] = await db
    .insert(notes)
    .values({ userId, libraryId, title: "Sync Test Note", slug })
    .returning({ id: notes.id });
  return row.id;
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let userA: TestUser;
let userB: TestUser;
let libraryIdA: number;
let noteIdA: string; // UUID

const ext = authenticateExt();

beforeAll(async () => {
  userA = await createTestUser();
  userB = await createTestUser();

  const [libA] = await db
    .insert(libraries)
    .values({ userId: userA.id, name: "Sync Lib A" })
    .returning({ id: libraries.id });
  libraryIdA = libA.id;

  noteIdA = await createNote(userA.id, libraryIdA);
});

afterAll(async () => {
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
});

// ---------------------------------------------------------------------------
// Minimal valid payload factory — omit fields Hocuspocus adds at runtime
// ---------------------------------------------------------------------------
function payload(overrides: {
  token?: string;
  requestHeaders?: Record<string, string>;
  documentName?: string;
}) {
  return {
    token: overrides.token ?? "",
    requestHeaders: overrides.requestHeaders ?? {},
    documentName: overrides.documentName ?? `note:${noteIdA}`,
    // The rest of onAuthenticatePayload is not used by our extension
    context: {},
    instance: {} as never,
    requestParameters: new URLSearchParams(),
    request: {} as never,
    socketId: "test-socket-id",
    connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: false },
  };
}

// ---------------------------------------------------------------------------
// Tests (RED first)
// ---------------------------------------------------------------------------

describe("authenticateExt — onAuthenticate", () => {
  it("rejects when token is an empty string (missing cookie)", async () => {
    await expect(
      ext.onAuthenticate!(payload({ token: "" })),
    ).rejects.toThrow(/unauth/i);
  });

  it("rejects when token is a bogus cookie string", async () => {
    await expect(
      ext.onAuthenticate!(payload({ token: "better-auth.session_token=bogus-invalid" })),
    ).rejects.toThrow(/unauth/i);
  });

  it("rejects when valid session but user does NOT own the note", async () => {
    // userB has a valid session but noteIdA belongs to userA
    await expect(
      ext.onAuthenticate!(
        payload({ token: userB.cookie, documentName: `note:${noteIdA}` }),
      ),
    ).rejects.toThrow(/unauth/i);
  });

  it("resolves with { user: { id } } when valid session and user owns the note", async () => {
    const result = await ext.onAuthenticate!(
      payload({ token: userA.cookie, documentName: `note:${noteIdA}` }),
    );
    expect(result).toMatchObject({ user: { id: userA.id } });
  });

  it("rejects when documentName has no colon separator (e.g. 'notXXnoid')", async () => {
    await expect(
      ext.onAuthenticate!(
        payload({ token: userA.cookie, documentName: "notXXnoid" }),
      ),
    ).rejects.toThrow(/unauth/i);
  });

  it("rejects when documentName note id is empty (e.g. 'note:')", async () => {
    await expect(
      ext.onAuthenticate!(
        payload({ token: userA.cookie, documentName: "note:" }),
      ),
    ).rejects.toThrow(/unauth/i);
  });

  it("rejects when documentName note id is not a valid UUID (e.g. 'note:abc')", async () => {
    await expect(
      ext.onAuthenticate!(
        payload({ token: userA.cookie, documentName: "note:abc" }),
      ),
    ).rejects.toThrow(/unauth/i);
  });

  it("rejects when documentName has a non-note prefix (e.g. 'paper:<uuid>')", async () => {
    await expect(
      ext.onAuthenticate!(
        payload({ token: userA.cookie, documentName: `paper:${noteIdA}` }),
      ),
    ).rejects.toThrow(/malformed/i);
  });

  it("token wins over requestHeaders.cookie (cookie precedence)", async () => {
    // token = userA's session; requestHeaders.cookie = userB's session
    // The note belongs to userA — should resolve, proving token is the trust anchor
    const result = await ext.onAuthenticate!(
      payload({
        token: userA.cookie,
        requestHeaders: { cookie: userB.cookie },
        documentName: `note:${noteIdA}`,
      }),
    );
    expect(result).toMatchObject({ user: { id: userA.id } });
  });
});
