"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { X, Plus, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileTypeKindFromHref, getFileTypeIcon } from "@/lib/file-type-icon";

const STORAGE_KEY = "app-tabs-v1";
const DEFAULT_HREF = "/";
const DEFAULT_TITLE = "Drive";
const GUEST_WELCOME_HREF = "/n/welcome-to-episteme";
const GUEST_WELCOME_TITLE = "Welcome to Episteme";

/** /drive redirects to /, so normalize to the canonical path. */
function normalizeHref(href: string): string {
  if (href === "/drive") return "/";
  return href;
}

export type Tab = { href: string; title: string };

type TabsState = { tabs: Tab[]; activeHref: string | null };

type TabsApi = TabsState & {
  openTab: (href: string, title: string) => void;
  /**
   * GSD-26: open href in a NEW tab without activating it (power-user
   * Cmd+Click / middle-click semantics). Caller stays on the current tab —
   * no router.push fires.
   */
  openInNewTab: (href: string, title: string) => void;
  closeTab: (href: string) => void;
  setActive: (href: string) => void;
  updateTabTitle: (href: string, title: string) => void;
  reorderTabs: (activeHref: string, overHref: string) => void;
};

const Ctx = createContext<TabsApi | null>(null);

const DEFAULT_STATE: TabsState = { tabs: [], activeHref: null };

function loadFromStorage(): TabsState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabsState>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter(
            (t): t is Tab =>
              !!t && typeof t.href === "string" && typeof t.title === "string",
          )
          .map((t) => ({ ...t, href: normalizeHref(t.href) }))
      : [];
    const activeHref = typeof parsed.activeHref === "string"
      ? normalizeHref(parsed.activeHref)
      : null;
    return { tabs, activeHref };
  } catch {
    return null;
  }
}

