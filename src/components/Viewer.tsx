import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Annotation, Tag, SelectionPayload } from '../types';
import { getTagColor } from '../lib/tagColors';
import { cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ViewerProps {
  documentId: string;
  annotations: Annotation[];
  tags: Tag[];
  onAddAnnotation: (payload: SelectionPayload) => void;
  onSelectHighlight: (id: string) => void;
  activeAnnotationId: string | null;
  activeTagId: string | null;
}

interface TextSeg {
  node: Text;
  pageIndex: number;
  globalStart: number;
}

interface SelState {
  start: number;
  end: number;
  text: string;
  vpX: number;
  vpY: number;
}

// ── PDF worker (once per session) ─────────────────────────────────────────────

let _workerReady = false;
async function ensureWorker() {
  if (_workerReady) return;
  const lib = await import('pdfjs-dist');
  // @ts-ignore
  const w = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  lib.GlobalWorkerOptions.workerSrc = w.default;
  _workerReady = true;
}

// ── Node helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve a Range boundary (container, offset) to an actual Text node.
 * When range.startContainer is a span element (happens at paragraph starts,
 * triple-click, etc.) we must find the Text child at that child-index.
 */
function resolveToText(container: Node, offset: number): [Text, number] | null {
  if (container.nodeType === Node.TEXT_NODE) {
    return [container as Text, offset];
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    // offset == child index when container is an element
    const child = container.childNodes[offset];
    if (child) {
      if (child.nodeType === Node.TEXT_NODE) return [child as Text, 0];
      // child is a span — find its first text descendant
      const w = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
      const first = w.nextNode() as Text | null;
      if (first) return [first, 0];
    }
    // offset past last child — find last text node in container
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (w.nextNode()) last = w.currentNode as Text;
    if (last) return [last, last.length];
  }
  return null;
}

/** Return the global char offset for a (Text node, local offset) pair. */
function globalOffset(segs: TextSeg[], node: Text, localOff: number): number {
  for (const s of segs) {
    if (s.node === node) return s.globalStart + localOff;
  }
  return -1;
}

/** Binary search: return (Text, localOff) for a given global offset. */
function segAt(segs: TextSeg[], off: number): [Text, number] | null {
  let lo = 0, hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s   = segs[mid];
    const end = mid + 1 < segs.length
      ? segs[mid + 1].globalStart
      : s.globalStart + s.node.length;
    if      (off < s.globalStart) hi = mid - 1;
    else if (off >= end)          lo = mid + 1;
    else return [s.node, off - s.globalStart];
  }
  return null;
}

// ── PDFPage ───────────────────────────────────────────────────────────────────

const SCALE = 1.5;

interface AnnotRect { x: number; y: number; w: number; h: number }

interface PDFPageProps {
  proxy: any;
  idx: number;
  base: number; // global char base for this page
  annotations: Annotation[];
  tags: Tag[];
  activeAnnotationId: string | null;
  activeTagId: string | null;
  allSegs: TextSeg[];
  onSegsReady: (idx: number, segs: TextSeg[], charCount: number) => void;
  onAnnClick: (id: string) => void;
}

