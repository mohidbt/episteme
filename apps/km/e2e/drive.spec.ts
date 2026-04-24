// ─────────────────────────────────────────────────────────────────────────────
// Phase 0.12 — Drive E2E spec (Task 27, Step 1)
//
// Execution model: Chrome DevTools MCP (NOT Playwright).
// Each scenario is a structured block of:
//   • Preconditions — signed-in state, library/fixture requirements
//   • Steps — click targets identified by data-testid, aria-label, or
//              visible text (for human + AI walker reading the MCP snapshot)
//   • Expectations — DOM assertions via take_snapshot; network check via
//                    list_network_requests (zero 4xx/5xx); console check via
//                    list_console_messages (zero errors)
//   • Screenshot checkpoint — take_screenshot label stored in __meta__/
//
// TypeScript shape mirrors apps/km/e2e/versions.spec.ts:
//   • No Playwright import (no harness wired yet)
//   • Scenarios expressed as test.skip blocks with inline docs
//   • Fixtures referenced by path under apps/km/e2e/fixtures/
//
// Dev server: http://localhost:3001  (pnpm --filter km dev)
// Test user credentials: create via /sign-up before first run, or seed DB.
//
// FIXTURE GAPS — see bottom of this file for details.
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const test: {
  skip: (name: string, fn: () => Promise<void> | void) => void;
};

// When a Chrome DevTools MCP walker runs these scenarios, each `test.skip`
// body is the step-by-step script to follow.  Replace `test.skip` → `test`
// once a harness is wired.

// ─── Scenario 1 — Setup / landing ──────────────────────────────────────────
test.skip(
  "S01: Drive is the default landing page; breadcrumbs show library name only",
  async () => {
    // PRECONDITIONS
    //   • Fresh signed-out Chrome session on http://localhost:3001
    //   • Test user account exists (email: e2e@example.com, password: Test1234!)
    //   • Library "My Library" exists for the user (created via /sign-up flow)

    // STEPS
    //   1. navigate_page → http://localhost:3001/sign-in
    //   2. fill [id="email"] with "e2e@example.com"
    //   3. fill [id="password"] with "Test1234!"
    //   4. click button[type="submit"] ("Sign in")
    //   5. wait_for URL to equal http://localhost:3001/ OR /drive
    //      (sign-in redirects to /papers currently; navigate explicitly to /drive if needed)
    //   6. navigate_page → http://localhost:3001/drive

    // EXPECTATIONS
    //   E1. take_snapshot → DOM includes [aria-label="Breadcrumbs"] nav
    //                        exactly one <a> inside it (the library root link)
    //                        text === "My Library"
    //   E2. take_snapshot → [data-testid="fb-root"] is present (FileBrowser rendered)
    //   E3. take_snapshot → sidebar [data-testid="km-sidebar-library-name"] text === "My Library"
    //   E4. list_console_messages → zero errors
    //   E5. list_network_requests → zero 4xx/5xx

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s01-drive-landing.png
  },
);

// ─── Scenario 2 — Create folder ─────────────────────────────────────────────
test.skip(
  "S02: New ▾ → Folder → name 'Research'; folder tile appears; sidebar Drive tree shows it",
  async () => {
    // PRECONDITIONS
    //   • Signed in (re-use S01 session or repeat sign-in)
    //   • On http://localhost:3001/drive
    //   • No folder named "Research" exists yet

    // STEPS
    //   1. click button[aria-label="New"] (the toolbar "New" button → FileBrowserToolbar)
    //   2. wait_for DropdownMenuContent to appear
    //   3. click DropdownMenuItem with text "Folder"
    //   4. wait_for Dialog with title "New folder" to open
    //   5. fill [id="new-item-folder-name"] with "Research"
    //   6. click button with text "Create"
    //   7. wait_for dialog to close (onOpenChange fires, router.refresh())

    // EXPECTATIONS
    //   E1. take_snapshot → a FileBrowserItem tile with text "Research" is present
    //                        in [data-testid="fb-root"]
    //   E2. take_snapshot → sidebar Drive section contains a button/span with text "Research"
    //                        (DriveFolderRow rendered — expand the Drive group if collapsed)
    //   E3. list_network_requests → POST /api/folders → 201 Created (no 4xx/5xx)
    //   E4. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s02-create-folder.png
  },
);

