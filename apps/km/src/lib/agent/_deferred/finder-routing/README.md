# Parked: GSD-96 R4 Finder routing + composer drop wiring

This directory contains the R4 routing pipeline (PDF / .md / .bib / .ris /
image / .csv / other) plus the composer-level drop hook. Parked per user
feedback on GSD-105: "no new chat uploads from the composer for now".

## Why parked

R6 (GSD-105) reshaped the chat composer into a Tiptap surface with
inline wikilink-style chips. The user no longer wants drop-into-composer
file ingestion in this iteration; library handles (papers, notes,
references) come in via `@`-mention + inline chip instead.

## Originating PR / commit

- R4 ship: https://github.com/mohidbt/episteme PR #14
- Commit on `main`: `ee09fc9` `feat(gsd-96-r4): Finder drop routing (PDF/MD/BIB/RIS/image/CSV/other) + chip lifecycle (#14)`

## What is parked here

- `finder-routing.ts` — classifier + dispatch table.
- `__tests__/finder-routing.test.ts` — unit tests for classification.
- `FinderDropDispatch.tsx` — `useFinderDropDispatch` hook + `FinderChips` UI.
- `__tests__/composer-finder-routing.test.tsx` — composer-level integration.

## How to resurrect

1. `git mv` these files back to their original paths:
   - `apps/km/src/lib/agent/_deferred/finder-routing/finder-routing.ts`
     → `apps/km/src/lib/agent/finder-routing.ts`
   - `apps/km/src/lib/agent/_deferred/finder-routing/__tests__/finder-routing.test.ts`
     → `apps/km/src/lib/agent/__tests__/finder-routing.test.ts`
   - `apps/km/src/lib/agent/_deferred/finder-routing/FinderDropDispatch.tsx`
     → `apps/km/src/components/agent/FinderDropDispatch.tsx`
   - `apps/km/src/lib/agent/_deferred/finder-routing/__tests__/composer-finder-routing.test.tsx`
     → `apps/km/src/components/agent/__tests__/composer-finder-routing.test.tsx`
2. Re-import `useFinderDropDispatch` + `FinderChips` in
   `apps/km/src/components/agent/AgentTranscript.tsx` (was around the
   `useChatAttachments` block) and re-wire `chat-input-dropzone`'s
   `onDrop` to call `finderDispatch(e.dataTransfer.files)` instead of
   `addFiles`.
3. Re-add the `FinderChips` row above the composer.
4. Remove the `vitest.config.ts` exclude for `_deferred/`.

The Tiptap composer itself does NOT need to be reverted to bring back
finder routing. Drop targets and `useDroppable("chat-composer")` were
moved out of `ChatComposer` in R6 — bring them back here as part of the
resurrection, not in this `_deferred/` copy.