export function TabBarProvider({
  children,
  isAnonymous = false,
}: {
  children: ReactNode;
  isAnonymous?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Initialize with the same default the server renders to avoid SSR/client
  // hydration mismatch. localStorage is read in a mount-only effect below.
  const [state, setState] = useState<TabsState>(DEFAULT_STATE);
  const stateRef = useRef<TabsState>(DEFAULT_STATE);
  stateRef.current = state;
  const persistedRef = useRef(false);

  // Hydrate from localStorage after mount (client-only).
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored && (stored.tabs.length > 0 || stored.activeHref)) {
      setState(stored);
    } else if (isAnonymous) {
      // Guest first-paint: seed Drive + Welcome tabs but keep Drive active
      // and DO NOT push the route. The joyride autostart needs the user to
      // land at "/" so step 0 (drive_intro) fires; an auto-push to the
      // welcome note interrupted the tour. (GSD-38)
      setState({
        tabs: [
          { href: DEFAULT_HREF, title: DEFAULT_TITLE },
          { href: GUEST_WELCOME_HREF, title: GUEST_WELCOME_TITLE },
        ],
        activeHref: DEFAULT_HREF,
      });
    }
    persistedRef.current = true;
  }, [isAnonymous]);

  // Persist on change — but only after the initial hydration pass, so we
  // don't overwrite stored state with the default on first commit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!persistedRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / disabled storage — ignore */
    }
  }, [state]);

  // Sync tab state with the current pathname (GSD-26: Chrome tab semantics).
  //
  // Three cases:
  //   1. A tab already exists with this href → activate it (no replace,
  //      no append). Covers clicking an existing tab and browser back/forward
  //      landing on a previously-opened route.
  //   2. The active tab points elsewhere → REPLACE its href in place. This
  //      is the core Chrome behavior: clicking an in-app link moves the
  //      current tab to the new route instead of spawning a new tab.
  //   3. No active tab yet (initial mount with no stored state) → seed the
  //      first tab. Same as the pre-GSD-26 behavior for that single case.
  //
  // New tabs only originate from `openTab` (+ button, Cmd+T) and
  // `openInNewTab` (Cmd+Click / middle-click) — both explicit user gestures.
  useEffect(() => {
    if (!pathname) return;
    const href = normalizeHref(pathname);
    setState((prev) => {
      const exists = prev.tabs.some((t) => t.href === href);
      if (exists) {
        if (prev.activeHref === href) return prev;
        return { ...prev, activeHref: href };
      }
      if (prev.activeHref !== null) {
        // Replace active tab's href in place — title falls back to inferred
        // (TabTitleUpdater will hydrate it once the new page mounts).
        const tabs = prev.tabs.map((tab) =>
          tab.href === prev.activeHref
            ? { href, title: titleFromHref(href) }
            : tab,
        );
        return { tabs, activeHref: href };
      }
      return {
        tabs: [...prev.tabs, { href, title: titleFromHref(href) }],
        activeHref: href,
      };
    });
  }, [pathname]);

  const openTab = useCallback(
    (href: string, title: string) => {
      const normalized = normalizeHref(href);
      setState((prev) => {
        const exists = prev.tabs.some((t) => t.href === normalized);
        const tabs = exists
          ? prev.tabs
          : [...prev.tabs, { href: normalized, title }];
        return { tabs, activeHref: normalized };
      });
      router.push(normalized);
    },
    [router],
  );

  const openInNewTab = useCallback((href: string, title: string) => {
    const normalized = normalizeHref(href);
    setState((prev) => {
      if (prev.tabs.some((t) => t.href === normalized)) return prev;
      return {
        ...prev,
        tabs: [...prev.tabs, { href: normalized, title }],
      };
    });
  }, []);

  const closeTab = useCallback(
    (href: string) => {
      const normalized = normalizeHref(href);
      // Compute the next state from the current snapshot so we can decide
      // whether to navigate BEFORE calling setState. Doing the navigation
      // here (in an event-handler context) avoids triggering React's
      // "Cannot update a component while rendering a different component"
      // warning that fires when router.push runs inside a setState updater.
      const prev = stateRef.current;
      const idx = prev.tabs.findIndex((t) => t.href === normalized);
      if (idx === -1) return;
      const tabs = prev.tabs.filter((t) => t.href !== normalized);
      let activeHref = prev.activeHref;
      let pushTo: string | null = null;
      if (activeHref === normalized) {
        const next = tabs[idx] ?? tabs[idx - 1] ?? null;
        activeHref = next?.href ?? DEFAULT_HREF;
        pushTo = activeHref;
      }
      if (tabs.length === 0) {
        setState({
          tabs: [{ href: DEFAULT_HREF, title: DEFAULT_TITLE }],
          activeHref: DEFAULT_HREF,
        });
      } else {
        setState({ tabs, activeHref });
      }
      if (pushTo) router.push(pushTo);
    },
    [router],
  );

  const setActive = useCallback(
    (href: string) => {
      const normalized = normalizeHref(href);
      setState((prev) => ({ ...prev, activeHref: normalized }));
      router.push(normalized);
    },
    [router],
  );

  const updateTabTitle = useCallback((href: string, title: string) => {
    const normalized = normalizeHref(href);
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setState((prev) => {
      let changed = false;
      const tabs = prev.tabs.map((tab) => {
        if (tab.href !== normalized || tab.title === nextTitle) return tab;
        changed = true;
        return { ...tab, title: nextTitle };
      });
      return changed ? { ...prev, tabs } : prev;
    });
  }, []);

  const reorderTabs = useCallback((activeHref: string, overHref: string) => {
    setState((prev) => {
      const oldIndex = prev.tabs.findIndex((tab) => tab.href === activeHref);
      const newIndex = prev.tabs.findIndex((tab) => tab.href === overHref);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return prev;
      }
      return { ...prev, tabs: arrayMove(prev.tabs, oldIndex, newIndex) };
    });
  }, []);

  const value = useMemo<TabsApi>(
    () => ({
      ...state,
      openTab,
      openInNewTab,
      closeTab,
      setActive,
      updateTabTitle,
      reorderTabs,
    }),
    [state, openTab, openInNewTab, closeTab, setActive, updateTabTitle, reorderTabs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): TabsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTabs must be used within TabBarProvider");
  return ctx;
}

/**
 * GSD-26: nullable accessor for components that may render in a test harness
 * without a TabBarProvider (e.g. FileBrowser unit tests). In-app usage always
 * sits beneath the (app) layout's provider, so this returns a real api in
 * production. Tests omit the provider to keep their surface small.
 */
export function useTabsOptional(): TabsApi | null {
  return useContext(Ctx);
}

export function TabTitleUpdater({
  href,
  title,
}: {
  href: string;
  title: string;
}) {
  const { updateTabTitle } = useTabs();

  useEffect(() => {
    updateTabTitle(href, title);
  }, [href, title, updateTabTitle]);

  return null;
}

function titleFromHref(href: string): string {
  if (href === "/") return "Drive";
  if (href.startsWith("/drive/")) return lastSegment(href);
  if (href.startsWith("/papers/folder/")) return lastSegment(href);
  if (href.startsWith("/papersets")) return "Papersets";
  if (/^\/papers\/[^/]+\/read(\/|$)/.test(href)) return "Reader";
  if (href.startsWith("/papers")) return "Papers";
  if (href.startsWith("/references/folder/")) return lastSegment(href);
  if (href.startsWith("/references")) return "References";
  if (href.startsWith("/notes")) return "Notes";
  if (href.startsWith("/n/")) return decodeURIComponent(href.slice(3));
  if (href.startsWith("/p/")) return "Paper";
  if (href.startsWith("/d/")) return "Paperset";
  if (href.startsWith("/r/")) return "Reference";
  if (href.startsWith("/tags")) return lastSegment(href) || "Tags";
  if (href.startsWith("/agents")) return "Agent";
  if (href.startsWith("/graph")) return "Graph";
  if (href.startsWith("/settings")) return "Settings";
  if (href.startsWith("/trash")) return "Trash";
  return lastSegment(href) || href;
}

