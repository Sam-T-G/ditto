import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Annotation, Tag, SelectionPayload } from '../types';
import { getTagColor } from '../lib/tagColors';
import { cn } from '../lib/utils';

interface ViewerProps {
  text: string;
  annotations: Annotation[];
  tags: Tag[];
  onAddAnnotation: (payload: SelectionPayload) => void;
  onSelectHighlight: (id: string) => void;
  activeAnnotationId: string | null;
  activeTagId: string | null;
}

interface SelectionBox {
  top: number;
  left: number;
  start: number;
  end: number;
  text: string;
}

export default function Viewer({
  text,
  annotations,
  tags,
  onAddAnnotation,
  onSelectHighlight,
  activeAnnotationId,
  activeTagId,
}: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const newTagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          setSelectionBox(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const container = containerRef.current;
        if (!container || !container.contains(range.commonAncestorContainer)) {
          setSelectionBox(null);
          return;
        }

        let startOffset = 0;
        let endOffset = 0;

        const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let currentOffset = 0;
        let foundStart = false;
        let foundEnd = false;

        while (treeWalker.nextNode()) {
          const node = treeWalker.currentNode;
          if (!foundStart && node === range.startContainer) {
            startOffset = currentOffset + range.startOffset;
            foundStart = true;
          }
          if (!foundEnd && node === range.endContainer) {
            endOffset = currentOffset + range.endOffset;
            foundEnd = true;
          }
          currentOffset += node.nodeValue?.length || 0;
          if (foundStart && foundEnd) break;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (startOffset !== endOffset) {
          setSelectionBox({
            top: rect.top - containerRect.top - 8,
            left: rect.left - containerRect.left + rect.width / 2,
            start: startOffset,
            end: endOffset,
            text: selection.toString(),
          });
          setSelectedTagIds([]);
          setNewTagInput('');
          setShowTagInput(false);
        }
      }, 10);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const toggleTag = (id: string) => {
    setSelectedTagIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const handleHighlight = () => {
    if (!selectionBox) return;
    onAddAnnotation({
      text: selectionBox.text,
      startOffset: selectionBox.start,
      endOffset: selectionBox.end,
      tagIds: selectedTagIds,
      newTagLabel: newTagInput.trim() || undefined,
    });
    window.getSelection()?.removeAllRanges();
    setSelectionBox(null);
    setSelectedTagIds([]);
    setNewTagInput('');
    setShowTagInput(false);
  };

  const handleNewTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleHighlight();
    }
    if (e.key === 'Escape') {
      setShowTagInput(false);
      setNewTagInput('');
    }
  };

  // Render text with highlight marks
  const renderText = useCallback(() => {
    const visibleAnnotations = activeTagId
      ? annotations.filter(a => a.tagIds.includes(activeTagId))
      : annotations;

    const sorted = [...annotations].sort((a, b) => a.startOffset - b.startOffset);

    const parts: React.ReactNode[] = [];
    let currentIndex = 0;

    sorted.forEach(ann => {
      if (ann.startOffset >= currentIndex) {
        const segment = text.substring(currentIndex, ann.startOffset);
        if (segment) {
          parts.push(
            <span
              key={`text-${currentIndex}`}
              className={cn(
                'transition-opacity duration-200',
                activeTagId && !ann.tagIds.includes(activeTagId) ? 'opacity-30' : ''
              )}
            >
              {segment}
            </span>
          );
        }

        const primaryTag = tags.find(t => ann.tagIds.includes(t.id));
        const color = primaryTag ? getTagColor(primaryTag.colorKey) : null;
        const isActive = activeAnnotationId === ann.id;
        const isDimmed = activeTagId !== null && !ann.tagIds.includes(activeTagId);

        parts.push(
          <mark
            key={ann.id}
            className={cn(
              'cursor-pointer rounded-sm transition-all duration-200 inline',
              isActive ? 'ring-2 ring-offset-1 ring-[#1A1A1A] shadow-sm' : 'hover:-translate-y-[1px]',
              isDimmed ? 'opacity-20' : ''
            )}
            style={{
              backgroundColor: color ? color.highlight : '#FDE68A',
              paddingTop: '0.1em',
              paddingBottom: '0.1em',
            }}
            onClick={() => onSelectHighlight(ann.id)}
          >
            {text.substring(ann.startOffset, ann.endOffset)}
          </mark>
        );
        currentIndex = ann.endOffset;
      }
    });

    const remaining = text.substring(currentIndex);
    if (remaining) {
      parts.push(
        <span
          key={`text-${currentIndex}`}
          className={cn(
            'transition-opacity duration-200',
            activeTagId ? 'opacity-40' : ''
          )}
        >
          {remaining}
        </span>
      );
    }

    return parts;
  }, [text, annotations, tags, activeAnnotationId, activeTagId]);

  return (
    <div className="relative h-full flex flex-col">
      <div
        ref={containerRef}
        className="text-stone-800 font-sans leading-relaxed text-[15px] max-w-4xl mx-auto pb-32 whitespace-pre-wrap outline-none relative"
      >
        {renderText()}
      </div>

      {/* Selection popup */}
      {selectionBox && (
        <div
          className="absolute z-30 animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: selectionBox.top - 120,
            left: selectionBox.left,
            transform: 'translateX(-50%)',
          }}
          onMouseDown={e => e.preventDefault()}
        >
          <div className="bg-white border border-[#E5E2DD] rounded-xl shadow-xl overflow-hidden w-64">
            {/* Tag row */}
            <div className="px-3 pt-3 pb-2">
              <p className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                Assign tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => {
                  const color = getTagColor(tag.colorKey);
                  const active = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all',
                        active
                          ? 'shadow-sm scale-105'
                          : 'opacity-60 hover:opacity-100'
                      )}
                      style={
                        active
                          ? { backgroundColor: color.bg, borderColor: color.border, color: color.text }
                          : { backgroundColor: 'transparent', borderColor: '#E5E2DD', color: '#6B7280' }
                      }
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: color.dot }}
                      />
                      {tag.label}
                    </button>
                  );
                })}

                {/* New tag inline button */}
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
                    onKeyDown={handleNewTagKeyDown}
                    placeholder="Tag name…"
                    className="flex-1 text-xs px-2 py-1 border border-[#E5E2DD] rounded-lg outline-none focus:border-[#1A1A1A] bg-[#FAFAF8] transition-colors"
                  />
                  <button
                    onClick={() => { setShowTagInput(false); setNewTagInput(''); }}
                    className="text-gray-400 hover:text-gray-600 text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              )}

              {tags.length === 0 && !showTagInput && (
                <p className="text-[10px] text-gray-400 italic mt-1">No tags yet — create one above</p>
              )}
            </div>

            {/* Highlight button */}
            <div className="border-t border-[#E5E2DD] px-3 py-2 flex items-center justify-between bg-[#FAFAF8]">
              <span className="text-[9px] text-gray-400 uppercase tracking-widest">
                {selectedTagIds.length > 0
                  ? `${selectedTagIds.length} tag${selectedTagIds.length > 1 ? 's' : ''} selected`
                  : newTagInput.trim()
                  ? 'New tag will be created'
                  : 'Untagged highlight'}
              </span>
              <button
                onClick={handleHighlight}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 12l2 2 4-4" />
                  <circle cx="12" cy="12" r="9" />
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
