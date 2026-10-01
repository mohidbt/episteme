// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { NotePicker } from "./NotePicker";

const NOTES = [
  { id: "n2", title: "Edited last", slug: "edited-last", updatedAt: "2030-01-02T00:00:00.000Z" },
  { id: "n1", title: "Edited first", slug: "edited-first", updatedAt: "2030-01-01T00:00:00.000Z" },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let search: (url: URL) => Response;
let create: (body: unknown) => Response;
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  if (init?.method === "POST") return create(JSON.parse(init.body as string));
  return search(new URL(input, "http://test"));
});

const onPick = vi.fn();

function renderPicker() {
  return render(
    <NotePicker paperTitle="Attention Is All You Need" libraryId={7} folderId="folder-1" onPick={onPick} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  search = () => json({ results: NOTES });
  create = () => json({ id: "new", title: "Attention Is All You Need", slug: "attention" }, 201);
});

afterEach(cleanup);

describe("NotePicker", () => {
  it("lists the user's notes, last edited first, under a New note row", async () => {
    renderPicker();
    await screen.findByText("Edited last");
    const rows = screen.getAllByRole("option").map((el) => el.textContent);
    expect(rows).toEqual(["New note", "Edited last", "Edited first"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notes/search?sort=recent&k=50&q=");
  });

  it("filters by title through the search input", async () => {
    search = (url) =>
      json({ results: NOTES.filter((n) => n.title.includes(url.searchParams.get("q")!)) });
    renderPicker();
    await screen.findByText("Edited last");
    fireEvent.change(screen.getByPlaceholderText("Search notes..."), { target: { value: "first" } });
    await waitFor(() => expect(screen.queryByText("Edited last")).toBeNull());
    expect(screen.getByText("Edited first")).toBeTruthy();
  });

  it("picks an existing note", async () => {
    renderPicker();
    fireEvent.click(await screen.findByText("Edited first"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "n1", slug: "edited-first" }));
  });

  it("creates a note titled after the paper, in the paper's folder", async () => {
    const invalidated = vi.fn();
    window.addEventListener("episteme:drive-tree-invalidated", invalidated);
    let sent: unknown;
    create = (body) => {
      sent = body;
      return json({ id: "new", title: "Attention Is All You Need", slug: "attention" }, 201);
    };
    renderPicker();
    fireEvent.click(screen.getByText("New note"));
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith({
        id: "new",
        title: "Attention Is All You Need",
        slug: "attention",
      }),
    );
    expect(sent).toEqual({ libraryId: 7, folderId: "folder-1", title: "Attention Is All You Need" });
    expect(invalidated).toHaveBeenCalledTimes(1);
    window.removeEventListener("episteme:drive-tree-invalidated", invalidated);
  });

  it("sends a guest to the sign-up prompt and picks nothing", async () => {
    create = () => json({ error: "guest_forbidden" }, 403);
    renderPicker();
    fireEvent.click(screen.getByText("New note"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("You're in guest mode", expect.anything()),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("toasts when the create fails and picks nothing", async () => {
    create = () => json({ error: "boom" }, 500);
    renderPicker();
    fireEvent.click(screen.getByText("New note"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Create failed"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows a retry when the list fails, with New note still usable", async () => {
    search = () => json({ error: "boom" }, 500);
    renderPicker();
    await screen.findByText("Couldn't load notes.");
    expect(screen.getByText("New note")).toBeTruthy();

    search = () => json({ results: NOTES });
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByText("Edited last");
  });
});
