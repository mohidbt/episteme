// GSD-171 — RED. Agent output must render LaTeX in all three agent surfaces.
// All three consume the shared `MessageResponse`/`Reasoning` Streamdown
// renderers, which must share ONE plugin set. The `@streamdown/math` `math`
// export defaults `singleDollarTextMath` to FALSE, so inline `$...$` does not
// render. The shared plugin set must enable inline single-dollar math while
// keeping block `$$...$$` support.

import { describe, it, expect } from "vitest";
import { streamdownPlugins } from "./streamdown-plugins";

describe("shared streamdown plugins", () => {
  it("includes the katex math plugin", () => {
    expect(streamdownPlugins.math).toBeDefined();
    expect(streamdownPlugins.math.name).toBe("katex");
  });

  it("enables inline single-dollar math ($...$)", () => {
    // remarkPlugin is [remarkMath, options]; options.singleDollarTextMath must
    // be true so inline `$E=mc^2$` renders, not just block `$$...$$`. The
    // plugin types `remarkPlugin` as a loose `Pluggable`, so read the options
    // tuple slot through `unknown`.
    const remarkPlugin = streamdownPlugins.math.remarkPlugin as unknown as [
      unknown,
      { singleDollarTextMath?: boolean },
    ];
    expect(remarkPlugin[1].singleDollarTextMath).toBe(true);
  });

  it("exposes the other renderers (cjk, code, mermaid) unchanged", () => {
    expect(streamdownPlugins.cjk).toBeDefined();
    expect(streamdownPlugins.code).toBeDefined();
    expect(streamdownPlugins.mermaid).toBeDefined();
  });
});
