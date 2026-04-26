// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DownloadButton } from "./DownloadButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DownloadButton", () => {
  it("renders a button labeled Download", () => {
    render(<DownloadButton slug="my-note" getMarkdown={() => "# Hello"} />);
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy();
  });

  it("click creates a Blob with the editor markdown and triggers download", () => {
    const md = "# My Note\n\nSome content.";
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    // Spy on createElement to capture anchor behaviour
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(clickSpy);
      }
      return el;
    });

    render(<DownloadButton slug="my-note" getMarkdown={() => md} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    // createObjectURL called with a Blob
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/markdown");

    // anchor click triggered
    expect(clickSpy).toHaveBeenCalledOnce();

    // revokeObjectURL called after click
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("anchor has download attribute set to <slug>.md", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    let capturedAnchor: HTMLAnchorElement | null = null;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        capturedAnchor = el as HTMLAnchorElement;
        vi.spyOn(capturedAnchor, "click").mockImplementation(() => {});
      }
      return el;
    });

    render(<DownloadButton slug="my-note" getMarkdown={() => "content"} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(capturedAnchor).not.toBeNull();
    expect((capturedAnchor as unknown as HTMLAnchorElement).download).toBe("my-note.md");
  });

  it("revokeObjectURL is called after click to free the object URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:revoke-test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
      }
      return el;
    });

    render(<DownloadButton slug="my-note" getMarkdown={() => "hello"} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:revoke-test");
  });

  it("sanitizes slug: replaces chars outside [a-zA-Z0-9-_] with hyphens", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    let capturedAnchor: HTMLAnchorElement | null = null;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        capturedAnchor = el as HTMLAnchorElement;
        vi.spyOn(capturedAnchor, "click").mockImplementation(() => {});
      }
      return el;
    });

    render(<DownloadButton slug="dirty/slug?.md" getMarkdown={() => "x"} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    // "dirty/slug?.md" → strip trailing ".md" → "dirty/slug?" → sanitize → "dirty-slug-" → suffix ".md"
    expect((capturedAnchor as unknown as HTMLAnchorElement).download).toBe("dirty-slug-.md");
  });

  it("falls back to 'note.md' when slug is empty", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    let capturedAnchor: HTMLAnchorElement | null = null;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        capturedAnchor = el as HTMLAnchorElement;
        vi.spyOn(capturedAnchor, "click").mockImplementation(() => {});
      }
      return el;
    });

    render(<DownloadButton slug="" getMarkdown={() => "x"} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect((capturedAnchor as unknown as HTMLAnchorElement).download).toBe("note.md");
  });

  it("the Blob text matches exactly what getMarkdown returns", async () => {
    const md = "# Title\n\n[[wiki-link]] and some text";
    let capturedBlob: Blob | null = null;

    // Only mock the two URL methods rather than replacing the whole URL global
    const createObjectURL = vi.fn().mockImplementation((b: Blob) => {
      capturedBlob = b;
      return "blob:url";
    });
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
      }
      return el;
    });

    render(<DownloadButton slug="my-note" getMarkdown={() => md} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(capturedBlob).not.toBeNull();
    // jsdom doesn't support Blob.text(); use FileReader instead
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(capturedBlob as unknown as Blob);
    });
    expect(text).toBe(md);
  });
});
