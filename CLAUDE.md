# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build to dist/
npm run lint         # Type-check only (./node_modules/.bin/tsc --noEmit) — no test suite exists
npm run clean        # Remove dist/
```

No test runner is configured. Type-check with `./node_modules/.bin/tsc --noEmit` (the shell PATH may not include node_modules/.bin, use the local binary directly).

## Architecture

**Textura** (v2.0) is a fully client-side React app for PDF annotation with a user-built knowledge graph. There is no backend and no AI dependency — all processing runs in the browser.

### Data flow

1. **Upload** (`PDFUploader`) → user drops/selects a PDF
2. **Text extraction** (`App.tsx:handleUpload`) → `pdfjs-dist` extracts all page text in-browser, concatenating with `\n\n` separators
3. **State** (`App.tsx`) holds everything for the session — nothing is persisted to `localStorage` or a server

### State structure (`App.tsx`)

```ts
documentData: { text: string } | null
annotations:  Annotation[]          // text highlights with notes and tag assignments
tags:         Tag[]                 // user-created concept nodes
tagRelations: TagRelation[]         // user-drawn edges between tags
activeAnnotationId: string | null
activeTagId:  string | null         // "focus mode" — dims unrelated annotations in Viewer
```

### Key types (`src/types.ts`)

```ts
Tag          // { id, label, colorKey: number }         colorKey indexes TAG_PALETTE
TagRelation  // { id, sourceId, targetId, label }
Annotation   // { id, text, note, startOffset, endOffset, tagIds: string[] }
DocumentData // { text: string }
SelectionPayload // emitted by Viewer when creating a highlight
```

### Color system (`src/lib/tagColors.ts`)

`TAG_PALETTE` is an array of 8 `TagColor` objects (`{ bg, border, dot, text, highlight }`). `getTagColor(colorKey)` resolves a palette entry (wraps with mod). `nextColorKey(existingKeys)` picks the next unused slot. Tag highlight backgrounds in the Viewer use `color.highlight`; annotation card backgrounds use `color.bg`.

### Components

- **`App.tsx`** — orchestrator; owns all state; handles tag/relation/annotation CRUD. The inline `TagCreator` component lives at the bottom of this file.
- **`MapCanvas.tsx`** — interactive D3 force graph. Nodes = tags, edges = tag relations. Key interactions:
  - Drag within a node to **move** it (position gets pinned in `positionCacheRef` so it survives React re-renders)
  - Drag from the outer ring (hover to reveal) to **draw an edge**; drop on another node to connect
  - Click node → floating rename/delete toolbar; double-click → inline rename form
  - Click edge → floating label editor + delete
  - A D3 simulation re-initializes on `[tags, tagRelations]` change; node positions are restored from `positionCacheRef`
- **`Viewer.tsx`** — renders extracted text with `<mark>` overlays. Offset tracking uses a `TreeWalker`. When `activeTagId` is set, non-matching highlights dim to 20% opacity. The selection popup lets users assign existing tags or create a new one before highlighting.
- **`HighlightsPanel.tsx`** — annotation cards with tag chip row (click chip to remove), tag picker dropdown (assign existing or create new inline), note textarea, jsPDF export.
- **`PDFUploader.tsx`** — drag-and-drop + file input, `application/pdf` only.

### Layout

```
header (h-16)
main (flex-1, grid-cols-12)
  col-span-7  →  Viewer (document text with highlights)
  col-span-5  →  sidebar (tab: Annotations | Adjacency Map)
                   Map tab = TagCreator input bar + MapCanvas
footer (h-8)    →  counts + focus-mode status
```

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` — no `tailwind.config.*` file needed. `cn()` in `src/lib/utils.ts` combines `clsx` + `tailwind-merge`. Design tokens: off-white `#FCFAF7`, near-black `#1A1A1A`, border `#E5E2DD`.
