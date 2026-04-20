---
name: e2e-testing
description: Use when verifying bug fixes or features in the browser. Covers login, Chrome DevTools MCP usage, and worktree DB setup. Trigger on E2E testing, browser verification, visual testing, or Chrome DevTools testing.
---

# E2E Testing with Chrome DevTools

## Test Account

- **Email:** `test@mohid.de`
- **Password:** `Testest2026`
- **Login URL:** `http://localhost:3000/login`

## Chrome DevTools MCP — Required Tool

Always use the `chrome-devtools` MCP tools. Never use Playwright or manual browser instructions.

### Workflow

1. **Open an isolated page** — use `isolatedContext` to avoid stale cookie issues:
   ```
   new_page({ url: "http://localhost:3000/login", isolatedContext: "e2e-<name>" })
   ```
2. **Take snapshot** (`take_snapshot`) to get element UIDs, then `fill` + `click` to log in.
3. **Prefer `evaluate_script`** over `take_snapshot` for large pages (reader view snapshots exceed token limits). Use JS to query DOM state, click buttons, and read results.
4. **`take_screenshot`** for visual verification (selection overlays, layout, rendering).
5. **`wait_for`** with a text array + timeout after navigation.

### Tips

- If `take_snapshot` returns a token-limit error, switch to `evaluate_script` to query specific elements.
- Clear inputs before filling if autofill may have pre-populated values (use `evaluate_script` to set `.value = ''` and dispatch `input` event).
- For React controlled inputs, use the native setter: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`.

## Worktree Database Setup

**This project uses `.env.local`, not `.env`.** The main DB runs in Docker on the host.

When working in a git worktree:

1. **Symlink `.env.local`** from main repo — do NOT copy it:
   ```bash
   ln -s /Users/mohidbutt/Documents/Claudius/inhale/.env.local <worktree>/.env.local
   ```
2. **Run `npm install`** — worktrees don't share `node_modules`.
3. The DB (`postgresql://inhale:inhale_dev@localhost:5432/inhale`) is shared across all worktrees via the symlinked env. No separate migration needed.

**Common failure:** "Sign in failed" in a worktree almost always means the `.env.local` symlink is missing or a dangling `.env` was created instead.

## Dev Server

```bash
# Kill existing, start fresh
lsof -ti:3000 | xargs kill -9 2>/dev/null
npm run dev  # run in background
# Verify
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Always confirm the dev server is running **from the worktree directory**, not the main repo.
