// @vitest-environment jsdom
/**
 * Shared helpers for Hocuspocus integration tests.
 *
 * These boot real servers, create real DB rows, and use real WebSocket
 * connections — no mocking of Hocuspocus or Postgres.
 */
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { Hocuspocus } from "@hocuspocus/server";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { db } from "@episteme/db";
import { libraries, notes, user } from "@episteme/db/schema";
import { auth } from "@episteme/auth";
import { authenticateExt } from "../../src/extensions/authenticate.js";
import { persistExt } from "../../src/extensions/persist.js";

// ---------------------------------------------------------------------------
// User / note seeding
// ---------------------------------------------------------------------------

function makeTag(): string {
  return `i_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

export interface TestUser {
  id: string;
  cookie: string;
}

/** Sign up a fresh user via Better Auth server-side API and return { id, cookie }. */
export async function createTestUser(): Promise<TestUser> {
  const tag = makeTag();
  const email = `${tag}@int-test.local`;
  const password = "integration-test-pw-1234";
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password, name: "Integration Test User" },
    returnHeaders: true,
  });
  const setCookie = headers.get("set-cookie");
  if (!setCookie) throw new Error("signUpEmail returned no set-cookie header");
  const cookie = setCookie.split(";")[0];
  const id = (response as { user: { id: string } }).user.id;
  return { id, cookie };
}

/** Delete a user (cascades to all owned rows via FK ON DELETE CASCADE). */
export async function deleteTestUser(id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}

/** Create a library row owned by userId, returns libraryId. */
export async function createTestLibrary(userId: string): Promise<number> {
  const [lib] = await db
    .insert(libraries)
    .values({ userId, name: `Int-Test Library ${makeTag()}` })
    .returning({ id: libraries.id });
  return lib.id;
}

/** Insert a notes row, returns the UUID. contentMd is optional. */
export async function seedNote(
  userId: string,
  libraryId: number,
  contentMd = "",
): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({
      userId,
      libraryId,
      title: "Integration Test Note",
      slug: `int-test-${makeTag()}`,
      contentMd,
    })
    .returning({ id: notes.id });
  return row.id;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export interface SyncServer {
  server: Hocuspocus;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Boot a Hocuspocus instance with authenticateExt + persistExt.
 * Pass `{ port: 0 }` to use an ephemeral OS-assigned port.
 */
export async function startSyncServer(opts: { port?: number } = {}): Promise<SyncServer> {
  const server = new Hocuspocus({
    port: opts.port ?? 0,
    quiet: true,
    extensions: [authenticateExt(), persistExt()],
  });
  await server.listen();
  const port = (server.address as { port: number }).port;
  return {
    server,
    port,
    stop: () => server.destroy(),
  };
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface SyncClient {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  /** Resolves once authenticated+synced; rejects after 5 s. */
  awaitConnected: Promise<void>;
}

/**
 * Create a real HocuspocusProvider client pointing at ws://localhost:<port>.
 * `cookie` is passed as the WS handshake token (matching authenticateExt).
 */
export function connectClient(opts: {
  noteId: string;
  port: number;
  cookie: string;
}): SyncClient {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://localhost:${opts.port}`,
    name: `note:${opts.noteId}`,
    document: ydoc,
    token: opts.cookie,
  });

  const awaitConnected = new Promise<void>((resolve, reject) => {
    const tid = setTimeout(() => {
      reject(new Error(`connectClient timed out for note:${opts.noteId} on port ${opts.port}`));
    }, 5_000);

    // The provider emits 'authenticated' once the server confirms the session,
    // then 'synced' once the initial document state is applied.
    // Waiting for 'synced' is sufficient — it fires after 'authenticated'.
    provider.on("synced", () => {
      clearTimeout(tid);
      resolve();
    });

    // If authentication fails, reject immediately.
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
      clearTimeout(tid);
      reject(new Error(`authenticationFailed: ${reason}`));
    });
  });

  return { ydoc, provider, awaitConnected };
}

// ---------------------------------------------------------------------------
// Generic async poller
// ---------------------------------------------------------------------------

/**
 * Poll `predicate()` until it returns true.
 * Resolves when it passes; rejects after `timeoutMs` with an error.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeoutMs: number; tickMs?: number } = { timeoutMs: 500 },
): Promise<void> {
  const { timeoutMs, tickMs = 30 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, tickMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
