import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PDFUploader from './components/PDFUploader';
import Viewer from './components/Viewer';
import MapCanvas from './components/MapCanvas';
import HighlightsPanel from './components/HighlightsPanel';
import MetricsPanel from './components/MetricsPanel';
import DocumentLibrary from './components/DocumentLibrary';
import { DocumentData, Annotation, Tag, TagRelation, SelectionPayload } from './types';
import { cn } from './lib/utils';
import { getTagColor, nextColorKey } from './lib/tagColors';
import { nanoid } from 'nanoid';
import { api, type DocumentSummary } from './lib/api';

// ── Save status ───────────────────────────────────────────────────────────────

type SaveStatus = 'saved' | 'saving' | 'error';

function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors', {
      'text-gray-400':   status === 'saved',
      'text-amber-500':  status === 'saving',
      'text-red-500':    status === 'error',
    })}>
      <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-emerald-400': status === 'saved',
        'bg-amber-400 animate-pulse': status === 'saving',
        'bg-red-500': status === 'error',
      })} />
      {status === 'saved'  ? 'Saved'    : ''}
      {status === 'saving' ? 'Saving…'  : ''}
      {status === 'error'  ? 'Save error' : ''}
    </span>
  );
}

// ── PDF text extraction ───────────────────────────────────────────────────────

