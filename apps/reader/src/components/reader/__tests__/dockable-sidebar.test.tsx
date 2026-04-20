import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { useSidebarDock, DockMenu, type Dock } from "../dockable-sidebar";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

function Harness({ id, defaultDock = "right" as Dock }: { id: string; defaultDock?: Dock }) {
  const [dock, setDock] = useSidebarDock(id, defaultDock);
  return (
    <div>
      <span data-testid="dock-value">{dock}</span>
      <DockMenu dock={dock} onChange={setDock} />
    </div>
  );
}

describe("useSidebarDock + DockMenu", () => {
  afterEach(cleanup);

  beforeEach(() => {
    installMemoryStorage();
  });

  it("persists dock change to localStorage when a menu item is clicked", () => {
    render(<Harness id="test-sb" />);
    // Open the <details> menu by clicking the summary element.
    const summary = screen.getByTestId("dock-menu-trigger");
    act(() => {
      fireEvent.click(summary);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("dock-menu-item-bottom"));
    });
    expect(screen.getByTestId("dock-value").textContent).toBe("bottom");
    expect(localStorage.getItem("dockable-sidebar:test-sb:dock")).toBe("bottom");
  });

  it("restores previously persisted dock from localStorage on mount", () => {
    localStorage.setItem("dockable-sidebar:restore:dock", "left");
    render(<Harness id="restore" />);
    expect(screen.getByTestId("dock-value").textContent).toBe("left");
  });
});
