// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  buildMarkdownWithFrontmatter,
  parseFrontmatter,
  type FrontmatterRow,
} from "@episteme/markdown";
import { NoteFrontmatter } from "./NoteFrontmatter";

afterEach(() => cleanup());

function setup(initialRows: FrontmatterRow[]) {
  const onChange = vi.fn();
  const utils = render(
    <NoteFrontmatter rows={initialRows} onChange={onChange} />,
  );
  return { onChange, ...utils };
}

describe("NoteFrontmatter", () => {
  it("renders parsed rows with appropriate inputs", () => {
    const { rows } = parseFrontmatter(
      "---\nauthor: Foo\ncount: 7\ncreated: 2026-04-28\ntags: [a, b]\n---\nbody\n",
    );
    setup(rows);
    expect(
      (screen.getByTestId("frontmatter-value-author") as HTMLInputElement).type,
    ).toBe("text");
    expect(
      (screen.getByTestId("frontmatter-value-count") as HTMLInputElement).type,
    ).toBe("number");
    expect(
      (screen.getByTestId("frontmatter-value-created") as HTMLInputElement)
        .type,
    ).toBe("date");
    expect(
      (screen.getByTestId("frontmatter-value-tags") as HTMLInputElement).value,
    ).toBe("a, b");
  });

  it("editing a value calls onChange with the updated row array", () => {
    const initial: FrontmatterRow[] = [
      { key: "author", value: "Foo", type: "text" },
    ];
    const { onChange } = setup(initial);
    const input = screen.getByTestId(
      "frontmatter-value-author",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bar" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { key: "author", value: "Bar", type: "text" },
    ]);
  });

  it("removing a row drops it from the array", () => {
    const initial: FrontmatterRow[] = [
      { key: "author", value: "Foo", type: "text" },
      { key: "tags", value: ["a"], type: "tags" },
    ];
    const { onChange } = setup(initial);
    fireEvent.click(screen.getByTestId("frontmatter-remove-author"));
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { key: "tags", value: ["a"], type: "tags" },
    ]);
  });

  it("adding a new row with comma-separated value infers tags", () => {
    const { onChange } = setup([]);
    fireEvent.click(screen.getByTestId("frontmatter-add"));
    fireEvent.change(screen.getByTestId("frontmatter-new-key"), {
      target: { value: "tags" },
    });
    fireEvent.change(screen.getByTestId("frontmatter-new-value"), {
      target: { value: "x, y, z" },
    });
    fireEvent.click(screen.getByTestId("frontmatter-new-confirm"));
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { key: "tags", value: ["x", "y", "z"], type: "tags" },
    ]);
  });

  it("round-trips: edit -> serialize -> parse equals mutated structure", () => {
    const src = "---\nauthor: Foo\n---\nbody text\n";
    const { rows, body } = parseFrontmatter(src);
    const mutated = rows.map((r) =>
      r.key === "author" ? { ...r, value: "Bar" } : r,
    );
    const rebuilt = buildMarkdownWithFrontmatter(mutated, body);
    const second = parseFrontmatter(rebuilt);
    expect(second.rows).toEqual(mutated);
    expect(second.body).toBe(body);
  });
});