// ─── Scenario 3 — Create note inside folder ─────────────────────────────────
test.skip(
  "S03: Navigate into 'Research'; New ▾ → Note; open note; type; breadcrumbs show Library · Research · <title>",
  async () => {
    // PRECONDITIONS
    //   • Signed in
    //   • "Research" folder exists at library root (see S02)

    // STEPS
    //   1. navigate_page → http://localhost:3001/drive
    //   2. double-click (or click Enter on) the "Research" tile in [data-testid="fb-root"]
    //      (FileBrowser.handleOpen → router.push("/drive/Research"))
    //   3. wait_for URL === http://localhost:3001/drive/Research
    //   4. take_snapshot → breadcrumbs nav shows "My Library  ›  Research"
    //   5. click button[aria-label="New"] (toolbar)
    //   6. click DropdownMenuItem "Note"
    //   7. wait_for Dialog title "New note"
    //   8. fill [id="new-item-note-title"] with "Attention Mechanisms"
    //   9. click button "Create"
    //   10. wait_for dialog to close; wait_for tile "Attention Mechanisms" in fb-root
    //   11. click the "Attention Mechanisms" tile to navigate to the note
    //   12. wait_for URL to match /n/[slug]
    //   13. type_text into the ProseMirror editor: "Self-attention is all you need."

    // EXPECTATIONS
    //   E1. take_snapshot (at step 4) → nav[aria-label="Breadcrumbs"] contains two <a>
    //         first: "My Library" (href="/drive")
    //         second: "Research" (href="/drive/Research")
    //   E2. take_snapshot (at step 10) → tile "Attention Mechanisms" present in fb-root
    //   E3. take_snapshot (at step 13) → breadcrumbs in note page header show
    //         "My Library · Research · Attention Mechanisms"  (or equivalent)
    //   E4. list_network_requests → POST /api/notes → 201; zero 4xx/5xx
    //   E5. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s03-note-in-folder.png
  },
);

// ─── Scenario 4 — Upload paper inside folder ────────────────────────────────
test.skip(
  "S04: Drop sample.pdf into 'Research'; paper row appears alongside note (mixed cohabitation)",
  async () => {
    // PRECONDITIONS
    //   • Signed in
    //   • Navigated to http://localhost:3001/drive/Research
    //   • Fixture: apps/km/e2e/fixtures/sample.pdf  (exists: 2.1 MB)
    //   • "Research" folder contains at least the "Attention Mechanisms" note from S03

    // STEPS
    //   1. navigate_page → http://localhost:3001/drive/Research
    //   2. click button[aria-label="New"] (toolbar)
    //   3. click DropdownMenuItem "Upload paper…"
    //   4. wait_for Dialog title "Upload paper"
    //   5. upload_file [type="file"][accept=".pdf"] with path
    //        apps/km/e2e/fixtures/sample.pdf
    //   6. wait_for upload progress / success (PaperUploadDropzone emits toast on finish)
    //   7. click button "Done"
    //   8. wait_for dialog to close; router.refresh() fires

    // EXPECTATIONS
    //   E1. take_snapshot → [data-testid="fb-root"] contains both:
    //         - a tile/row with kind="note" and text "Attention Mechanisms"
    //         - a tile/row with kind="paper" (title from PDF metadata or filename)
    //         mixed in the same folder (mixed cohabitation confirmed)
    //   E2. list_network_requests → POST /api/papers + POST /api/papers/:id/finalize
    //         both 200/201 (no 4xx/5xx)
    //   E3. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s04-upload-paper.png

    // FIXTURE NOTE
    //   apps/km/e2e/fixtures/sample.pdf already exists (2.1 MB).
    //   No new fixture needed for this scenario.
  },
);

// ─── Scenario 5 — Drag paper into another folder ────────────────────────────
test.skip(
  "S05: Create 'Inbox'; drag paper from Research to Inbox; paper vanishes from Research, appears in Inbox",
  async () => {
    // PRECONDITIONS
    //   • Signed in; "Research" exists with a paper inside (from S04)
    //   • "Inbox" folder created at library root:
    //       navigate to /drive; New ▾ → Folder → "Inbox"

    // STEPS
    //   1. navigate_page → http://localhost:3001/drive  (library root)
    //   2. New ▾ → Folder → "Inbox" → Create (create sibling folder)
    //   3. navigate_page → http://localhost:3001/drive/Research
    //   4. Identify the paper tile in fb-root (kind="paper")
    //   5. drag the paper tile from its position onto the "Inbox" folder tile
    //      NOTE: DndKit PointerSensor activates after 4 px movement.
    //      Use drag(source_selector, target_selector) from Chrome DevTools MCP.
    //      source: the paper FileBrowserItem tile
    //      target: the "Inbox" FileBrowserItem tile if visible, OR navigate to
    //              /drive and drag from there.
    //   6. wait_for router.refresh() — tile count changes

    // EXPECTATIONS
    //   E1. take_snapshot (in Research) → paper tile is ABSENT from fb-root
    //   E2. navigate_page → http://localhost:3001/drive/Inbox
    //   E3. take_snapshot (in Inbox) → paper tile IS present in fb-root
    //   E4. list_network_requests → PATCH /api/papers/:id → 200 (no 4xx/5xx)
    //   E5. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s05-drag-paper-to-folder.png
  },
);

