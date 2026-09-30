// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

// The tab label for /n/<slug> must be the note title, not the slug that
// TabBar infers from the URL.

const note = {
  id: "n1",
  userId: "u1",
  libraryId: 1,
  slug: "my-note",
  title: "My Note Title",
  folderPath: "",
  contentMd: "",
  isPublic: false,
  publicSlug: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

// Every select() chain resolves, in call order, to: note, user, note links.
const { results } = vi.hoisted(() => ({ results: [] as unknown[][] }));
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {
    then: (resolve: (rows: unknown[]) => void) => resolve(results.shift() ?? []),
  };
  for (const m of ["select", "from", "where", "leftJoin"]) chain[m] = () => chain;
  return { db: chain };
});

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn(), sql: vi.fn(() => ({ as: vi.fn() })) }));
vi.mock("@episteme/db/schema", () => ({
  noteLinks: {},
  notes: {},
  papers: {},
  references_: {},
  user: {},
}));
vi.mock("@/lib/session", () => ({ getRequiredUserId: vi.fn(async () => "u1") }));
vi.mock("@/lib/library/touch-recents", () => ({ touchRecent: vi.fn() }));
vi.mock("@/lib/default-library", () => ({ getDefaultLibrary: vi.fn(async () => null) }));
vi.mock("@/lib/collab-token", () => ({ mintCollabToken: vi.fn() }));
vi.mock("@/lib/flags", () => ({ COLLAB_ENABLED: false }));
vi.mock("@/lib/note-content", () => ({ prepareNoteContent: (s: string) => s }));
vi.mock("@/components/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/BacklinksPanel", () => ({ BacklinksPanel: () => null }));
vi.mock("./NotePageClient", () => ({ NotePageClient: () => null }));
vi.mock("@/components/TabBar", () => ({ TabTitleUpdater: () => null }));

import { TabTitleUpdater } from "@/components/TabBar";
import NotePage from "./page";

describe("note page tab title", () => {
  it("renders a TabTitleUpdater for /n/<slug> with the note title", async () => {
    results.push([note], [{ username: "a", name: "A", email: "a@x" }], []);
    const page = (await NotePage({
      params: Promise.resolve({ slug: "my-note" }),
    })) as ReactElement<{ children: ReactElement[] }>;
    const updater = [page.props.children].flat().find(
      (c) => c && (c as ReactElement).type === TabTitleUpdater,
    ) as ReactElement<{ href: string; title: string }> | undefined;
    expect(updater?.props).toEqual({ href: "/n/my-note", title: "My Note Title" });
  });
});