function PDFPage({
  proxy, idx, base,
  annotations, tags, activeAnnotationId, activeTagId,
  allSegs, onSegsReady, onAnnClick,
}: PDFPageProps) {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef   = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [annotRects, setAnnotRects] = useState(new Map<string, AnnotRect[]>());

  // ── Render canvas + text overlay ────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    let renderTask: { promise: Promise<any>; cancel: () => void } | null = null;

    (async () => {
      try {
        const dpr  = window.devicePixelRatio || 1;
        const vp   = proxy.getViewport({ scale: SCALE });
        const vpHi = proxy.getViewport({ scale: SCALE * dpr });
        const w = Math.floor(vp.width), h = Math.floor(vp.height);

        const wrap    = wrapRef.current!;
        const canvas  = canvasRef.current!;
        const textDiv = textRef.current!;

        wrap.style.width  = `${w}px`;
        wrap.style.height = `${h}px`;
        canvas.width  = Math.floor(vpHi.width);
        canvas.height = Math.floor(vpHi.height);
        canvas.style.width  = `${w}px`;
        canvas.style.height = `${h}px`;
        textDiv.style.cssText = `position:absolute;top:0;left:0;width:${w}px;height:${h}px;overflow:visible;z-index:2;`;

        renderTask = proxy.render({ canvasContext: canvas.getContext('2d')!, viewport: vpHi });
        await renderTask.promise;
        renderTask = null;
        if (dead) return;

        const content = await proxy.getTextContent();
        if (dead) return;

        textDiv.innerHTML = '';
        const segs: TextSeg[] = [];
        let off = base;

        for (const it of (content.items as any[])) {
          const str: string = it.str ?? '';
          if (!str || !it.transform) continue;

          const tx: number[] = it.transform;
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const [sx, sy] = vp.convertToViewportPoint(tx[4], tx[5]);
          const fsPx = Math.max(fontHeight * SCALE, 1);

          const span = document.createElement('span');
          span.style.position     = 'absolute';
          span.style.left         = `${sx}px`;
          span.style.top          = `${sy - fsPx * 0.8}px`;
          span.style.fontSize     = `${fsPx}px`;
          span.style.lineHeight   = '1';
          span.style.color        = 'transparent';
          span.style.whiteSpace   = 'pre';
          span.style.cursor       = 'text';
          span.style.setProperty('user-select', 'text');
          span.style.setProperty('-webkit-user-select', 'text');
          span.textContent = str;

          const node = span.firstChild as Text;
          segs.push({ node, pageIndex: idx, globalStart: off });
          off += str.length;
          textDiv.appendChild(span);
        }

        console.log(`[Viewer] page ${idx + 1}: ${segs.length} spans, ${off - base} chars`);
        onSegsReady(idx, segs, off - base);
        setRendered(true);
      } catch (err: any) {
        // RenderingCancelledException is expected when cleanup fires mid-render
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`[Viewer] page ${idx + 1} render error:`, err);
        }
      }
    })();

    return () => {
      dead = true;
      renderTask?.cancel();
    };
  }, [proxy, base]);

  // ── Recompute highlight rects when segs or annotations change ───────────────
  useEffect(() => {
    if (!rendered || !allSegs.length || !wrapRef.current) return;

    const pageSegs = allSegs.filter(s => s.pageIndex === idx);
    if (!pageSegs.length) return;

    const pageStart = pageSegs[0].globalStart;
    const last      = pageSegs[pageSegs.length - 1];
    const pageEnd   = last.globalStart + last.node.length;

    const wrapRect = wrapRef.current.getBoundingClientRect();
    const newMap   = new Map<string, AnnotRect[]>();

    for (const ann of annotations) {
      if (ann.endOffset <= pageStart || ann.startOffset >= pageEnd) continue;

      const cStart = Math.max(ann.startOffset, pageStart);
      const cEnd   = Math.min(ann.endOffset,   pageEnd);

      const s = segAt(allSegs, cStart);
      const e = segAt(allSegs, cEnd - 1);
      if (!s || !e) continue;

      try {
        const range = document.createRange();
        range.setStart(s[0], s[1]);
        range.setEnd(e[0], Math.min(e[1] + 1, e[0].length)); // cap at node length
        const rects = Array.from(range.getClientRects())
          .filter(r => r.width > 0 && r.height > 0)
          .map(r => ({ x: r.left - wrapRect.left, y: r.top - wrapRect.top, w: r.width, h: r.height }));
        if (rects.length) newMap.set(ann.id, rects);
      } catch {
        // invalid range (stale nodes from a previous document)
      }
    }
    setAnnotRects(newMap);
  }, [rendered, allSegs, annotations, base, idx]);

  // ── Page-level click: detect annotation clicks via coordinate intersection ──
  // Highlights have pointer-events:none so text selection is never blocked.
  const handleClick = useCallback((e: React.MouseEvent) => {
    // If the user just finished a text selection, don't treat it as an ann click
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    if (!wrapRef.current) return;
    const { left, top } = wrapRef.current.getBoundingClientRect();
    const cx = e.clientX - left;
    const cy = e.clientY - top;

    for (const ann of annotations) {
      const rects = annotRects.get(ann.id);
      if (!rects) continue;
      for (const r of rects) {
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
          onAnnClick(ann.id);
          return;
        }
      }
    }
  }, [annotations, annotRects, onAnnClick]);

  return (
    <div ref={wrapRef} className="relative shadow-[0_4px_32px_rgba(0,0,0,0.12)]" onClick={handleClick}>
      <canvas ref={canvasRef} className="block" />

      {/* Transparent selectable text at exact PDF coordinates */}
      <div ref={textRef} className="textLayer absolute top-0 left-0" />

      {/* Highlight overlays — pointer-events:none so text selection passes through */}
      <div className="absolute inset-0 pointer-events-none">
        {annotations.map(ann => {
          const rects  = annotRects.get(ann.id);
          if (!rects) return null;
          const tag    = tags.find(t => ann.tagIds.includes(t.id));
          const color  = tag ? getTagColor(tag.colorKey) : null;
          const active = activeAnnotationId === ann.id;
          const dimmed = activeTagId !== null && !ann.tagIds.includes(activeTagId);
          return rects.map((r, i) => (
            <div
              key={`${ann.id}-${i}`}
              className={cn('absolute transition-opacity duration-150', active && 'ring-1 ring-inset ring-[#1A1A1A]')}
              style={{
                left:  r.x, top: r.y, width: r.w, height: r.h,
                backgroundColor: color ? color.highlight : '#FDE68A',
                opacity:      dimmed ? 0.15 : (active ? 0.8 : 0.45),
                mixBlendMode: 'multiply',
              }}
            />
          ));
        })}
      </div>
    </div>
  );
}