// ─── Scenario 6 — Drag folder into folder + cycle guard ────────────────────
test.skip(
  "S06: Drag 'Research' into 'Inbox' (nested OK); then drag 'Inbox' into 'Research' → toast 'cycle'",
  async () => {
    // PRECONDITIONS
    //   • Signed in; both "Research" and "Inbox" exist at library root

    // STEPS — part A (valid drag)
    //   1. navigate_page → http://localhost:3001/drive
    //   2. drag the "Research" folder tile onto the "Inbox" folder tile in fb-root
    //   3. wait_for router.refresh()

    // EXPECTATIONS — part A
    //   E1. take_snapshot → "Research" tile is ABSENT from fb-root at /drive root
    //   E2. navigate_page → http://localhost:3001/drive/Inbox
    //   E3. take_snapshot → "Research" folder tile appears inside Inbox
    //   E4. list_network_requests → POST /api/folders/move → 200 (no 4xx/5xx)

    // STEPS — part B (cycle guard)
    //   5. Still on /drive/Inbox
    //   6. drag "Research" tile onto the "Inbox" tile
    //      (this creates a cycle: Research ⊂ Inbox, Inbox ⊂ Research)
    //   7. wait_for sonner toast to appear

    // EXPECTATIONS — part B
    //   E5. take_snapshot → sonner toast visible, text matches
    //         "Cannot move folder into itself"  (FileBrowser.resolveDrop cycle message)
    //   E6. take_snapshot → folder structure unchanged (Research still inside Inbox)
    //   E7. list_console_messages → zero errors (toast, not exception)

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s06-drag-folder-cycle.png
  },
);

// ─── Scenario 7 — Right-click → Move to Trash ───────────────────────────────
test.skip(
  "S07: Right-click a note → 'Move to Trash'; Drive no longer shows it; sidebar Trash badge appears",
  async () => {
    // PRECONDITIONS
    //   • Signed in; "Attention Mechanisms" note exists in "Research" folder

    // STEPS
    //   1. navigate_page → http://localhost:3001/drive/Research
    //      (or navigate to /drive/Inbox/Research if nested from S06)
    //   2. right-click the "Attention Mechanisms" tile in fb-root
    //      (triggers FileBrowserContextMenu)
    //   3. wait_for ContextMenuContent to appear
    //   4. click ContextMenuItem "Move to Trash"
    //   5. wait_for router.refresh()

    // EXPECTATIONS
    //   E1. take_snapshot → "Attention Mechanisms" tile is ABSENT from fb-root
    //   E2. take_snapshot → sidebar [data-testid="sidebar-trash-badge"] is present
    //         (TrashNode nonEmpty dot appears; TrashNode renders it when trashNonEmpty)
    //   E3. list_network_requests → POST /api/folders/trash → 200 (no 4xx/5xx)
    //   E4. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s07-move-to-trash.png
  },
);

// ─── Scenario 8 — Restore from Trash ────────────────────────────────────────
test.skip(
  "S08: Navigate to Trash; right-click note → 'Restore'; note returns to its original folder",
  async () => {
    // PRECONDITIONS
    //   • Signed in; "Attention Mechanisms" note is in Trash (from S07)
    //   • /trash page exists and shows FileBrowser with isTrashView=true

    // STEPS
    //   1. click sidebar [data-testid="sidebar-trash"] link → navigates to /trash
    //   2. wait_for URL === http://localhost:3001/trash
    //   3. take_snapshot → toolbar shows "In Trash" badge and "Empty trash" button
    //   4. right-click the "Attention Mechanisms" tile
    //   5. wait_for ContextMenuContent
    //   6. click ContextMenuItem "Restore"
    //   7. wait_for router.refresh()

    // EXPECTATIONS
    //   E1. take_snapshot (at step 3) → Badge "In Trash" visible;
    //         Button "Empty trash" present (FileBrowserToolbar isTrashView branch)
    //   E2. take_snapshot (after step 7) → "Attention Mechanisms" tile ABSENT from
    //         Trash view (item moved out of trash folder)
    //   E3. navigate_page → http://localhost:3001/drive/Research
    //         (or /drive/Inbox/Research if nested)
    //   E4. take_snapshot → "Attention Mechanisms" tile IS present in Research folder
    //   E5. list_network_requests → POST /api/folders/restore → 200 (no 4xx/5xx)
    //   E6. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s08-restore-from-trash.png
  },
);

