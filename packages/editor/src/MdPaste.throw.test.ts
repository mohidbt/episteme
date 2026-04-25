/**
 * Isolated test for the throw-fallback behaviour.
 * vi.mock must be at the top level of its own file so hoisting works correctly.
 *
 * This test mocks @episteme/markdown so mdToProseMirror always throws,
 * then verifies that MdPaste.handlePaste catches the error and returns false.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@episteme/markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("@episteme/markdown")>();
  return {
    ...original,
    mdToProseMirror: () => {
      throw new Error("forced parse error");
    },
  };
});

describe("MdPaste — throw fallback (mocked @episteme/markdown)", () => {
  it(
    "returns false when mdToProseMirror throws inside the paste handler",
    async () => {
      const { Editor } = await import("@tiptap/core");
      // Import MdPaste AFTER mock — it will bind to the mocked mdToProseMirror
      const { MdPaste } = await import("./MdPaste");
      // createExtensions from @episteme/markdown (the rest of the mock is passthrough)
      const { createExtensions } = await import("@episteme/markdown");

      const editor = new Editor({
        extensions: [...createExtensions(), MdPaste],
      });

      const handlePaste = editor.view.someProp("handlePaste") as
        | ((view: unknown, event: Event, slice: unknown) => boolean)
        | undefined;

      const clipboardData = {
        getData: (type: string) =>
          type === "text/plain" ? "# Heading\n\nparagraph" : "",
        types: ["text/plain"],
      };
      const event = Object.assign(new Event("paste"), { clipboardData });
      const result = handlePaste ? handlePaste(editor.view, event, null) : false;

      expect(result).toBe(false);

      editor.destroy();
    },
    15_000,
  );
});
