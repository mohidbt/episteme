# Phase 1.3.x Papersets — E2E Gate (Task 17)

Run date: 2026-04-29
Branch: `wt/1.3x-papersets`
Dev server: `localhost:3001` (NOT 3000 — `apps/km` script is `next dev --port 3001`)
Auth model: anonymous (no `/login` page; `POST /api/auth/sign-in/anonymous` runs on first load)

## Status: BLOCKED at Step 12

Step 12 (Trash flow) fails because the backend `POST /api/folders/trash` does not accept `target.kind === "paperset"`. The Drive context menu offers the action, but the API schema rejects it. See note under Step 12.

## Checklist

| #  | Step | Result | Screenshot | Notes |
|----|------|--------|------------|-------|
| 1  | Login | PASS (auto-anon) | `screenshots/01-drive-loaded.png` | App uses better-auth anonymous sign-in. There is no `/login` page; `localhost:3001/login` returns the Next 404 page. Anonymous session created on first load and Drive renders. |
| 2  | Drive create paperset (filename `bench-eval`, column `assay_type`) | PASS | `screenshots/02-paperset-dialog-filled.png` | `POST /api/papersets` returns 201, navigates to `/d/d45ba96c-fafd-4930-8f28-18ba60933dae`. |
| 3  | Empty grid renders + toolbar | PASS | `screenshots/03-empty-grid.png` | `+ Add papers`, `+ Add column`, `Run enrichment ⌘↵` (disabled) all visible. Empty-state copy: "No papers in this paperset yet." |
| 4  | Add column via toolbar (`n_samples`) | PASS (with caveat) | `screenshots/04-two-columns.png` | `POST /api/papersets/:id/columns` returns 200, but the new column did NOT appear in the grid until a manual reload. RSC refresh fired but UI did not pick it up live. Minor staleness bug. |
| 5  | Add papers (multi-select two) | PASS (1 of 2 papers available) | `screenshots/05-paper-picker.png`, `screenshots/05b-row-added.png` | Picker only listed ONE paper ("Retrieval-Augmented Generation…"). The `AlphaFold` tile in Drive is not surfaced by the picker (likely lacks library record / metadata). 1 row added; cells empty (`—`). Plan asked for 2 papers — only 1 was selectable. Not a paperset bug; data shape limitation. |
| 6  | Cell selection + ⌘↵ → enrichment failure | PASS | `screenshots/06a-cell-selected.png`, `screenshots/06b-enrich-failed.png` | Cell `data-selected=true` after click. ⌘↵ POSTs `/enrich`; server returns **400 `add_openrouter_key`** (BYOK gate fires before the 1.4.x `not_implemented` SSE event). UI shows toast "1 cell failed enrichment.", row cell renders "failed", `runningCells` clears, Run button re-enables. Behaviour is correct under failure; we never reached the SSE `not_implemented` payload because BYOK guard preempted it. |
| 7  | Edit column description | PASS | `screenshots/07-edit-persisted.png` | "Edit description" uses native `prompt()` (note: blocks CDP if not handled). Description updated to "What assay was used? (updated)" and persisted across full reload. Verified via `GET /api/papersets/:id` → `columns[0].description`. |
| 8  | Delete column | PASS | `screenshots/08-column-deleted.png` | "Delete column" uses native `confirm()`. After accept, `n_samples` removed; `GET /api/papersets/:id` columns = `[assay_type]`. |
| 9  | By-type page | PASS | `screenshots/09-papersets-list.png` | `/papersets` shows `bench-eval.csv` row with columns/rows/updated. Click navigates back to `/d/<id>`. |
| 10 | Drag paperset row into folder | PASS | `screenshots/10-drag-into-folder.png` | The MCP `drag` tool and HTML5 drag events do NOT fire @dnd-kit (no XHR). Real DnD requires PointerEvent sequence (pointerdown/pointermove*N/pointerup). Manually scripted PointerEvents → `PATCH /api/papersets/:id` 200 → `folderId` updated to Reading List UUID. Listing in `/papersets` now shows folder = "Reading List". |
| 11 | "in N papersets" badge + popover | PASS | `screenshots/11-paper-badge.png`, `screenshots/11b-popover.png` | `/p/<paper_id>` shows chip "in 1 paperset". Click opens popover with link `bench-eval.csv` → `/d/d45ba96c-…`. |
| 12 | Trash flow | **FAIL — BLOCKER** | `screenshots/12-trash-failed.png` | Right-click on paperset in `/drive/Reading%20List` opens context menu with `Move to Trash`. Click triggers `POST /api/folders/trash` body `{libraryId, target:{kind:"paperset", id:…}}` → **400 `{"error":"bad request"}`**. Toast: "Failed to move to trash". Root cause: `apps/km/src/app/api/folders/trash/route.ts:9` Zod schema is `z.enum(["paper","reference","note","folder"])` — does NOT include `"paperset"`. The Drive UI exposes the action, but the backend rejects it. Restore not testable. |
| 13 | Console + network sanity | PASS (on completed steps) | n/a | Only console errors observed are: (a) my exploratory `fetch` probes on `/api/papers/all`, `/api/library/papers`, `/api/papersets/:id/papers/available`, `/api/drive`, `/api/papersets/:id/move` returning 400/404/500 — these are NOT app calls; they came from my evaluate_script attempts to discover endpoints. (b) Final 400 from `POST /api/folders/trash` (Step 12). No unexpected app-code errors elsewhere. |

## Backend bug summary (blocker)

**File:** `apps/km/src/app/api/folders/trash/route.ts:9`
**Fix:** Add `"paperset"` to the Zod enum. The corresponding handler in `lib/folders-server.ts` `moveToTrash` likely also needs a paperset branch.

```ts
// current
kind: z.enum(["paper", "reference", "note", "folder"]),
// needs
kind: z.enum(["paper", "reference", "note", "folder", "paperset"]),
```

The Drive context-menu component already wires `kind: "paperset"` (request body confirms). This is purely a backend schema/handler gap.

## Other observations (non-blocking)

- **Auth model mismatch with task brief.** The brief said to login with `test@mohid.de`/`Testest2026` at `/login`. There is no `/login` page in apps/km — auth is anonymous via better-auth. Step 1 was effectively just "load the home page".
- **Port 3001, not 3000.** `apps/km` package script hardcodes `--port 3001`. Brief referenced 3000.
- **Add-column live-refresh staleness.** After `POST /columns` 200, the new column header does not appear in the grid until a manual reload. Worth filing as a follow-up.
- **`Edit description` / `Delete column` use native `prompt`/`confirm`.** Blocks CDP automation unless dialogs are explicitly handled. Functional, but a Radix dialog would be a better UX (and easier to test).
- **Paper picker only sees 1 of 4 Drive items.** Welcome (note), Reading List (folder), AlphaFold paper (?) are filtered out. AlphaFold appears in Drive as a draggable but isn't selectable. Suggests the picker lookup uses a stricter source than the Drive listing.
- **No app-level `/api/folders/{folderId}` route** for direct nav; folders are addressed by name path `/drive/<URL-encoded-name>`.