// ─── Scenario 9 — Empty Trash ────────────────────────────────────────────────
test.skip(
  "S09: Trash a note; navigate to Trash; 'Empty trash' → confirm; trash empty; item permanently gone",
  async () => {
    // PRECONDITIONS
    //   • Signed in; at least one item exists in trash
    //     (move any note to trash via right-click → Move to Trash)

    // STEPS
    //   1. navigate_page → http://localhost:3001/drive
    //   2. right-click any existing note/paper → "Move to Trash"
    //   3. wait_for router.refresh()
    //   4. click sidebar [data-testid="sidebar-trash"] link
    //   5. wait_for URL === http://localhost:3001/trash
    //   6. click button "Empty trash"
    //      (FileBrowserToolbar → onEmptyTrash → window.confirm dialog)
    //   7. handle_dialog → accept (click OK)
    //   8. wait_for POST /api/folders/empty to complete; router.refresh()

    // EXPECTATIONS
    //   E1. take_snapshot → fb-root in Trash view shows zero tiles/rows (empty state)
    //         text "Drop files here, or click New." or similar empty-state message
    //   E2. take_snapshot → "Empty trash" button is DISABLED (trashCount === 0 prop)
    //   E3. take_snapshot → sidebar [data-testid="sidebar-trash-badge"] is ABSENT
    //         (TrashNode nonEmpty=false, dot removed)
    //   E4. list_network_requests → POST /api/folders/empty → 200 (no 4xx/5xx)
    //   E5. list_console_messages → zero errors
    //
    // DB ASSERTION (manual / optional)
    //   Query: SELECT * FROM folders WHERE is_trash = true AND library_id = <id>
    //   Expected: Trash folder row still exists (container), but all child item rows
    //             (notes/papers/references whose folderId = trashId) are deleted.

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s09-empty-trash.png
  },
);

// ─── Scenario 10 — By-type: /notes ──────────────────────────────────────────
test.skip(
  "S10: Sidebar 'By type > Notes'; list shows all notes with folder chips; click chip → navigates to Drive folder",
  async () => {
    // PRECONDITIONS
    //   • Signed in; at least two notes exist in different folders
    //     (e.g., "Attention Mechanisms" in Research and an untitled note at root)

    // STEPS
    //   1. navigate_page → http://localhost:3001/notes
    //      (or click sidebar ByTypeNav "Notes" link with text "Notes")
    //   2. wait_for URL === http://localhost:3001/notes
    //   3. take_snapshot → table/list of notes with "Folder" column
    //   4. identify a Badge (folder chip) in the Folder column for a note that has a folder
    //   5. click that Badge chip (it is NOT a link in the current implementation;
    //      verify whether clicking the chip navigates — if it does not, this is a
    //      DEFECT to log: chips should navigate to /drive/<folder-path>)

    // EXPECTATIONS
    //   E1. take_snapshot (at step 3) → <table> present; rows include notes with
    //         <td> "Folder" cell showing either a Badge or an em-dash (—) for root notes
    //   E2. take_snapshot (at step 3) → ByTypeNav "Notes" link has
    //         data-[active=true] class applied (active indicator)
    //   E3. (If chip is clickable) After click → URL navigates to /drive/<folder-name>
    //       (E3 may be a DEFECT if unimplemented — document result either way)
    //   E4. list_network_requests → GET /notes → 200; zero 4xx/5xx
    //   E5. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s10-by-type-notes.png
  },
);

// ─── Scenario 11 — Folder filter on /papers ─────────────────────────────────
test.skip(
  "S11: 'Filter by folder ▾' on /papers; pick a folder; URL gets ?folder=<id>; only that folder's papers show",
  async () => {
    // PRECONDITIONS
    //   • Signed in; at least one paper exists in "Inbox" folder (from S05)
    //   • At least one paper exists at library root (or another folder)
    //     so the filter effect is observable

    // STEPS
    //   1. navigate_page → http://localhost:3001/papers
    //   2. take_snapshot → all visible papers listed; "Filter by folder" dropdown visible
    //   3. click the FolderFilterDropdown trigger button (text "Filter by folder")
    //   4. wait_for DropdownMenuContent to appear
    //   5. click DropdownMenuItem "Inbox" (or the folder that has the uploaded paper)
    //   6. wait_for URL to contain "?folder=" + the folder's ID

    // EXPECTATIONS
    //   E1. take_snapshot (step 2) → button with text "Filter by folder" visible
    //         and includes a ChevronDown icon
    //   E2. take_snapshot (step 6) → URL === http://localhost:3001/papers?folder=<folderId>
    //         (observable in the page title or via evaluate_script location.href)
    //   E3. take_snapshot (step 6) → PaperGrid renders ONLY papers whose folderId
    //         matches the selected folder's ID
    //   E4. take_snapshot (step 6) → text "Showing papers in Inbox" is visible
    //         and "Clear filter" link is present
    //   E5. click "Clear filter" link → URL === http://localhost:3001/papers (no ?folder)
    //   E6. list_network_requests → zero 4xx/5xx
    //   E7. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s11-papers-folder-filter.png
  },
);