/**
 * Compute the visible label for a tab. Strips file extensions for note tabs,
 * trims trailing punctuation for reference tabs, and caps very long titles
 * with an ellipsis. The original title is preserved as the browser tooltip.
 */
export function displayTabLabel(href: string, title: string): string {
  const kind = fileTypeKindFromHref(href);
  let label = title;
  if (kind === "note") {
    label = label.replace(/\.(md|markdown)$/i, "");
  } else if (kind === "reference") {
    label = label.replace(/[.,;:!?]+$/u, "");
  }
  if (label.length > 30) {
    label = label.slice(0, 30) + "…";
  }
  return label;
}

function TabIcon({ href }: { href: string }) {
  const kind = fileTypeKindFromHref(href);
  if (!kind) {
    return (
      <File
        aria-hidden
        data-testid="tab-icon-unknown"
        className="size-3.5 shrink-0 text-[var(--fg-muted)]"
      />
    );
  }
  const Icon = getFileTypeIcon(kind);
  return (
    <Icon
      aria-hidden
      data-testid={`tab-icon-${kind}`}
      className="size-3.5 shrink-0 text-[var(--fg-muted)]"
    />
  );
}

function lastSegment(href: string): string {
  const seg = href.split("/").filter(Boolean).pop();
  return seg ? decodeURIComponent(seg) : "";
}

export function TabBar() {
  const { tabs, activeHref, setActive, closeTab, openTab, reorderTabs } =
    useTabs();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // GSD-26: Cmd/Ctrl+T opens a new tab (Chrome shortcut). We swallow the
  // browser default — without preventDefault Chrome would also open a real
  // browser tab on top of ours.
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === "t" || ev.key === "T")) {
        // Skip when focus is in an editable surface so we don't hijack a
        // user typing a literal "t" while holding a modifier (rare but
        // possible in code-block editors).
        const target = ev.target as HTMLElement | null;
        if (target?.isContentEditable) return;
        ev.preventDefault();
        openTab(DEFAULT_HREF, DEFAULT_TITLE);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openTab]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderTabs(String(active.id), String(over.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={tabs.map((tab) => tab.href)}
        strategy={horizontalListSortingStrategy}
      >
        <div
          role="tablist"
          aria-label="Open tabs"
          data-testid="tab-bar"
          style={{ "--tabbar-h": "52px" } as React.CSSProperties}
          className="flex h-[var(--tabbar-h)] shrink-0 items-end gap-0 overflow-x-auto bg-[var(--bg-roof)] px-3 pt-5"
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.href}
              tab={tab}
              active={tab.href === activeHref}
              onActivate={setActive}
              onClose={closeTab}
            />
          ))}
          <button
            type="button"
            data-testid="tab-bar-new"
            aria-label="New tab"
            onClick={() => openTab(DEFAULT_HREF, DEFAULT_TITLE)}
            className="mb-px flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-roof-2)] hover:text-[var(--fg)]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onActivate: (href: string) => void;
  onClose: (href: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.href });
  const { role: _sortableRole, ...sortableAttributes } = attributes;

  return (
    <div
      ref={setNodeRef}
      role="tab"
      aria-selected={active}
      data-testid="tab-bar-tab"
      data-href={tab.href}
      title={tab.title}
      className={cn(
        "group relative flex h-8 max-w-[180px] items-center gap-1.5 rounded-t-lg px-3 text-[12.5px]",
        active
          ? "z-10 -mb-px bg-background font-medium text-foreground"
          : "text-[var(--fg-muted)] hover:bg-[var(--bg-roof-2)]",
        isDragging && "opacity-70",
      )}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
      {...sortableAttributes}
      {...listeners}
    >
      <button
        type="button"
        onClick={() => onActivate(tab.href)}
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
      >
        <TabIcon href={tab.href} />
        <span className="min-w-0 flex-1 truncate">{displayTabLabel(tab.href, tab.title)}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.href);
        }}
        className="rounded p-0.5 text-[var(--fg-muted)] opacity-0 hover:bg-[var(--bg-roof-2)] hover:text-[var(--fg)] group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