// ── Viewer ────────────────────────────────────────────────────────────────────

export default function Viewer({
  documentId,
  annotations,
  tags,
  onAddAnnotation,
  onSelectHighlight,
  activeAnnotationId,
  activeTagId,
}: ViewerProps) {
  const [pages,     setPages]     = useState<any[]>([]);
  const [pageBases, setPageBases] = useState<number[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadErr,   setLoadErr]   = useState('');
  const [allSegs,   setAllSegs]   = useState<TextSeg[]>([]);
  const [selState,  setSelState]  = useState<SelState | null>(null);
  const [selTagIds, setSelTagIds] = useState<string[]>([]);
  const [newTagInput,  setNewTagInput]  = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const newTagRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load PDF + pre-compute page char bases ─────────────────────────────────
  useEffect(() => {
    let dead = false;
    setLoading(true);
    setLoadErr('');
    setPages([]);
    setPageBases([]);
    setAllSegs([]);

    (async () => {
      try {
        await ensureWorker();
        const { getDocument } = await import('pdfjs-dist');
        const pdf = await getDocument(`/uploads/${documentId}.pdf`).promise;
        if (dead) return;

        // One pass: fetch text content for char counts, collect proxies
        const proxies: any[] = [];
        const bases: number[] = [];
        let acc = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page    = await pdf.getPage(i);
          const content = await page.getTextContent();
          bases.push(acc);
          acc += (content.items as any[]).reduce((s, it) => s + (it.str?.length ?? 0), 0);
          proxies.push(page);
        }
        if (dead) return;

        setPageBases(bases);
        setPages(proxies);
        setLoading(false);
      } catch (e: any) {
        if (!dead) { setLoadErr(e.message || 'Failed to load PDF'); setLoading(false); }
      }
    })();

    return () => { dead = true; };
  }, [documentId]);

  // ── Restore scroll position once pages are loaded ─────────────────────────
  useEffect(() => {
    if (!pages.length || !scrollRef.current) return;
    try {
      const saved = localStorage.getItem(`textura:scroll:${documentId}`);
      if (saved) scrollRef.current.scrollTop = Number(saved);
    } catch {}
  }, [pages.length, documentId]);

  // ── Scroll to annotation page when active annotation changes ───────────────
  useEffect(() => {
    if (!activeAnnotationId || !scrollRef.current || !pageBases.length) return;
    const ann = annotations.find(a => a.id === activeAnnotationId);
    if (!ann) return;

    let pageIdx = 0;
    for (let i = pageBases.length - 1; i >= 0; i--) {
      if (pageBases[i] <= ann.startOffset) { pageIdx = i; break; }
    }

    const pageEl = scrollRef.current.querySelector(`[data-pdf-page="${pageIdx}"]`);
    pageEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeAnnotationId]);

  // ── Merge page segments into global sorted array ───────────────────────────
  const handleSegsReady = useCallback((pageIdx: number, newSegs: TextSeg[], _count: number) => {
    setAllSegs(prev => {
      const merged = [...prev.filter(s => s.pageIndex !== pageIdx), ...newSegs];
      merged.sort((a, b) => a.globalStart - b.globalStart);
      return merged;
    });
  }, []);

  // ── Text selection → offsets ───────────────────────────────────────────────
  useEffect(() => {
    const onMouseUp = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) { setSelState(null); return; }

        const range = sel.getRangeAt(0);
        if (!allSegs.length) return;

        // Resolve containers — handles element nodes at span boundaries
        const startResolved = resolveToText(range.startContainer, range.startOffset);
        const endResolved   = resolveToText(range.endContainer,   range.endOffset);
        if (!startResolved || !endResolved) {
          console.warn('[Viewer] resolveToText failed', range.startContainer, range.endContainer);
          setSelState(null); return;
        }

        const start = globalOffset(allSegs, startResolved[0], startResolved[1]);
        const end   = globalOffset(allSegs, endResolved[0],   endResolved[1]);
        if (start < 0 || end < 0 || start >= end) {
          console.warn('[Viewer] offset resolution failed', { start, end, segsLen: allSegs.length });
          setSelState(null); return;
        }

        const rect = range.getBoundingClientRect();
        setSelState({ start, end, text: sel.toString(), vpX: rect.left + rect.width / 2, vpY: rect.top });
        setSelTagIds([]);
        setNewTagInput('');
        setShowTagInput(false);
      }, 10);
    };

    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [allSegs]);

  // ── Highlight actions ──────────────────────────────────────────────────────
  const toggleTag = (id: string) =>
    setSelTagIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const doHighlight = () => {
    if (!selState) return;
    onAddAnnotation({
      text:        selState.text,
      startOffset: selState.start,
      endOffset:   selState.end,
      tagIds:      selTagIds,
      newTagLabel: newTagInput.trim() || undefined,
    });
    window.getSelection()?.removeAllRanges();
    setSelState(null);
    setSelTagIds([]);
    setNewTagInput('');
    setShowTagInput(false);
  };

  const onNewTagKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); doHighlight(); }
    if (e.key === 'Escape') { setShowTagInput(false); setNewTagInput(''); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      <span className="animate-pulse">Loading PDF…</span>
    </div>
  );

  if (loadErr) return (
    <div className="flex items-center justify-center h-full text-red-400 text-sm px-8 text-center">
      {loadErr}
    </div>
  );

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-auto custom-scrollbar"
      onScroll={() => {
        if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
        scrollSaveTimer.current = setTimeout(() => {
          try {
            localStorage.setItem(`textura:scroll:${documentId}`, String(scrollRef.current?.scrollTop ?? 0));
          } catch {}
        }, 300);
      }}
    >
      <div className="flex flex-col items-center py-8 px-4 gap-6 bg-[#ECEAE6] min-h-full">
        {pages.map((proxy, i) => (
          <div key={i} data-pdf-page={i}>
            <PDFPage
              proxy={proxy}
              idx={i}
              base={pageBases[i] ?? 0}
              annotations={annotations}
              tags={tags}
              activeAnnotationId={activeAnnotationId}
              activeTagId={activeTagId}
              allSegs={allSegs}
              onSegsReady={handleSegsReady}
              onAnnClick={id => { onSelectHighlight(id); }}
            />
          </div>
        ))}
      </div>

      {/* Selection popup — fixed to viewport, unaffected by scroll */}
      {selState && (
        <div
          className="fixed z-50 animate-in fade-in zoom-in-95 duration-150"
          style={{ top: selState.vpY - 136, left: selState.vpX, transform: 'translateX(-50%)' }}
          onMouseDown={e => e.preventDefault()}
        >
          <div className="bg-white border border-[#E5E2DD] rounded-xl shadow-xl overflow-hidden w-64">
            <div className="px-3 pt-3 pb-2">
              <p className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Assign tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => {
                  const color  = getTagColor(tag.colorKey);
                  const active = selTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all',
                        active ? 'shadow-sm scale-105' : 'opacity-60 hover:opacity-100',
                      )}
                      style={active
                        ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
                        : { backgroundColor: 'transparent', borderColor: '#E5E2DD', color: '#6B7280' }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.dot }} />
                      {tag.label}
                    </button>
                  );
                })}
                {!showTagInput && (
                  <button
                    onClick={() => { setShowTagInput(true); setTimeout(() => newTagRef.current?.focus(), 50); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg width="8" height="8" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    New tag
                  </button>
                )}
              </div>
              {showTagInput && (
                <div className="mt-2 flex gap-1.5">
                  <input
                    ref={newTagRef}
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={onNewTagKey}
                    placeholder="Tag name…"
                    className="flex-1 text-xs px-2 py-1 border border-[#E5E2DD] rounded-lg outline-none focus:border-[#1A1A1A] bg-[#FAFAF8] transition-colors"
                  />
                  <button onClick={() => { setShowTagInput(false); setNewTagInput(''); }} className="text-gray-400 hover:text-gray-600 text-xs px-1">✕</button>
                </div>
              )}
              {tags.length === 0 && !showTagInput && (
                <p className="text-[10px] text-gray-400 italic mt-1">No tags yet</p>
              )}
            </div>
            <div className="border-t border-[#E5E2DD] px-3 py-2 flex items-center justify-between bg-[#FAFAF8]">
              <span className="text-[9px] text-gray-400 uppercase tracking-widest">
                {selTagIds.length > 0
                  ? `${selTagIds.length} tag${selTagIds.length > 1 ? 's' : ''} selected`
                  : newTagInput.trim() ? 'New tag will be created' : 'Untagged highlight'}
              </span>
              <button
                onClick={doHighlight}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
                </svg>
                Highlight
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
