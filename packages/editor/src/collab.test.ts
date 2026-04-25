import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { createCollabProvider } from "./collab";

// Suppress WebSocket connection attempts — provider tries to connect on
// construction; we only want to assert object shape.
vi.spyOn(HocuspocusProvider.prototype, "connect").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCollabProvider", () => {
  const args = { noteId: "note-abc", url: "ws://localhost:1", token: "tok-x" };

  it("returns an object with ydoc, provider, and destroy", () => {
    const collab = createCollabProvider(args);
    expect(collab).toHaveProperty("ydoc");
    expect(collab).toHaveProperty("provider");
    expect(collab).toHaveProperty("destroy");
    expect(typeof collab.destroy).toBe("function");
    collab.destroy();
  });

  it("ydoc is a Y.Doc instance", () => {
    const collab = createCollabProvider(args);
    expect(collab.ydoc).toBeInstanceOf(Y.Doc);
    collab.destroy();
  });

  it("provider is a HocuspocusProvider instance", () => {
    const collab = createCollabProvider(args);
    expect(collab.provider).toBeInstanceOf(HocuspocusProvider);
    collab.destroy();
  });

  it("provider.configuration.url matches passed url", () => {
    const collab = createCollabProvider(args);
    expect(collab.provider.configuration.url).toBe(args.url);
    collab.destroy();
  });

  it("provider.configuration.name is note:<noteId>", () => {
    const collab = createCollabProvider(args);
    expect(collab.provider.configuration.name).toBe(`note:${args.noteId}`);
    collab.destroy();
  });

  it("provider.configuration.token matches passed token", () => {
    const collab = createCollabProvider(args);
    expect(collab.provider.configuration.token).toBe(args.token);
    collab.destroy();
  });

  it("destroy() tears down without throwing", () => {
    const collab = createCollabProvider(args);
    expect(() => collab.destroy()).not.toThrow();
  });
});
