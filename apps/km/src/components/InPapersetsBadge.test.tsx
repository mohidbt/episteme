// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InPapersetsBadge } from "./InPapersetsBadge";

afterEach(() => cleanup());

describe("InPapersetsBadge", () => {
  it("renders nothing when count=0", () => {
    const { container } = render(
      <InPapersetsBadge count={0} papersets={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders chip 'in 1 paperset' for count=1", () => {
    render(
      <InPapersetsBadge
        count={1}
        papersets={[{ id: "a", filename: "x.csv" }]}
      />,
    );
    const btn = screen.getByRole("button", { name: /in 1 paperset(?!s)/i });
    expect(btn).toBeTruthy();
  });

  it("renders trigger with shadcn Button outline styling", () => {
    render(
      <InPapersetsBadge
        count={1}
        papersets={[{ id: "a", filename: "x.csv" }]}
      />,
    );
    const btn = screen.getByRole("button", { name: /in 1 paperset(?!s)/i });
    // outline variant uses border-border token; size=sm gives text-[0.8rem]
    expect(btn.className).toMatch(/border-border/);
    expect(btn.getAttribute("data-testid")).toBe("in-papersets-badge");
  });

  it("renders chip 'in 2 papersets' and opens popover with linked filenames", async () => {
    render(
      <InPapersetsBadge
        count={2}
        papersets={[
          { id: "a", filename: "x.csv" },
          { id: "b", filename: "y.csv" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /in 2 papersets/i }));
    const a = (await screen.findByRole("link", {
      name: "x.csv",
    })) as HTMLAnchorElement;
    const b = screen.getByRole("link", { name: "y.csv" }) as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/d/a");
    expect(b.getAttribute("href")).toBe("/d/b");
  });
});