type PdfTextItem = {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
  width: number;
  height: number;
  hasEOL: boolean;
};

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  // @ts-ignore
  const pdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker.default;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const items = (content.items as PdfTextItem[]).filter(it => it.str);
    if (items.length === 0) { pages.push(''); continue; }

    // Sort top-to-bottom (PDF y is from page bottom, so descending), left-to-right within a line
    const sorted = [...items].sort((a, b) => {
      const dy = b.transform[5] - a.transform[5];
      if (Math.abs(dy) > 2) return dy;
      return a.transform[4] - b.transform[4];
    });

    // Group into lines: items whose y-positions are within 50% of font height belong together
    type Line = { y: number; height: number; items: PdfTextItem[] };
    const lines: Line[] = [];
    for (const item of sorted) {
      const y = item.transform[5];
      const h = Math.abs(item.height) || 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) <= last.height * 0.5) {
        last.items.push(item);
      } else {
        lines.push({ y, height: h, items: [item] });
      }
    }

    // Build text from lines; detect paragraph breaks via vertical gap
    let pageText = '';
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      line.items.sort((a, b) => a.transform[4] - b.transform[4]);

      // Stitch items within the line, adding a space when there is an x-gap
      let lineText = '';
      for (let k = 0; k < line.items.length; k++) {
        const item = line.items[k];
        if (k === 0) {
          lineText = item.str;
        } else {
          const prev = line.items[k - 1];
          const gap = item.transform[4] - (prev.transform[4] + prev.width);
          lineText += (gap > 0.5 ? ' ' : '') + item.str;
        }
        if (item.hasEOL) lineText += '\n';
      }

      if (j === 0) {
        pageText = lineText;
        continue;
      }

      const prev = lines[j - 1];
      const vertGap = prev.y - line.y;
      const avgHeight = (prev.height + line.height) / 2;
      pageText += (vertGap > avgHeight * 1.5 ? '\n\n' : '\n') + lineText;
    }

    pages.push(pageText);
  }

  const full = pages.filter(Boolean).join('\n\n').trim();
  return full || '(No extractable text found. This PDF may be image-based.)';
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Library state
  const [documents,  setDocuments]  = useState<DocumentSummary[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [serverDown, setServerDown] = useState(false);

  // Active document state
  const [documentData,       setDocumentData]       = useState<DocumentData | null>(null);
  const [annotations,        setAnnotations]        = useState<Annotation[]>([]);
  const [tags,               setTags]               = useState<Tag[]>([]);
  const [tagRelations,       setTagRelations]        = useState<TagRelation[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [activeTagId,        setActiveTagId]        = useState<string | null>(null);
  const [activeTab,          setActiveTab]          = useState<'highlights' | 'map' | 'metrics'>('highlights');

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tag of tags) counts[tag.id] = 0;
    for (const ann of annotations) {
      for (const tid of ann.tagIds) {
        if (tid in counts) counts[tid]++;
      }
    }
    return counts;
  }, [tags, annotations]);

  // Upload / save state
  const [isUploading,  setIsUploading]  = useState(false);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [saveError,    setSaveError]    = useState(false);

  // Debounce timers for note saves (keyed by annotation id)
  const noteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const saveStatus: SaveStatus = saveError ? 'error' : pendingSaves > 0 ? 'saving' : 'saved';

  // ── Background server sync ──────────────────────────────────────────────────

  const sync = useCallback(async (fn: () => Promise<void>) => {
    setPendingSaves(n => n + 1);
    setSaveError(false);
    try {
      await fn();
    } catch (err) {
      console.error('[sync error]', err);
      setSaveError(true);
    } finally {
      setPendingSaves(n => n - 1);
    }
  }, []);

  // ── Load document library on mount ─────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        await api.health();
        const docs = await api.documents.list();
        setDocuments(docs);
      } catch {
        setServerDown(true);
      } finally {
        setLibLoading(false);
      }
    })();
  }, []);

  // ── Upload handler ──────────────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const text = await extractPdfText(file);

      const form = new FormData();
      form.append('file', file);
      form.append('text', text);

      const doc = await api.documents.create(form);

      // Refresh library
      setDocuments(await api.documents.list());

      // Open the new document immediately
      setDocumentData({ id: doc.id, text: doc.text, originalName: doc.originalName });
      setTags(doc.tags);
      setTagRelations(doc.tagRelations);
      setAnnotations(doc.annotations);
      setActiveAnnotationId(null);
      setActiveTagId(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to process document.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleOpenDocument = async (id: string) => {
    setLibLoading(true);
    try {
      const doc = await api.documents.get(id);
      setDocumentData({ id: doc.id, text: doc.text, originalName: doc.originalName });
      setTags(doc.tags);
      setTagRelations(doc.tagRelations);
      setAnnotations(doc.annotations);
      setActiveAnnotationId(null);
      setActiveTagId(null);
      setSaveError(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load document.');
    } finally {
      setLibLoading(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await api.documents.delete(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete document.');
    }
  };

  const handleCloseDocument = () => {
    setDocumentData(null);
    setAnnotations([]);
    setTags([]);
    setTagRelations([]);
    setActiveAnnotationId(null);
    setActiveTagId(null);
    // Refresh library counts
    api.documents.list().then(setDocuments).catch(() => {});
  };

  // ── Tag management ──────────────────────────────────────────────────────────

  const handleCreateTag = useCallback((label: string): Tag => {
    const colorKey = nextColorKey(tags.map(t => t.colorKey));
    const optimistic: Tag = { id: nanoid(), label: label.trim(), colorKey };
    setTags(prev => [...prev, optimistic]);

    if (documentData) {
      sync(() =>
        api.tags.create(documentData.id, label.trim(), colorKey).then(server => {
          // Replace optimistic id with server-assigned id
          setTags(prev => prev.map(t => t.id === optimistic.id ? server : t));
          setAnnotations(prev => prev.map(a => ({
            ...a,
            tagIds: a.tagIds.map(id => id === optimistic.id ? server.id : id),
          })));
        })
      );
    }
    return optimistic;
  }, [tags, documentData, sync]);

  const handleRenameTag = useCallback((id: string, label: string) => {
    setTags(prev => prev.map(t => t.id === id ? { ...t, label: label.trim() } : t));
    sync(() => api.tags.rename(id, label.trim()));
  }, [sync]);

  const handleDeleteTag = useCallback((id: string) => {
    setTags(prev => prev.filter(t => t.id !== id));
    setTagRelations(prev => prev.filter(r => r.sourceId !== id && r.targetId !== id));
    setAnnotations(prev => prev.map(a => ({ ...a, tagIds: a.tagIds.filter(tid => tid !== id) })));
    if (activeTagId === id) setActiveTagId(null);
    sync(() => api.tags.delete(id));
  }, [activeTagId, sync]);

  // ── Relation management ─────────────────────────────────────────────────────

  const handleCreateRelation = useCallback((sourceId: string, targetId: string) => {
    const already = tagRelations.some(
      r => (r.sourceId === sourceId && r.targetId === targetId) ||
           (r.sourceId === targetId && r.targetId === sourceId)
    );
    if (already) return;

    const optimistic: TagRelation = { id: nanoid(), sourceId, targetId, label: '' };
    setTagRelations(prev => [...prev, optimistic]);

    if (documentData) {
      sync(() =>
        api.relations.create(documentData.id, sourceId, targetId).then(server => {
          if (server) {
            setTagRelations(prev => prev.map(r => r.id === optimistic.id ? server : r));
          }
        })
      );
    }
  }, [tagRelations, documentData, sync]);

  const handleUpdateRelationLabel = useCallback((id: string, label: string) => {
    setTagRelations(prev => prev.map(r => r.id === id ? { ...r, label } : r));
    sync(() => api.relations.updateLabel(id, label));
  }, [sync]);

  const handleDeleteRelation = useCallback((id: string) => {
    setTagRelations(prev => prev.filter(r => r.id !== id));
    sync(() => api.relations.delete(id));
  }, [sync]);

  // ── Annotation management ───────────────────────────────────────────────────

  const handleAddAnnotation = useCallback(async (payload: SelectionPayload) => {
    let finalTagIds = [...payload.tagIds];

    if (payload.newTagLabel?.trim() && documentData) {
      // Create tag server-side first so the annotation FK is valid
      const colorKey = nextColorKey(tags.map(t => t.colorKey));
      const optimisticTag: Tag = { id: nanoid(), label: payload.newTagLabel.trim(), colorKey };
      setTags(prev => [...prev, optimisticTag]);
      try {
        const serverTag = await api.tags.create(documentData.id, optimisticTag.label, colorKey);
        setTags(prev => prev.map(t => t.id === optimisticTag.id ? serverTag : t));
        finalTagIds = [...finalTagIds, serverTag.id];
      } catch {
        finalTagIds = [...finalTagIds, optimisticTag.id]; // best-effort fallback
      }
    }

    const optimistic: Annotation = {
      id: nanoid(),
      text: payload.text,
      startOffset: payload.startOffset,
      endOffset: payload.endOffset,
      note: '',
      createdAt: Date.now(),
      tagIds: finalTagIds,
    };

    setAnnotations(prev => [...prev, optimistic]);
    setActiveAnnotationId(optimistic.id);
    setActiveTab('highlights');

    if (documentData) {
      sync(() =>
        api.annotations.create(documentData.id, {
          text: payload.text,
          note: '',
          startOffset: payload.startOffset,
          endOffset: payload.endOffset,
          tagIds: finalTagIds,
        }).then(server => {
          setAnnotations(prev => prev.map(a => a.id === optimistic.id ? server : a));
          setActiveAnnotationId(server.id);
        })
      );
    }
  }, [documentData, tags, sync]);

  const handleUpdateNote = useCallback((id: string, note: string) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, note } : a));

    // Debounce note saves to avoid hammering the DB on every keystroke
    const existing = noteTimers.current.get(id);
    if (existing) clearTimeout(existing);
    noteTimers.current.set(id, setTimeout(() => {
      noteTimers.current.delete(id);
      sync(() => api.annotations.updateNote(id, note));
    }, 500));
  }, [sync]);

  const handleDeleteAnnotation = useCallback((id: string) => {
    // Flush any pending note save for this annotation
    const timer = noteTimers.current.get(id);
    if (timer) { clearTimeout(timer); noteTimers.current.delete(id); }

    setAnnotations(prev => prev.filter(a => a.id !== id));
    if (activeAnnotationId === id) setActiveAnnotationId(null);
    sync(() => api.annotations.delete(id));
  }, [activeAnnotationId, sync]);

  const handleTagAnnotation = useCallback((annotationId: string, tagId: string) => {
    setAnnotations(prev => prev.map(a => {
      if (a.id !== annotationId) return a;
      const has = a.tagIds.includes(tagId);
      return { ...a, tagIds: has ? a.tagIds.filter(id => id !== tagId) : [...a.tagIds, tagId] };
    }));
    sync(() => api.annotations.toggleTag(annotationId, tagId));
  }, [sync]);

  // ── Server down screen ──────────────────────────────────────────────────────

  if (serverDown) {
    return (
      <div className="min-h-screen bg-[#FCFAF7] flex items-center justify-center font-sans">
        <div className="text-center max-w-sm">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <p className="text-sm font-semibold mb-2">Server not running</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Start the backend with{' '}
            <code className="bg-[#F3F1ED] px-1.5 py-0.5 rounded font-mono text-[11px]">npm run server</code>
            {' '}then refresh.
          </p>
        </div>
      </div>
    );
  }

  // ── Document library ────────────────────────────────────────────────────────

  if (!documentData) {
    return (
      <DocumentLibrary
        documents={documents}
        isLoading={libLoading}
        isUploading={isUploading}
        errorMsg={errorMsg}
        onOpen={handleOpenDocument}
        onDelete={handleDeleteDocument}
        onUpload={handleUpload}
      />
    );
  }

  // ── Document view ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#FCFAF7] text-[#1A1A1A] flex flex-col font-sans overflow-hidden h-screen">
      <header className="h-16 border-b border-[#E5E2DD] px-8 flex items-center justify-between shrink-0 bg-[#FCFAF7]">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-serif italic tracking-tight">
            Textura<span className="text-xs align-top font-sans font-normal ml-1 opacity-50">v2.0</span>
          </h1>
          <div className="h-4 w-[1px] bg-[#E5E2DD]" />
          <span className="text-xs uppercase tracking-widest font-semibold truncate max-w-xs opacity-60" title={documentData.originalName}>
            {documentData.originalName}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <SaveIndicator status={saveStatus} />
          <button
            onClick={handleCloseDocument}
            className="px-4 py-1.5 text-xs border border-[#1A1A1A] rounded-full hover:bg-[#1A1A1A] hover:text-white transition-colors uppercase tracking-widest font-bold"
          >
            ← Library
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 overflow-hidden">
        <section className="col-span-7 border-r border-[#E5E2DD] overflow-hidden flex flex-col">
          <Viewer
            documentId={documentData.id}
            annotations={annotations}
            tags={tags}
            onAddAnnotation={handleAddAnnotation}
            onSelectHighlight={id => { setActiveAnnotationId(id); setActiveTab('highlights'); }}
            activeAnnotationId={activeAnnotationId}
            activeTagId={activeTagId}
          />
        </section>

        <aside className="col-span-5 flex flex-col overflow-hidden bg-[#FCFAF7]">
          <div className="flex border-b border-[#E5E2DD] shrink-0">
            {(['highlights', 'map', 'metrics'] as const).map(tab => (
              <button
                key={tab}
                className={cn(
                  'flex-1 py-4 text-xs font-bold uppercase tracking-widest transition-colors',
                  activeTab === tab
                    ? 'border-b-2 border-[#1A1A1A] text-[#1A1A1A]'
                    : 'text-gray-400 hover:text-[#1A1A1A]'
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'highlights' ? 'Annotations' : tab === 'map' ? 'Map' : 'Metrics'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'highlights' ? (
              <HighlightsPanel
                annotations={annotations}
                tags={tags}
                activeId={activeAnnotationId}
                onSelect={setActiveAnnotationId}
                onUpdateNote={handleUpdateNote}
                onDelete={handleDeleteAnnotation}
                onTagAnnotation={handleTagAnnotation}
                onCreateTag={handleCreateTag}
              />
            ) : activeTab === 'metrics' ? (
              <MetricsPanel
                annotations={annotations}
                tags={tags}
                tagRelations={tagRelations}
              />
            ) : (
              <div className="h-full flex flex-col overflow-hidden">
                <div className="px-8 pt-6 pb-4 border-b border-[#E5E2DD] shrink-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest">Adjacency Map</h3>
                    <span className="text-[10px] text-gray-400">{tags.length} node{tags.length !== 1 ? 's' : ''}</span>
                  </div>
                  <TagCreator onCreateTag={handleCreateTag} />
                </div>
                <div className="relative flex-1 overflow-hidden">
                  <MapCanvas
                    documentId={documentData.id}
                    tags={tags}
                    tagRelations={tagRelations}
                    tagCounts={tagCounts}
                    annotations={annotations}
                    activeTagId={activeTagId}
                    onSelectTag={id => setActiveTagId(id === activeTagId ? null : id)}
                    onCreateRelation={handleCreateRelation}
                    onDeleteRelation={handleDeleteRelation}
                    onUpdateRelationLabel={handleUpdateRelationLabel}
                    onDeleteTag={handleDeleteTag}
                    onRenameTag={handleRenameTag}
                  />
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      <footer className="h-8 border-t border-[#E5E2DD] bg-[#F9F7F4] flex items-center px-8 text-[10px] uppercase tracking-tighter text-gray-400 shrink-0">
        <div className="flex gap-6 items-center">
          <span>Tags: {tags.length}</span>
          <span>Relations: {tagRelations.length}</span>
          <span>Annotations: {annotations.length}</span>
          {activeTagId && (
            <button
              className="text-[#1A1A1A] font-bold hover:opacity-60 transition-opacity"
              onClick={() => setActiveTagId(null)}
            >
              Focus: {tags.find(t => t.id === activeTagId)?.label} [×]
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ── Tag creator (Map tab header) ──────────────────────────────────────────────

function TagCreator({ onCreateTag }: { onCreateTag: (label: string) => Tag }) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onCreateTag(trimmed);
    setValue('');
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder="New tag name…"
        className="flex-1 text-xs px-3 py-2 bg-white border border-[#E5E2DD] rounded-lg outline-none focus:border-[#1A1A1A] transition-colors placeholder-gray-400"
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest bg-[#1A1A1A] text-white rounded-lg disabled:opacity-30 hover:bg-black transition-colors"
      >
        Add
      </button>
    </div>
  );
}
