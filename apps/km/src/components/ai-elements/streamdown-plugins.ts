// GSD-171 — single shared Streamdown plugin set for every agent surface.
//
// `MessageResponse` (assistant messages) and `Reasoning` (thinking blocks)
// both render agent output via Streamdown, and both are consumed by
// `AgentTranscript`, which powers all three agent surfaces: the agents tab,
// the mini agent window (AgentBall), and the agent-in-reader panel. Defining
// the plugin set once here means LaTeX support lands in all three at once.
//
// `@streamdown/math`'s bare `math` export disables inline single-dollar math
// (`singleDollarTextMath` defaults to false), so `$E=mc^2$` would not render.
// We construct the plugin with `singleDollarTextMath: true` to support inline
// `$...$` alongside block `$$...$$`. KaTeX CSS is imported globally in
// app/globals.css (Streamdown does not inject plugin styles itself).

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

const math = createMathPlugin({ singleDollarTextMath: true });

export const streamdownPlugins = { cjk, code, math, mermaid };
