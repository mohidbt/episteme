"use client";

import { useEffect } from "react";

// Ports TextLayerBuilder.#enableGlobalSelectionListener from pdfjs-dist/web/pdf_viewer.mjs
export function usePdfTextSelection() {
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const TEXT_LAYER_SELECTOR = ".react-pdf__Page__textContent";

    const getLayers = (): Array<[HTMLElement, HTMLElement]> => {
      const entries: Array<[HTMLElement, HTMLElement]> = [];
      const nodes = document.querySelectorAll<HTMLElement>(TEXT_LAYER_SELECTOR);
      nodes.forEach((layer) => {
        const end = layer.querySelector<HTMLElement>(":scope > .endOfContent");
        if (end) entries.push([layer, end]);
      });
      return entries;
    };

    const reset = (end: HTMLElement, textLayer: HTMLElement) => {
      textLayer.append(end);
      end.style.width = "";
      end.style.height = "";
      textLayer.classList.remove("selecting");
    };

    const resetAll = () => {
      for (const [layer, end] of getLayers()) reset(end, layer);
    };

    let isPointerDown = false;
    let isFirefox: boolean | undefined;
    let prevRange: Range | undefined;

    document.addEventListener(
      "pointerdown",
      () => {
        isPointerDown = true;
      },
      { signal }
    );
    document.addEventListener(
      "pointerup",
      () => {
        isPointerDown = false;
        resetAll();
      },
      { signal }
    );
    window.addEventListener(
      "blur",
      () => {
        isPointerDown = false;
        resetAll();
      },
      { signal }
    );
    document.addEventListener(
      "keyup",
      () => {
        if (!isPointerDown) resetAll();
      },
      { signal }
    );

    document.addEventListener(
      "selectionchange",
      () => {
        const selection = document.getSelection();
        const layers = getLayers();
        if (!selection || selection.rangeCount === 0) {
          for (const [layer, end] of layers) reset(end, layer);
          return;
        }

        const activeLayers = new Set<HTMLElement>();
        for (let i = 0; i < selection.rangeCount; i++) {
          const r = selection.getRangeAt(i);
          for (const [layer] of layers) {
            if (!activeLayers.has(layer) && r.intersectsNode(layer)) {
              activeLayers.add(layer);
            }
          }
        }

        for (const [layer, end] of layers) {
          if (activeLayers.has(layer)) {
            layer.classList.add("selecting");
          } else {
            reset(end, layer);
          }
        }

        if (layers.length === 0) return;

        if (isFirefox === undefined) {
          isFirefox =
            getComputedStyle(layers[0][0]).getPropertyValue(
              "-moz-user-select"
            ) === "none";
        }
        if (isFirefox) return;

        const range = selection.getRangeAt(0);
        const modifyStart =
          prevRange !== undefined &&
          (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
            range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);

        let anchor: Node | null = modifyStart
          ? range.startContainer
          : range.endContainer;
        if (anchor && anchor.nodeType === Node.TEXT_NODE) {
          anchor = anchor.parentNode;
        }
        if (!modifyStart && range.endOffset === 0 && anchor) {
          do {
            while (anchor && !anchor.previousSibling) {
              anchor = anchor.parentNode;
            }
            if (!anchor) break;
            anchor = anchor.previousSibling;
          } while (anchor && !anchor.childNodes.length);
        }

        if (anchor && anchor instanceof Element) {
          const parentTextLayer = anchor.parentElement?.closest<HTMLElement>(
            TEXT_LAYER_SELECTOR
          );
          if (parentTextLayer) {
            const entry = layers.find(([l]) => l === parentTextLayer);
            if (entry && anchor.parentElement) {
              const endDiv = entry[1];
              endDiv.style.width = parentTextLayer.style.width;
              endDiv.style.height = parentTextLayer.style.height;
              anchor.parentElement.insertBefore(
                endDiv,
                modifyStart ? anchor : anchor.nextSibling
              );
            }
          }
        }

        prevRange = range.cloneRange();
      },
      { signal }
    );

    return () => controller.abort();
  }, []);
}