// ─── Scenario 12 — Import zip with nested path ──────────────────────────────
test.skip(
  "S12: /settings/data import a zip with a/b/note.md; pick target 'Research'; zip lands in Research/a/b/note.md",
  async () => {
    // PRECONDITIONS
    //   • Signed in; "Research" folder exists
    //   • Fixture: apps/km/e2e/fixtures/import-nested.zip  ← MISSING; see FIXTURE GAPS below
    //     Contents of the zip:
    //       a/b/note.md   (content: "# Nested Note\n\nCreated by import E2E.")
    //     The zip must be a valid ZIP archive (not a renamed tar or empty file).

    // STEPS
    //   1. navigate_page → http://localhost:3001/settings/data
    //   2. take_snapshot → "Import from file" row visible with "Choose file…" button
    //   3. click button "Import into: Library root (change…)"  (ImportControls folder picker)
    //   4. wait_for MoveToDialog with title "Import into folder" to open
    //   5. click the "Research" option in the folder picker
    //   6. wait_for dialog to close; label now reads "Import into: Research (change…)"
    //   7. click button "Choose file…"
    //   8. upload_file the hidden <input[type="file"][accept=".zip,.md"]> with path
    //        apps/km/e2e/fixtures/import-nested.zip
    //   9. take_snapshot → file name "import-nested.zip" shown beside the button
    //   10. click button "Upload"
    //   11. wait_for POST /api/libraries/:id/import to complete (may take ~2 s)
    //   12. wait_for sonner toast success (text "Imported N items")

    // EXPECTATIONS
    //   E1. take_snapshot (step 9) → truncated filename visible ("import-ne…" or similar)
    //   E2. take_snapshot (step 12) → toast "Imported 1 item" visible (1 note created)
    //   E3. navigate_page → http://localhost:3001/notes
    //   E4. take_snapshot → notes list includes a row titled "Nested Note"
    //         with folder chip showing "Research › a › b" (full breadcrumb)
    //   E5. navigate_page → http://localhost:3001/drive/Research
    //         (or /drive/Inbox/Research if nested from S06)
    //   E6. take_snapshot → folder rows "a" present inside Research
    //   E7. navigate into Research/a/b  → take_snapshot → "Nested Note" note tile present
    //   E8. list_network_requests → POST /api/libraries/:id/import → 200 (no 4xx/5xx)
    //   E9. list_console_messages → zero errors

    // SCREENSHOT CHECKPOINT
    //   take_screenshot → save as apps/km/e2e/__meta__/0.12-s12-import-nested-zip.png
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE GAPS
// ─────────────────────────────────────────────────────────────────────────────
//
// PRESENT fixtures (apps/km/e2e/fixtures/):
//   sample.pdf      — 2.1 MB, used in S04. Sufficient.
//   refs.ris        — not used by these scenarios.
//   vaswani.bib     — not used by these scenarios.
//
// MISSING fixtures:
//
// 1. apps/km/e2e/fixtures/import-nested.zip   (needed by S12)
//    Required content layout:
//      a/
//        b/
//          note.md   (frontmatter: "---\ntitle: Nested Note\n---\n\n# Nested Note\n\nCreated by import E2E.")
//    Creation command (run once from repo root):
//      mkdir -p /tmp/e2e-import/a/b
//      printf -- '---\ntitle: Nested Note\n---\n\n# Nested Note\n\nCreated by import E2E.\n' \
//        > /tmp/e2e-import/a/b/note.md
//      cd /tmp/e2e-import && zip -r import-nested.zip a/
//      cp /tmp/e2e-import/import-nested.zip \
//        apps/km/e2e/fixtures/import-nested.zip
//    The file is a plain ZIP; no password, no compression quirks needed.
//    Expected size: < 1 KB.
//
//    NOTE: Creating binary files (ZIP) via this spec is impractical.
//    The fixture must be created manually or via a setup script before
//    running S12. A TODO comment is left in place of the fixture creation.
// ─────────────────────────────────────────────────────────────────────────────
