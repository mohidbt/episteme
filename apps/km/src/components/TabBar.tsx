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
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

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
  // When guest-bootstrap navigates to the welcome note, the pathname-sync
  // effect would briefly observe the still-current pathname (e.g. "/") and
  // overwrite the bootstrapped activeHref. Gate the next pathname sync until
  // the router finishes the bootstrap navigation.
  const skipPathSyncUntilRef = useRef<string | null>(null);

  // Hydrate from localStorage after mount (client-only).
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored && (stored.tabs.length > 0 || stored.activeHref)) {
      setState(stored);
    } else if (isAnonymous) {
      // Guest first-paint: Drive + Welcome note, Welcome active.
      const guestState: TabsState = {
        tabs: [
          { href: DEFAULT_HREF, title: DEFAULT_TITLE },
          { href: GUEST_WELCOME_HREF, title: GUEST_WELCOME_TITLE },
        ],
        activeHref: GUEST_WELCOME_HREF,
      };
      setState(guestState);
      if (pathname !== GUEST_WELCOME_HREF) {
        skipPathSyncUntilRef.current = GUEST_WELCOME_HREF;
        router.push(GUEST_WELCOME_HREF);
      }
    }
    persistedRef.current = true;
  }, [isAnonymous, pathname, router]);

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

  // Sync tab state with the current pathname — always ensure a tab exists
  // for wherever the user has navigated.
  useEffect(() => {
    if (!pathname) return;
    const href = normalizeHref(pathname);
    // Suppress the sync until the guest-bootstrap navigation lands on the
    // welcome note; otherwise the bootstrap activeHref gets clobbered.
    if (skipPathSyncUntilRef.current) {
      if (href === skipPathSyncUntilRef.current) {
        skipPathSyncUntilRef.current = null;
      } else {
        return;
      }
    }
    setState((prev) => {
      const exists = prev.tabs.some((t) => t.href === href);
      if (exists) {
        if (prev.activeHref === href) return prev;
        return { ...prev, activeHref: href };
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
      closeTab,
      setActive,
      updateTabTitle,
      reorderTabs,
    }),
    [state, openTab, closeTab, setActive, updateTabTitle, reorderTabs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): TabsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTabs must be used within TabBarProvider");
  return ctx;
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
      className={cn(
        "group relative flex h-8 max-w-[280px] items-center gap-1.5 rounded-t-lg px-3 text-[12.5px]",
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
        className="min-w-0 flex-1 truncate text-left"
        title={tab.href}
      >
        {tab.title}
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
