# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (includes native better-sqlite3 compilation)
npm run dev          # Start both server + Vite concurrently (recommended)
npm run server       # Express server only  (port 3001, tsx watch)
npm run dev:client   # Vite frontend only   (port 3000)
npm run build        # Production Vite build → dist/
npm run lint         # tsc --noEmit on src/ only (no test suite)
```

`npm run dev` uses `concurrently` to run both processes. The Vite dev server proxies `/api/*` and `/uploads/*` to `http://localhost:3001`.

### Type-check the server separately

```bash
./node_modules/.bin/tsc --noEmit -p server/tsconfig.json
```

## Architecture

**Textura** (v2.0) is a PDF annotation + manual knowledge-graph tool. The frontend is React + Vite (port 3000); the backend is Express + SQLite (port 3001). All data is local — no external services.

---

### Backend (`server/`)

**`server/db.ts`** — SQLite via `better-sqlite3`. All queries are pre-compiled as prepared statements (compiled once at module load for maximum throughput). Key configuration:
- WAL journal mode — allows concurrent reads during writes
- `synchronous = NORMAL` — safe under WAL without full-sync overhead
- 32 MB page cache, temp tables in memory
- Foreign keys enforced; all child tables cascade-delete from `documents`
- Three triggers auto-bump `documents.updated_at` whenever tags, relations, or annotations change

**Schema** (5 tables):
```
documents       id, original_name, file_path, text, created_at, updated_at
tags            id, document_id →documents, label, color_key, created_at
tag_relations   id, document_id →documents, source_id →tags, target_id →tags, label, created_at
annotations     id, document_id →documents, text, note, start_offset, end_offset, created_at, updated_at
annotation_tags annotation_id →annotations, tag_id →tags  (junction, composite PK)
```

All `document_id`, `source_id`, `target_id`, `annotation_id`, `tag_id` foreign-key columns have explicit indexes.

**`server/routes/documents.ts`** — Multer handles PDF upload (200 MB limit). Upload flow: client extracts text client-side (pdfjs), POSTs `multipart/form-data` with `file` + `text` → server stores `data/uploads/{id}.pdf`, inserts document row, returns `DocumentFull` in one response.

**REST surface** (all under `/api`):
```
GET    /documents             → DocumentSummary[] (counts, no text)
GET    /documents/:id         → DocumentFull (text + tags + relations + annotations)
POST   /documents             → multipart: file + text → DocumentFull
DELETE /documents/:id         → 204, deletes file + DB rows (cascades)

POST   /documents/:docId/tags       → { label, colorKey } → Tag
PATCH  /tags/:id                    → { label }
DELETE /tags/:id                    → 204

POST   /documents/:docId/relations  → { sourceId, targetId } → TagRelation (409 if duplicate)
PATCH  /relations/:id               → { label }
DELETE /relations/:id               → 204

POST   /documents/:docId/annotations → { text, note, startOffset, endOffset, tagIds } → Annotation
PATCH  /annotations/:id             → { note?, tagIds? }
PATCH  /annotations/:id/toggle-tag  → { tagId } → { added: boolean }
DELETE /annotations/:id             → 204
```

**Data directory** — created automatically at startup:
```
data/
  textura.db       SQLite database (+ -shm, -wal WAL files)
  uploads/         Stored PDFs, named {nanoid}.pdf
  uploads/tmp/     Multer temp dir, cleared after rename
```

---

### Frontend (`src/`)

**`src/lib/api.ts`** — typed fetch wrapper. All mutations return typed data or `void`. Errors throw `Error` with the server's `error` message. Use `api.*` everywhere — no raw `fetch` in components.

**State + sync strategy** (`App.tsx`):
- Local React state is the **immediate source of truth** (optimistic updates)
- Every mutation fires a background `sync()` call — local state updates first, API call follows
- Note edits are **500ms debounced** (`noteTimers` ref) to avoid hammering the DB on keystrokes
- Optimistic tag/annotation IDs (nanoid) get replaced with server IDs on response
- `pendingSaves` counter drives the `SaveIndicator` (saved / saving… / error)
- On tag create: color key chosen by `nextColorKey()` to avoid reusing colors in-use

**`src/types.ts`** key types:
```ts
Tag            { id, label, colorKey: number }   colorKey indexes TAG_PALETTE
TagRelation    { id, sourceId, targetId, label }
Annotation     { id, text, note, startOffset, endOffset, tagIds: string[] }
DocumentData   { id, text, originalName }
SelectionPayload  emitted by Viewer when creating a highlight
```

**`src/lib/tagColors.ts`** — `TAG_PALETTE` (8 `TagColor` entries). `getTagColor(colorKey)` resolves with mod-wrap. `nextColorKey(existingKeys)` picks the first unused slot.

**Component responsibilities:**
- **`DocumentLibrary`** — home screen; document card grid with delete confirmation; full-page drop zone when empty
- **`MapCanvas`** — interactive D3 force graph. Nodes = tags, edges = tag relations. Node drag: move (pins position in `positionCacheRef` across React re-renders). Drag from outer hover-ring: draw ghost edge, drop on node to connect. Click node: rename/delete toolbar. Click edge: label editor + delete. `activeTagId` dims non-matching nodes to 35%.
- **`Viewer`** — text with `<mark>` highlight overlays. Selection popup: tag chip toggles + new-tag inline input. Highlight color from primary tag's `color.highlight`. `activeTagId` focus mode dims all non-matching highlights.
- **`HighlightsPanel`** — annotation cards: colored tag chips (click removes), tag picker dropdown (assign existing or create new), jsPDF export, debounced note textarea.
- **`PDFUploader`** — drag-and-drop + file input (now only used for the initial empty-library state).

**Layout:**
```
header (h-16) — filename + save status + ← Library button
main  (grid-cols-12)
  col-span-7 → Viewer
  col-span-5 → sidebar: [Annotations | Adjacency Map] tabs
                Map tab: TagCreator input bar + MapCanvas
footer (h-8)  — tag/relation/annotation counts + active focus tag
```

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` — no `tailwind.config.*` needed. `cn()` in `src/lib/utils.ts` combines `clsx` + `tailwind-merge`. Design tokens: off-white `#FCFAF7`, near-black `#1A1A1A`, border `#E5E2DD`.

## Working with AI here

`npm run lint` is `tsc --noEmit` and there is no test suite, so a green type-check says nothing about runtime behavior here. The correctness seams to check before trusting a change to `App.tsx` sync or `server/db.ts`: optimistic updates reconciling nanoid IDs against server IDs, the 500ms note debounce racing a delete, cascade deletes and FK integrity, the 409-on-duplicate-relation path.
