// Side-effect import: install a minimal DOM on the Node process.
// Tiptap's Editor constructor reads `document` eagerly; @episteme/markdown
// serializers + persist.ts use Editor, so production onStoreDocument would
// throw ReferenceError without this shim. Must be imported BEFORE any module
// that touches Tiptap.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as unknown as Record<string, unknown>;
g.window ??= dom.window;
g.document ??= dom.window.document;
g.navigator ??= dom.window.navigator;
g.HTMLElement ??= dom.window.HTMLElement;
g.Element ??= dom.window.Element;
g.Node ??= dom.window.Node;
g.DOMParser ??= dom.window.DOMParser;
